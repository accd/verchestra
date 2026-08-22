import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { WORKSPACE_ROOT_DIRNAME } from "../../packages/domain/src/index.ts";
import { evaluateRuntimeDatabase, runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-08 (#207, AC9/AC10/AC11): the live sqlite-durable-state check observes
// a real integrity check, not a file-presence check. Two layers:
// evaluateRuntimeDatabase's pure mapping (any inspect outcome -> pass/fail),
// tested against injected successes and failures — a genuine concurrent
// lock does not actually fail this read-only WAL-mode open, verified
// empirically while building this task, so the "any error degrades to
// fail" property is proven by injection rather than a real lock
// reproduction; and the real wiring end to end through runDoctorDeep against
// real provisioned, corrupt, and unprovisioned control roots.

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sqliteCode(run) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.sqlite-durable-state:"));
}

test("evaluateRuntimeDatabase: a clean integrity result is the pass signal", async () => {
  const observation = await evaluateRuntimeDatabase(async () => ({ integrity: "ok", runs: 0, migrations: 10 }));
  assert.deepEqual(observation, { present: true, healthy: true });
});

test("evaluateRuntimeDatabase: a corrupt-integrity error reports fail, not a crash", async () => {
  const observation = await evaluateRuntimeDatabase(async () => {
    const error = new Error("integrity check failed");
    error.code = "VES_RUNTIME_CORRUPT";
    throw error;
  });
  assert.deepEqual(observation, { present: true, healthy: false });
});

test("evaluateRuntimeDatabase: a lock/busy error also reports fail, never a silent pass", async () => {
  // A real exclusive writer lock does not actually block a WAL-mode
  // read-only open (verified empirically), so this proves the mapping
  // degrades any thrown error identically rather than reproducing a lock
  // that would not fail in practice.
  const observation = await evaluateRuntimeDatabase(async () => {
    const error = new Error("database is locked");
    error.code = "VES_RUNTIME_BUSY";
    throw error;
  });
  assert.deepEqual(observation, { present: true, healthy: false });
});

test("a provisioned, valid database reports pass through the real doctor composition", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-sqlite-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(sqliteCode(run), "doctor.sqlite-durable-state:pass");
});

test("a corrupt database reports fail through the real doctor composition", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-sqlite-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const dbPath = join(root, WORKSPACE_ROOT_DIRNAME, "runtime.db");
  await writeFile(dbPath, "not a sqlite database");

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(sqliteCode(run), "doctor.sqlite-durable-state:fail");
});

test("an unprovisioned database reports blocked, never fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-sqlite-"));
  roots.push(root);
  // Deliberately not provisioned: no .verchestra/runtime.db exists.

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(sqliteCode(run), "doctor.sqlite-durable-state:blocked");
});
