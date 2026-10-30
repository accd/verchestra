// X5 (.specs/features/doctor-scoped-verdict): six deep-doctor checks observe
// subsystems no product command provisions. Absent, they report `not-offered`,
// which names the release's limit instead of a user omission and never raises
// the verdict. Provisioned (the qualification fixtures), they keep reporting
// `pass` or `fail` exactly as before.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DOCTOR_NOT_OFFERED_CHECK_IDS,
  DOCTOR_REMEDIATION_BY_CHECK,
  buildDoctorReport,
  collectDoctorFacts,
  doctorExitCode
} from "../../packages/application/src/index.ts";

const NOT_OFFERED = [
  "doctor.cedar-policy",
  "doctor.connector",
  "doctor.driver",
  "doctor.probe",
  "doctor.sandbox",
  "doctor.sqlite-durable-state"
];
const OFFERED = [
  "doctor.installation",
  "doctor.contract-schema",
  "doctor.native-asset",
  "doctor.git",
  "doctor.secret-presence",
  "doctor.clock"
];

const healthy = { present: true, healthy: true };
const unhealthy = { present: true, healthy: false };
const absent = { present: false, healthy: false };

function probes(observations) {
  const set = {};
  for (const checkId of DOCTOR_CHECK_IDS) set[checkId] = () => observations[checkId] ?? healthy;
  return set;
}

async function factFor(checkId, observation) {
  const facts = await collectDoctorFacts(probes({ [checkId]: observation }));
  return facts.find((fact) => fact.checkId === checkId);
}

async function reportOf(observations) {
  return buildDoctorReport(await collectDoctorFacts(probes(observations)), 1);
}

const allNotOfferedAbsent = Object.fromEntries(NOT_OFFERED.map((checkId) => [checkId, absent]));

test("the declared not-offered set is exactly the six unprovisionable checks", () => {
  assert.deepEqual([...DOCTOR_NOT_OFFERED_CHECK_IDS].sort(), [...NOT_OFFERED].sort());
  assert.deepEqual([...NOT_OFFERED, ...OFFERED].sort(), [...DOCTOR_CHECK_IDS].sort());
  assert.ok(Object.isFrozen(DOCTOR_NOT_OFFERED_CHECK_IDS));
});

test("an absent not-offered subsystem is not-offered with no remediation", async () => {
  for (const checkId of NOT_OFFERED) {
    const fact = await factFor(checkId, absent);
    assert.equal(fact.status, "not-offered", checkId);
    assert.equal(fact.remediationCode, undefined, checkId);
    assert.equal(fact.capabilityId, DOCTOR_CAPABILITY_IDS[checkId], checkId);
  }
});

test("an absent offered subsystem stays blocked with its remediation", async () => {
  for (const checkId of OFFERED) {
    const fact = await factFor(checkId, absent);
    assert.equal(fact.status, "blocked", checkId);
    assert.equal(fact.remediationCode, DOCTOR_REMEDIATION_BY_CHECK[checkId], checkId);
  }
});

test("not-offered checks alone leave the verdict PASS and exit 0", async () => {
  const report = await reportOf(allNotOfferedAbsent);
  assert.equal(report["doctor.verdict"], "PASS");
  assert.equal(doctorExitCode(report["doctor.verdict"]), 0);
  for (const checkId of NOT_OFFERED)
    assert.ok(report["doctor.check_codes"].includes(`${checkId}:not-offered`), checkId);
  for (const checkId of OFFERED) assert.ok(report["doctor.check_codes"].includes(`${checkId}:pass`), checkId);
});

test("not-offered capabilities are listed apart from blocked ones", async () => {
  const report = await reportOf(allNotOfferedAbsent);
  assert.deepEqual(report["doctor.not_offered_capabilities"], [
    "connectors.available",
    "drivers.available",
    "policy.enforceable",
    "probes.available",
    "sandbox.enforced",
    "state.durable"
  ]);
  assert.deepEqual(report["doctor.blocked_capabilities"], []);
  assert.deepEqual(report["doctor.remediation_codes"], []);
  assert.deepEqual(report["doctor.failure_codes"], []);
});

test("a provisioned not-offered subsystem passes", async () => {
  for (const checkId of NOT_OFFERED) {
    const fact = await factFor(checkId, healthy);
    assert.equal(fact.status, "pass", checkId);
    assert.equal(fact.remediationCode, undefined, checkId);
  }
});

test("an unhealthy not-offered subsystem fails with its remediation", async () => {
  for (const checkId of NOT_OFFERED) {
    const fact = await factFor(checkId, unhealthy);
    assert.equal(fact.status, "fail", checkId);
    assert.equal(fact.remediationCode, DOCTOR_REMEDIATION_BY_CHECK[checkId], checkId);
    const report = await reportOf({ ...allNotOfferedAbsent, [checkId]: unhealthy });
    assert.equal(report["doctor.verdict"], "FAIL", checkId);
    assert.equal(doctorExitCode(report["doctor.verdict"]), 1, checkId);
    assert.deepEqual(report["doctor.failure_codes"], [DOCTOR_REMEDIATION_BY_CHECK[checkId]], checkId);
  }
});

test("a blocked offered check still makes the verdict BLOCKED and exit 4", async () => {
  const report = await reportOf({ ...allNotOfferedAbsent, "doctor.secret-presence": absent });
  assert.equal(report["doctor.verdict"], "BLOCKED");
  assert.equal(doctorExitCode(report["doctor.verdict"]), 4);
  assert.deepEqual(report["doctor.blocked_capabilities"], ["secrets.available"]);
  assert.deepEqual(report["doctor.remediation_codes"], ["configure-secret"]);
  assert.equal(report["doctor.not_offered_capabilities"].length, 6);
});

test("not-offered is closed to the declared checks and carries no remediation", () => {
  const passing = (checkId) => ({ checkId, status: "pass", capabilityId: DOCTOR_CAPABILITY_IDS[checkId] });
  for (const checkId of OFFERED) {
    const facts = DOCTOR_CHECK_IDS.map(passing);
    facts[DOCTOR_CHECK_IDS.indexOf(checkId)] = { ...passing(checkId), status: "not-offered" };
    assert.throws(() => buildDoctorReport(facts, 1), { code: "VES_DOCTOR_CHECK_FACT_INVALID" }, checkId);
  }
  for (const checkId of NOT_OFFERED) {
    const facts = DOCTOR_CHECK_IDS.map(passing);
    facts[DOCTOR_CHECK_IDS.indexOf(checkId)] = {
      ...passing(checkId),
      status: "not-offered",
      remediationCode: DOCTOR_REMEDIATION_BY_CHECK[checkId]
    };
    assert.throws(() => buildDoctorReport(facts, 1), { code: "VES_DOCTOR_CHECK_FACT_INVALID" }, checkId);
  }
});
