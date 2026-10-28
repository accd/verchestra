import assert from "node:assert/strict";
import { test } from "node:test";

import { GateRepairError, runGateRepairLoop } from "../../packages/application/src/execution/gate-repair.ts";

// Unit-level outcomes of the gate repair loop: every terminal status, the
// stage each one saves, and the first failing check of each refusal.

const digestOf = (index) => `sha256:${String(index).repeat(64).slice(0, 64)}`;
const failure = (attempt) => ({ failedGateId: "gate:quick", evidenceRef: `evidence:attempt-${attempt}` });
const repairError = (code) => (error) => error instanceof GateRepairError && error.code === code;

function ports(verdicts, overrides = {}) {
  const calls = { attempts: [], saved: [], sealed: [] };
  return {
    calls,
    ports: {
      attempt: async ({ attempt, feedback, budgetMeter }) => {
        calls.attempts.push({ attempt, feedback, budgetMeter });
        const verdict = verdicts[attempt - 1];
        if (typeof verdict === "object") return verdict;
        return verdict === "pass" ? { passed: true } : { passed: false, failure: failure(attempt) };
      },
      buildFeedback: async (gateFailure) => ({
        feedbackRef: `feedback:${gateFailure.evidenceRef}`,
        feedbackDigest: digestOf(7),
        bytes: 64
      }),
      sealAttempt: async (input) => {
        calls.sealed.push(input);
        return { capsuleDigest: digestOf(input.attempt) };
      },
      loadState: async () => undefined,
      saveState: async (state) => {
        calls.saved.push({ ...state, attemptCapsuleDigests: [...state.attemptCapsuleDigests] });
      },
      ...overrides
    }
  };
}

// A meter whose stop decisions are scripted per call of shouldStop.
function scriptedBudget(decisions) {
  let calls = 0;
  const meter = {
    shouldStop: () => decisions[calls++] ?? { stop: false },
    ledger: () => ({ spent: calls })
  };
  return { create: () => meter, meter };
}

test("a converged attempt saves the converged stage with the meter's ledger", async () => {
  const budget = scriptedBudget([]);
  const { calls, ports: repairPorts } = ports(["pass"], { budget });
  const outcome = await runGateRepairLoop({}, repairPorts);
  assert.deepEqual(outcome, { status: "CONVERGED", attempts: 1, attemptCapsuleDigests: [digestOf(1)] });
  assert.equal(Object.isFrozen(outcome), true);
  assert.deepEqual(
    calls.saved.map((state) => state.stage),
    ["converged"]
  );
  assert.deepEqual(calls.saved[0].budgetLedger, { spent: 1 });
  assert.equal(calls.attempts[0].budgetMeter, budget.meter);
});

test("an exhausted budget before an attempt stops the run without attempting", async () => {
  const budget = scriptedBudget([{ stop: true, reason: "cost-threshold" }]);
  const { calls, ports: repairPorts } = ports(["pass"], { budget });
  const outcome = await runGateRepairLoop({}, repairPorts);
  assert.deepEqual(outcome, {
    status: "BUDGET_EXCEEDED",
    attempts: 0,
    stopReason: "cost-threshold",
    failure: undefined,
    attemptCapsuleDigests: []
  });
  assert.equal(calls.attempts.length, 0);
  assert.deepEqual(
    calls.saved.map((state) => state.stage),
    ["budget-exceeded"]
  );
});

test("a stop without a named reason is reported as the budget", async () => {
  const budget = scriptedBudget([{ stop: true }]);
  const outcome = await runGateRepairLoop({}, ports(["pass"], { budget }).ports);
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(outcome.stopReason, "budget");
});

test("a budget exhausted by a failed attempt wins over escalation and carries the failure", async () => {
  const budget = scriptedBudget([{ stop: false }, { stop: true, reason: "token-threshold" }]);
  const { calls, ports: repairPorts } = ports(["fail"], { budget });
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 3, feedbackToDriver: true, escalateAfter: 1 } },
    repairPorts
  );
  assert.equal(outcome.status, "BUDGET_EXCEEDED");
  assert.equal(outcome.stopReason, "token-threshold");
  assert.deepEqual(outcome.failure, failure(1));
  assert.deepEqual(
    calls.saved.map((state) => state.stage),
    ["budget-exceeded"]
  );
});

test("a suspended attempt saves the repair stage and is neither counted nor sealed", async () => {
  const suspension = { reason: "VES_DRIVER_QUOTA", provider: "anthropic", at: "2026-07-16T00:00:00.000Z" };
  const { calls, ports: repairPorts } = ports([{ passed: false, suspension }]);
  const outcome = await runGateRepairLoop({}, repairPorts);
  assert.deepEqual(outcome, { status: "SUSPENDED", attempts: 0, suspension, attemptCapsuleDigests: [] });
  assert.equal(calls.sealed.length, 0);
  assert.deepEqual(
    calls.saved.map((state) => [state.stage, state.attempts, state.budgetLedger]),
    [["repair", 0, null]]
  );
});

test("a declared policy escalates at its escalation point before the attempts run out", async () => {
  const { calls, ports: repairPorts } = ports(["fail", "fail", "fail"]);
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 3, feedbackToDriver: true, escalateAfter: 2 } },
    repairPorts
  );
  assert.deepEqual(outcome, {
    status: "ESCALATED",
    attempts: 2,
    failure: failure(2),
    attemptCapsuleDigests: [digestOf(1), digestOf(2)]
  });
  assert.deepEqual(
    calls.saved.map((state) => state.stage),
    ["repair", "escalated"]
  );
});

test("a policy that withholds feedback attempts again without it and records the withholding", async () => {
  const { calls, ports: repairPorts } = ports(["fail", "pass"]);
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 2, feedbackToDriver: false, escalateAfter: 2 } },
    repairPorts
  );
  assert.equal(outcome.status, "CONVERGED");
  assert.deepEqual(
    calls.attempts.map((entry) => entry.feedback),
    [undefined, undefined]
  );
  assert.deepEqual(
    calls.sealed.map((entry) => [entry.feedbackWithheld, entry.previousAttemptDigest, entry.failure]),
    [
      [false, null, failure(1)],
      [true, digestOf(1), undefined]
    ]
  );
});

test("a resumed run with recorded attempts but no failure sends no feedback and nothing is withheld", async () => {
  const { calls, ports: repairPorts } = ports([undefined, "pass"], {
    loadState: async () => ({ attempts: 1, attemptCapsuleDigests: [digestOf(1)] })
  });
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 2, feedbackToDriver: true, escalateAfter: 2 } },
    repairPorts
  );
  assert.deepEqual(outcome, { status: "CONVERGED", attempts: 2, attemptCapsuleDigests: [digestOf(1), digestOf(2)] });
  assert.equal(calls.attempts[0].feedback, undefined);
  assert.equal(calls.sealed[0].feedbackWithheld, false);
  assert.equal(calls.sealed[0].previousAttemptDigest, digestOf(1));
});

test("an attempt capsule digest that is not a digest fails closed after sealing", async () => {
  const { calls, ports: repairPorts } = ports(["fail"], { sealAttempt: async () => ({ capsuleDigest: "sha256:bad" }) });
  await assert.rejects(runGateRepairLoop({}, repairPorts), repairError("VES_REPAIR_STATE_INVALID"));
  assert.equal(calls.saved.length, 0);
});

test("a failed attempt without gate failure evidence fails closed", async () => {
  const { calls, ports: repairPorts } = ports([{ passed: false }]);
  await assert.rejects(runGateRepairLoop({}, repairPorts), repairError("VES_REPAIR_INPUT_INVALID"));
  assert.equal(calls.saved.length, 0);
});

test("a failed attempt whose gate identifier is unsafe fails closed", async () => {
  const { ports: repairPorts } = ports([{ passed: false, failure: { failedGateId: " gate", evidenceRef: "e" } }]);
  await assert.rejects(runGateRepairLoop({}, repairPorts), repairError("VES_REPAIR_INPUT_INVALID"));
});

test("a recovered run already at its last attempt with no failure on record fails closed", async () => {
  const { calls, ports: repairPorts } = ports([], {
    loadState: async () => ({ attempts: 1, attemptCapsuleDigests: [digestOf(1)] })
  });
  await assert.rejects(runGateRepairLoop({}, repairPorts), repairError("VES_REPAIR_STATE_INVALID"));
  assert.equal(calls.attempts.length, 0);
  assert.equal(calls.saved.length, 0);
});

test("an exhausted absent policy ends at gate-failed with the last failure", async () => {
  const { calls, ports: repairPorts } = ports(["fail"]);
  const outcome = await runGateRepairLoop({}, repairPorts);
  assert.deepEqual(outcome, {
    status: "GATE_FAILED",
    attempts: 1,
    failure: failure(1),
    attemptCapsuleDigests: [digestOf(1)]
  });
  assert.deepEqual(
    calls.saved.map((state) => state.stage),
    ["gate-failed"]
  );
});

test("an exhausted declared policy escalates and saves the escalated stage once", async () => {
  const { calls, ports: repairPorts } = ports(["fail", "fail"]);
  const outcome = await runGateRepairLoop(
    { onGateFailure: { maxAttempts: 2, feedbackToDriver: true, escalateAfter: 2 } },
    repairPorts
  );
  assert.equal(outcome.status, "ESCALATED");
  assert.equal(outcome.attempts, 2);
  assert.equal(calls.attempts[1].feedback.feedbackRef, "feedback:evidence:attempt-1");
  assert.deepEqual(
    calls.saved.map((state) => state.stage),
    ["repair", "escalated"]
  );
});
