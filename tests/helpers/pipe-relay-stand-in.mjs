// DETERMINISTIC FAKE - not PowerShell. A stand-in for the named-pipe helper as
// a real process: it serves one connection on a local endpoint (a named pipe
// on Windows, a Unix socket elsewhere), relays its bytes over its standard
// streams, and writes the helper's status lines on stderr. Its mode is how it
// behaves: `relay` ends when the connection or its input ends, as the helper
// does; `stalls` stops taking the client's bytes once 64 KiB have passed and
// ignores the end of its input, as a helper blocked in a pipe read would;
// `shares` relays but also hands the connection to a child process that keeps
// it open, and ignores the end of its input, so the connection outlives the
// stand-in unless its whole tree is ended.
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const [endpoint, mode] = process.argv.slice(2);
const STALL_AFTER_BYTES = 64 * 1024;
// why: a child left behind by a failed case ends on its own.
const CHILD_LIFETIME_MS = 60_000;

process.stdout.on("error", () => undefined);

function stall(socket) {
  let relayed = 0;
  socket.on("data", (chunk) => {
    process.stdout.write(chunk);
    relayed += chunk.length;
    if (relayed >= STALL_AFTER_BYTES) socket.pause();
  });
}

const server = createServer({ allowHalfOpen: true }, (socket) => {
  server.close();
  socket.on("error", () => undefined);
  process.stderr.write("verchestra-pipe:connected\r\n");
  process.stdin.pipe(socket, { end: mode === "relay" });
  if (mode === "stalls") return stall(socket);
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
