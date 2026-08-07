import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DOCTOR_REMEDIATION_BY_CHECK,
  assertDoctorCheckFacts,
  buildDoctorReport,
  collectDoctorFacts
} from "../../packages/application/src/index.ts";

const healthy = { present: true, healthy: true };
const absent = { present: false, healthy: false };
const unhealthy = { present: true, healthy: false };

function probes(overrides = {}) {
  const set = {};
  for (const checkId of DOCTOR_CHECK_IDS) set[checkId] = overrides[checkId] ?? (() => healthy);
  return set;
}

test("every check id has a registered remediation", () => {
  for (const checkId of DOCTOR_CHECK_IDS)
    assert.ok(DOCTOR_REMEDIATION_BY_CHECK[checkId], `${checkId} has a remediation`);
});

test("collecting always yields the complete closed catalog", () => {
  const facts = collectDoctorFacts(probes());
  assert.equal(facts.length, 12);
  assert.doesNotThrow(() => assertDoctorCheckFacts(facts));
});

test("all-healthy probes produce a PASS report", () => {
  const report = buildDoctorReport(collectDoctorFacts(probes()), 3);
  assert.equal(report["doctor.verdict"], "PASS");
});

test("an absent subsystem becomes a blocked fact with its remediation", () => {
  const facts = collectDoctorFacts(probes({ "doctor.git": () => absent }));
  const git = facts.find((fact) => fact.checkId === "doctor.git");
  assert.equal(git.status, "blocked");
  assert.equal(git.capabilityId, DOCTOR_CAPABILITY_IDS["doctor.git"]);
  assert.equal(git.remediationCode, DOCTOR_REMEDIATION_BY_CHECK["doctor.git"]);
});

test("a present-but-unhealthy subsystem becomes a failing fact", () => {
  const facts = collectDoctorFacts(probes({ "doctor.clock": () => unhealthy }));
  const clock = facts.find((fact) => fact.checkId === "doctor.clock");
  assert.equal(clock.status, "fail");
  assert.equal(clock.remediationCode, DOCTOR_REMEDIATION_BY_CHECK["doctor.clock"]);
});

test("a probe that throws degrades to a failing fact, never a crash or a leak", () => {
  const facts = collectDoctorFacts(
    probes({
      "doctor.sandbox": () => {
        throw new Error("/home/user/.secret leaked");
      }
    })
  );
  const sandbox = facts.find((fact) => fact.checkId === "doctor.sandbox");
  assert.equal(sandbox.status, "fail");
  assert.equal(sandbox.remediationCode, DOCTOR_REMEDIATION_BY_CHECK["doctor.sandbox"]);
  // The thrown message never reaches the fact.
  assert.equal(JSON.stringify(facts).includes("secret leaked"), false);
});

test("a healthy but under-provisioned machine reports BLOCKED, not FAIL", () => {
  const facts = collectDoctorFacts(
    probes({ "doctor.cedar-policy": () => absent, "doctor.native-asset": () => absent })
  );
  const report = buildDoctorReport(facts, 7);
  assert.equal(report["doctor.verdict"], "BLOCKED");
  assert.deepEqual(
    [...report["doctor.blocked_capabilities"]].sort(),
    [DOCTOR_CAPABILITY_IDS["doctor.cedar-policy"], DOCTOR_CAPABILITY_IDS["doctor.native-asset"]].sort()
  );
});

test("a failing check outranks blocked checks in the verdict", () => {
  const facts = collectDoctorFacts(probes({ "doctor.git": () => absent, "doctor.clock": () => unhealthy }));
  assert.equal(buildDoctorReport(facts, 1)["doctor.verdict"], "FAIL");
});
