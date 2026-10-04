// DETERMINISTIC FAKE - not PowerShell. A stand-in for the named-pipe helper as
// a real process: it serves one connection on a local endpoint (a named pipe
// on Windows, a Unix socket elsewhere), relays its bytes over its standard
// streams, and writes the helper's status lines on stderr. Its mode is how it
// behaves: `relay` ends when the connection or its input ends, as the helper
// does; `stalls` stops taking the client's bytes once 64 KiB have passed and
// ignores the end of its input, as a helper blocked in a pipe read would;
// `shares` relays but also hands the connection to a child process that keeps
// it open, and ignores the end of its input, so the connection outlives the
// stand-in unless its whole tree is ended; `blocks` relays as the earlier
// PowerShell helper read, each block of up to 128 KiB written to standard
// output as one write, a short one as soon as nothing more is waiting;
// `holds-tail` writes whole lines and whole 128 KiB blocks but never flushes
// the rest of an unfinished line, as an unflushed relay would hold a frame's
// tail. A failure of its own is written on stderr as
// `verchestra-stand-in:error:<code>` before it exits 1, so a case can name it.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const [endpoint, mode] = process.argv.slice(2);
const STALL_AFTER_BYTES = 64 * 1024;
const BLOCK_BYTES = 128 * 1024;
// why: a child left behind by a failed case ends on its own.
const CHILD_LIFETIME_MS = 60_000;

process.stdout.on("error", () => undefined);
process.on("uncaughtException", (error) => {
  process.stderr.write(`verchestra-stand-in:error:${error.code ?? error.name}\r\n`);
  process.exit(1);
});

function stall(socket) {
  let relayed = 0;
  socket.on("data", (chunk) => {
    process.stdout.write(chunk);
    relayed += chunk.length;
    if (relayed >= STALL_AFTER_BYTES) socket.pause();
  });
}

// why: what a relay of whole blocks has read but not yet written. `blocks`
// writes the rest once nothing more is waiting; `holds-tail` writes the rest
// only up to the last line's end.
function relayInBlocks(socket) {
  let held = Buffer.alloc(0);
  let flushing = false;
  // hazard: standard output is a pipe the parent may not have drained, and on
  // Linux a synchronous write to it fails with EAGAIN once it is full; a block
  // waits for the drain instead, the client's bytes held back meanwhile.
  const write = (bytes) => {
    if (bytes.length === 0 || process.stdout.write(bytes)) return;
    socket.pause();
    process.stdout.once("drain", () => socket.resume());
  };
  const flush = () => {
    flushing = false;
    const end = mode === "blocks" ? held.length : held.lastIndexOf(0x0a) + 1;
    write(held.subarray(0, end));
    held = held.subarray(end);
  };
  socket.on("data", (chunk) => {
    held = Buffer.concat([held, chunk]);
    while (held.length >= BLOCK_BYTES) {
      write(held.subarray(0, BLOCK_BYTES));
      held = held.subarray(BLOCK_BYTES);
    }
    if (!flushing) {
      flushing = true;
      setImmediate(flush);
    }
  });
}

const server = createServer({ allowHalfOpen: true }, (socket) => {
  server.close();
  socket.on("error", () => undefined);
  process.stderr.write("verchestra-pipe:connected\r\n");
  process.stdin.pipe(socket, { end: mode === "relay" });
  if (mode === "stalls") return stall(socket);
  if (mode === "blocks" || mode === "holds-tail") return relayInBlocks(socket);
  if (mode === "shares")
    spawn(process.execPath, ["-e", `setTimeout(() => {}, ${CHILD_LIFETIME_MS})`], {
      stdio: ["ignore", "ignore", "ignore", socket],
      windowsHide: true
    });
  socket.pipe(process.stdout);
  if (mode !== "relay") return undefined;
  const end = () => process.exit(0);
  socket.on("close", end);
  process.stdin.on("end", end);
  return undefined;
});
server.listen(endpoint, () => process.stderr.write("verchestra-pipe:listening\r\n"));
