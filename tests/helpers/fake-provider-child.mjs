// why: the DETERMINISTIC FAKE provider of the provider child run's own suite
// (tests/integration/provider-child-run.test.mjs). It speaks no provider's
// protocol: it runs the steps in FAKE_PROVIDER_STEPS, a JSON array, in order,
// so each case states exactly what its provider writes, reads and how it ends.
// invariant: it starts no process and reads nothing but its own input.
import { once } from "node:events";
import { closeSync } from "node:fs";
import { createInterface } from "node:readline";

const steps = JSON.parse(process.env.FAKE_PROVIDER_STEPS ?? "[]");
// why: a write is awaited before the next step, so a provider that exits next
// has written everything it was asked to; exiting does not wait for a pipe.
const write = (stream, text) => new Promise((resolve) => stream.write(text, resolve));
const line = (text) => write(process.stdout, `${text}\n`);

async function readLine() {
  const reader = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const [read] = await once(reader, "line");
  reader.close();
  return read;
}

async function readAll() {
  let read = "";
  for await (const chunk of process.stdin) read += chunk;
  return read;
}

const ACTIONS = {
  // a line as given, and a value as one JSON line
  line: (text) => line(text),
  json: (value) => line(JSON.stringify(value)),
  // output without a line ending, and output on the error stream
  raw: (text) => write(process.stdout, text),
  err: (text) => write(process.stderr, text),
  readLine: async () => line(JSON.stringify({ read: await readLine() })),
  readAll: async () => line(JSON.stringify({ readAll: await readAll() })),
  // a JSON object line of exactly this many bytes before its line ending
  sized: (length) => line(`{"say":"${"x".repeat(length - 10)}"}`),
  facts: () =>
    line(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), marker: process.env.FAKE_PROVIDER_MARKER })),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  // hazard: on win32 the runtime does not close the descriptors of the
  // standard streams, so this closes nothing there.
  closeInput: () => closeSync(0),
  exit: (code) => process.exit(code),
  kill: (signal) => process.kill(process.pid, signal),
  hang: () => new Promise(() => setInterval(() => {}, 1_000))
};

for (const step of steps) {
  const [[action, argument]] = Object.entries(step);
  await ACTIONS[action](argument);
}
