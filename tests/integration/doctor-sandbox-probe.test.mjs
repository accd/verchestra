import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { evaluateSandboxEscape, runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-06 (#207, AC5/AC6): the live sandbox check observes a real
// ProtectedPathBroker refusing an escape through a symlink/junction, not a
// file-presence check. Two layers: evaluateSandboxEscape's pure mapping
// (broker outcome -> pass/fail), tested against fixture doubles; and the
// real wiring end to end through runDoctorDeep, tested against a real
// provisioned and a real unprovisioned control root.

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sandboxCode(run) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.sandbox:"));
}

test("evaluateSandboxEscape: refusal (VES_PATH_OUTSIDE_ROOT) is the pass signal", async () => {
  const refusingBroker = {
    openExisting: async () => {
      const error = new Error("outside root");
      error.code = "VES_PATH_OUTSIDE_ROOT";
      throw error;
    }
  };
  const observation = await evaluateSandboxEscape(refusingBroker);
  assert.deepEqual(observation, { present: true, healthy: true });
});

test("evaluateSandboxEscape: a permitted open (no error) reports fail, not pass", async () => {
  const permissiveBroker = { openExisting: async () => ({ handleId: "leaked-open" }) };
  const observation = await evaluateSandboxEscape(permissiveBroker);
  assert.deepEqual(observation, { present: true, healthy: false });
});

test("evaluateSandboxEscape: an unrelated error also reports fail, never a silent pass", async () => {
  const brokenBroker = {
    openExisting: async () => {
      const error = new Error("not found");
      error.code = "VES_PATH_NOT_FOUND";
      throw error;
    }
  };
  const observation = await evaluateSandboxEscape(brokenBroker);
  assert.deepEqual(observation, { present: true, healthy: false });
});

test("a provisioned sandbox reports pass through the real doctor composition", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-sandbox-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(sandboxCode(run), "doctor.sandbox:pass");
});

test("an unprovisioned sandbox reports blocked, never fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-sandbox-"));
  roots.push(root);
  // Deliberately not provisioned: no .verchestra/sandbox directory exists.

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(sandboxCode(run), "doctor.sandbox:blocked");
});
