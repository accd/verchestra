// DETERMINISTIC TEST SUPPORT - not a provider. Started as
// `node provider-witness.mjs --witness <file> --as <executable> <fake> [args]`,
// it runs the labeled fake with this Node executable, hands it this process's
// standard input and output unchanged, passes its standard error on as it
// arrives, and ends with its exit code. It appends one JSON line to <file>
// saying how the fake ended: its exit code or signal (or why it never
// started), the last 4 KiB of its standard error, the executable the caller
// asked for, the script and arguments that ran, the working directory, and the
// names of the environment, never its values. A case that fails on a host it
// cannot be debugged on then explains itself in its own log.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const STDERR_TAIL = 4096;
const [witnessFlag, witness, asFlag, requested, script, ...args] = process.argv.slice(2);
if (witnessFlag !== "--witness" || asFlag !== "--as" || script === undefined) {
  process.stderr.write("provider-witness: expected --witness <file> --as <executable> <script> [args]\n");
  process.exit(64);
}

let tail = "";
let recorded = false;
function record(end, exitCode) {
  if (recorded) return;
  recorded = true;
  const environmentKeys = Object.keys(process.env).sort((left, right) => Number(left > right) - Number(left < right));
  const line = { ...end, requested, script, args, cwd: process.cwd(), environmentKeys, stderrTail: tail };
  appendFileSync(witness, `${JSON.stringify(line)}\n`);
  process.exitCode = exitCode;
}

const child = spawn(process.execPath, [script, ...args], { stdio: ["inherit", "inherit", "pipe"], windowsHide: true });
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
  tail = `${tail}${chunk}`.slice(-STDERR_TAIL);
});
child.on("error", (error) => record({ spawnError: error.code ?? "unknown" }, 70));
child.on("close", (code, signal) => record({ code, signal }, code ?? 1));
