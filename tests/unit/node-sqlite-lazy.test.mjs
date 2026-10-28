// invariant: a sealed CLI that loads SQLite prints nothing about it. The
// candidate builder aliases every `node:sqlite` import to the lazy shim, so
// loading the shim is what a published `task` command does; Node's SQLite
// warning must not reach the user's terminal, and every other warning must.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const SHIM = pathToFileURL(join(import.meta.dirname, "../../apps/vestra-cli/closure/node-sqlite-lazy.ts")).href;
const SQLITE_WARNING = /SQLite is an experimental feature/u;

async function evaluate(source) {
  return run(process.execPath, ["--input-type=module", "-e", source], { encoding: "utf8" });
}

test("loading node:sqlite directly prints Node's SQLite warning (control)", async () => {
  const { stderr } = await evaluate(`await import("node:sqlite");`);
  assert.match(stderr, SQLITE_WARNING);
});

test("the sealed SQLite shim loads SQLite without its warning", async () => {
  const { stdout, stderr } = await evaluate(
    `const sqlite = await import(${JSON.stringify(SHIM)});
     const database = new sqlite.DatabaseSync(":memory:");
     process.stdout.write(String(database.prepare("select 1 + 1 as two").get().two));
     database.close();`
  );
  assert.equal(stdout, "2");
  assert.doesNotMatch(stderr, SQLITE_WARNING);
  assert.doesNotMatch(stderr, /ExperimentalWarning/u);
});

test("the shim leaves every other warning alone", async () => {
  const { stderr } = await evaluate(
    `await import(${JSON.stringify(SHIM)});
     process.emitWarning("another feature is experimental", "ExperimentalWarning");
     await new Promise((resolve) => setImmediate(resolve));`
  );
  assert.match(stderr, /ExperimentalWarning: another feature is experimental/u);
  assert.doesNotMatch(stderr, SQLITE_WARNING);
});

test("the shim drops a warning only when it starts with SQLite's text", async () => {
  const { stderr } = await evaluate(
    `await import(${JSON.stringify(SHIM)});
     process.emitWarning("Note: SQLite is an experimental feature here", "ExperimentalWarning");
     process.emitWarning("SQLite is an experimental feature again", "DeprecationWarning");
     await new Promise((resolve) => setImmediate(resolve));`
  );
  assert.match(stderr, /ExperimentalWarning: Note: SQLite is an experimental feature here/u);
  assert.match(stderr, /DeprecationWarning: SQLite is an experimental feature again/u);
});

test("in this process, the shim loads SQLite with no warning and restores emitWarning", async () => {
  const emitWarning = process.emitWarning;
  const warnings = [];
  const listen = (warning) => warnings.push(warning.message);
  process.on("warning", listen);
  try {
    const sqlite = await import(SHIM);
    const database = new sqlite.DatabaseSync(":memory:");
    assert.equal(database.prepare("select 1 + 1 as two").get().two, 2);
    database.close();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off("warning", listen);
  }
  assert.equal(process.emitWarning, emitWarning);
  assert.deepEqual(
    warnings.filter((message) => SQLITE_WARNING.test(message)),
    []
  );
});
