// invariant: ADP-6 — the durable effect repository lives in its own module
// beside the runtime store. node:sqlite prints an experimental warning the
// moment anything loads it, so the module and the failure mapping it shares
// with the store import SQLite as a type only, and the store reaches the
// repository by delegation instead of carrying its SQL.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const directory = new URL("../../packages/platform-node/src/runtime-store/", import.meta.url);
const read = (name) => readFileSync(new URL(name, directory), "utf8");

function importStatements(code) {
  return code
    .split("\n")
    .filter((line) => line.startsWith("import "))
    .map((line) => ({ typeOnly: line.startsWith("import type "), specifier: line.split('"').at(-2) }));
}

function loadedWithoutSqlite(name) {
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(new URL(name, directory).href)});`],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, result.stderr);
  return !/SQLite/u.test(result.stderr);
}

test("the effect repository imports node:sqlite as a type only and never the runtime store", () => {
  assert.deepEqual(importStatements(read("effect-repository.ts")), [
    { typeOnly: true, specifier: "node:sqlite" },
    { typeOnly: true, specifier: "@verchestra/application" },
    { typeOnly: false, specifier: "./runtime-sqlite.ts" }
  ]);
  assert.deepEqual(importStatements(read("runtime-sqlite.ts")), [{ typeOnly: true, specifier: "node:sqlite" }]);
  for (const name of ["effect-repository.ts", "runtime-sqlite.ts"]) {
    assert.doesNotMatch(read(name), /\bimport\(|\brequire\(/u, `${name} must not load a module dynamically`);
  }
});

test("loading the effect repository does not load SQLite, and loading the runtime store does", () => {
  assert.equal(loadedWithoutSqlite("effect-repository.ts"), true);
  // why: the control proves the sensor above can see a SQLite load at all.
  assert.equal(loadedWithoutSqlite("runtime-store.ts"), false);
});

test("the runtime store delegates the effect repository and carries none of its statements", () => {
  const store = read("runtime-store.ts");
  assert.match(
    store,
    /createEffectRepository\(\) \{\s*return createSqliteEffectRepository\(\{\s*database: \(\) => this\.#database\(\),\s*now: \(\) => this\.#now\(\),\s*hooks: this\.#hooks\s*\}\);\s*\}/u
  );
  for (const table of ["effect_intents", "effect_outbox", "operation_receipts", "effect_inbox"]) {
    assert.doesNotMatch(store, new RegExp(`(?:FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, "u"), `${table} statement`);
    assert.match(read("effect-repository.ts"), new RegExp(`(?:FROM|INTO|UPDATE|JOIN)\\s+${table}\\b`, "u"));
  }
});
