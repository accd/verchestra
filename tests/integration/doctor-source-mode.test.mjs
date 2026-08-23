import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { DOCTOR_CHECK_IDS } from "../../packages/application/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";

// DDL-13 (#207, AC11/AC15): in a genuinely unprovisioned source checkout —
// no .verchestra/ fixtures at all, nothing from
// scripts/provision-doctor-fixtures.mjs — every check this feature upgraded
// (T12-T14, T17-T19; secret-presence stays on its original, unchanged
// file-presence check per T15's deferral) reports blocked, never fail. A
// blocked check answers "not provisioned," which is the honest answer on a
// bare checkout; fail would wrongly claim something is broken.

const UPGRADED_CHECKS = Object.freeze([
  "doctor.sandbox",
  "doctor.sqlite-durable-state",
  "doctor.cedar-policy",
  "doctor.secret-presence",
  "doctor.driver",
  "doctor.connector",
  "doctor.probe"
]);

const NO_PATH = /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u;

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("all seven upgraded checks report blocked, never fail, in an unprovisioned checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-source-mode-"));
  roots.push(root);
  // Deliberately not provisioned: no scripts/provision-doctor-fixtures.mjs
  // call, no .verchestra/ directory of any kind.

  const run = await runDoctorDeep({ controlRoot: root });
  const codes = run.payload["doctor.check_codes"];

  for (const checkId of UPGRADED_CHECKS) {
    const code = codes.find((entry) => entry.startsWith(`${checkId}:`));
    assert.equal(code, `${checkId}:blocked`, `expected ${checkId} to report blocked on a bare checkout`);
  }
  assert.equal(
    codes.some((entry) => entry.endsWith(":fail")),
    false,
    `no check should report fail on a bare checkout; got ${JSON.stringify(codes)}`
  );
});

test("the five checks this feature never touched are still present and unaffected", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-source-mode-"));
  roots.push(root);

  const run = await runDoctorDeep({ controlRoot: root });
  const codes = run.payload["doctor.check_codes"];

  for (const checkId of [
    "doctor.installation",
    "doctor.contract-schema",
    "doctor.native-asset",
    "doctor.git",
    "doctor.clock"
  ]) {
    assert.ok(
      codes.some((entry) => entry.startsWith(`${checkId}:`)),
      `expected ${checkId} to report a status`
    );
  }
  // The closed catalog is exactly the twelve registered checks — proves this
  // feature added live behavior without silently adding or dropping a check.
  assert.equal(codes.length, DOCTOR_CHECK_IDS.length);
});

test("the sealed report from a bare checkout still carries no path, value, or secret", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-source-mode-"));
  roots.push(root);

  const run = await runDoctorDeep({ controlRoot: root });
  const serialized = `${JSON.stringify(run.payload)}\n${JSON.stringify(run.artifact)}`;

  assert.doesNotMatch(serialized, NO_PATH);
});
