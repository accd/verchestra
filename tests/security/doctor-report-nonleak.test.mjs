import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DOCTOR_REMEDIATION_CODES,
  DOCTOR_REPORT_FIELDS,
  collectDoctorFacts
} from "../../packages/application/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-11 (#207, AC7/AC15): with T12-T19's probes now genuinely live —
// touching a real symlink escape, a real SQLite database, a real
// Ed25519-signed policy bundle, real availability records — this proves the
// sealed report still carries only the closed vocabulary the doctor system
// has always promised, not merely that the rule engine enforces it in
// theory (already true since T72). Runs the real, fully-wired composition
// end to end against real provisioned fixtures, not synthetic probes.

const VALID_CHECK_CODES = new Set(
  DOCTOR_CHECK_IDS.flatMap((checkId) => ["pass", "fail", "blocked"].map((status) => `${checkId}:${status}`))
);
const VALID_REMEDIATION_CODES = new Set(DOCTOR_REMEDIATION_CODES);
const VALID_CAPABILITY_IDS = new Set(Object.values(DOCTOR_CAPABILITY_IDS));
const NO_PATH = /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u;

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("a real provisioned run's payload carries only registered fields and closed-set values", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-nonleak-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });
  const { payload } = run;

  assert.deepEqual(Object.keys(payload).sort(), [...DOCTOR_REPORT_FIELDS].sort());
  for (const code of payload["doctor.check_codes"]) assert.ok(VALID_CHECK_CODES.has(code), code);
  for (const code of payload["doctor.failure_codes"]) assert.ok(VALID_REMEDIATION_CODES.has(code), code);
  for (const code of payload["doctor.remediation_codes"]) assert.ok(VALID_REMEDIATION_CODES.has(code), code);
  for (const capability of payload["doctor.blocked_capabilities"])
    assert.ok(VALID_CAPABILITY_IDS.has(capability), capability);
});

test("a real provisioned run's payload and artifact carry no path, secret, digest, or bundle content", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-nonleak-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });
  const serialized = `${JSON.stringify(run.payload)}\n${JSON.stringify(run.artifact)}`;

  for (const forbidden of [
    NO_PATH,
    /SQLite format 3/u,
    /permit\(principal/u, // the fixture's own Cedar policy text
    /BEGIN [A-Z ]*PRIVATE/u,
    /"privateKey"/u
  ])
    assert.doesNotMatch(serialized, forbidden, `a ${String(forbidden)} class value must never reach the sealed report`);
});

test("a probe returning extra fields on its observation cannot leak them — observeToFact reads only present/healthy", async () => {
  // Distinct from the thrown-error leak tests in doctor-diagnostic.test.mjs:
  // this proves the leak is structurally impossible even when a probe does
  // not throw at all, by returning extra properties on an otherwise-valid
  // observation object. observeToFact only reads .present/.healthy, so
  // nothing else on the object can reach a fact.
  const leakedValue = "leaked-secret-marker-9f3a";
  const probes = Object.fromEntries(
    DOCTOR_CHECK_IDS.map((checkId) => [
      checkId,
      () => ({ present: true, healthy: true, secret: leakedValue, path: "/Users/example/leak" })
    ])
  );

  const facts = await collectDoctorFacts(probes);

  assert.equal(JSON.stringify(facts).includes(leakedValue), false);
  assert.doesNotMatch(JSON.stringify(facts), NO_PATH);
});
