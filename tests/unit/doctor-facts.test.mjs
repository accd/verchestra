import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DOCTOR_PROBE_TIMEOUT_MS,
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

test("collecting always yields the complete closed catalog", async () => {
  const facts = await collectDoctorFacts(probes());
  assert.equal(facts.length, 12);
  assert.doesNotThrow(() => assertDoctorCheckFacts(facts));
});

test("all-healthy probes produce a PASS report", async () => {
  const report = buildDoctorReport(await collectDoctorFacts(probes()), 3);
  assert.equal(report["doctor.verdict"], "PASS");
});

test("an absent subsystem becomes a blocked fact with its remediation", async () => {
  const facts = await collectDoctorFacts(probes({ "doctor.git": () => absent }));
  const git = facts.find((fact) => fact.checkId === "doctor.git");
  assert.equal(git.status, "blocked");
  assert.equal(git.capabilityId, DOCTOR_CAPABILITY_IDS["doctor.git"]);
  assert.equal(git.remediationCode, DOCTOR_REMEDIATION_BY_CHECK["doctor.git"]);
});

test("a present-but-unhealthy subsystem becomes a failing fact", async () => {
  const facts = await collectDoctorFacts(probes({ "doctor.clock": () => unhealthy }));
  const clock = facts.find((fact) => fact.checkId === "doctor.clock");
  assert.equal(clock.status, "fail");
  assert.equal(clock.remediationCode, DOCTOR_REMEDIATION_BY_CHECK["doctor.clock"]);
});

test("a probe that throws degrades to a failing fact, never a crash or a leak", async () => {
  const facts = await collectDoctorFacts(
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

test("a healthy but under-provisioned machine reports BLOCKED, not FAIL", async () => {
  const facts = await collectDoctorFacts(
    probes({ "doctor.cedar-policy": () => absent, "doctor.native-asset": () => absent })
  );
  const report = buildDoctorReport(facts, 7);
  assert.equal(report["doctor.verdict"], "BLOCKED");
  assert.deepEqual(
    [...report["doctor.blocked_capabilities"]].sort(),
    [DOCTOR_CAPABILITY_IDS["doctor.cedar-policy"], DOCTOR_CAPABILITY_IDS["doctor.native-asset"]].sort()
  );
});

test("a failing check outranks blocked checks in the verdict", async () => {
  const facts = await collectDoctorFacts(probes({ "doctor.git": () => absent, "doctor.clock": () => unhealthy }));
  assert.equal(buildDoctorReport(facts, 1)["doctor.verdict"], "FAIL");
});

// DDL-04 (#207): collectDoctorFacts widens to accept an async probe. A
// rejected promise degrades the same way a synchronous throw already does —
// present-but-unhealthy, no error text — and a probe that never settles is
// bounded by a timeout rather than stalling the diagnostic.

test("a probe that rejects degrades to a failing fact, never a crash or a leak", async () => {
  const facts = await collectDoctorFacts(
    probes({
      "doctor.sandbox": () => Promise.reject(new Error("/home/user/.secret leaked"))
    })
  );
  const sandbox = facts.find((fact) => fact.checkId === "doctor.sandbox");
  assert.equal(sandbox.status, "fail");
  assert.equal(sandbox.remediationCode, DOCTOR_REMEDIATION_BY_CHECK["doctor.sandbox"]);
  assert.equal(JSON.stringify(facts).includes("secret leaked"), false);
});

test("a probe that never settles resolves to a failing fact via timeout, not a stalled diagnostic", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let sandboxProbeCalled = false;
  const collecting = collectDoctorFacts(
    probes({
      "doctor.sandbox": () => {
        sandboxProbeCalled = true;
        return new Promise(() => {});
      }
    })
  );
  // doctor.sandbox is last in DOCTOR_CHECK_IDS, so eleven earlier synchronous
  // probes resolve first, each taking a microtask turn. Poll until the probe
  // under test has actually run (and so has registered its timer) before
  // advancing the mock clock — ticking too early would advance past a timer
  // that does not exist yet, and this Node version has no `tickAsync` to
  // interleave ticking with microtask flushes automatically.
  while (!sandboxProbeCalled) await Promise.resolve();
  t.mock.timers.tick(DOCTOR_PROBE_TIMEOUT_MS);
  const facts = await collecting;
  const sandbox = facts.find((fact) => fact.checkId === "doctor.sandbox");
  assert.equal(sandbox.status, "fail");
});

test("probes are awaited sequentially, never concurrently", async () => {
  const order = [];
  const facts = await collectDoctorFacts(
    probes({
      "doctor.git": async () => {
        order.push("git-start");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
        order.push("git-end");
        return healthy;
      },
      "doctor.clock": () => {
        order.push("clock");
        return healthy;
      }
    })
  );
  // doctor.git is registered before doctor.clock in DOCTOR_CHECK_IDS. If the
  // two ran concurrently, "clock" would interleave before "git-end"; a
  // sequential collector must finish git entirely first.
  assert.deepEqual(order, ["git-start", "git-end", "clock"]);
  assert.equal(facts.length, 12);
});
