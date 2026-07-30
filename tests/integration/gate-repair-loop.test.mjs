import assert from "node:assert/strict";
import { test } from "node:test";

import { FEEDBACK_BYTE_BUDGET, runGateRepairLoop } from "../../packages/application/src/execution/gate-repair.ts";

const digestOf = (index) => `sha256:${String(index).repeat(64).slice(0, 64)}`;
const failure = (attempt) => ({ failedGateId: "gate:quick", evidenceRef: `evidence:attempt-${attempt}` });

// A harness whose gate verdict per attempt is scripted, with durable state kept
// in a plain object so crash-resume can be simulated by running the loop again.
function harness(verdicts, { feedbackBytes = 512, persisted = {} } = {}) {
  const calls = { attempts: [], feedbackBuilt: [], sealed: [], savedStages: [] };
  const ports = {
    attempt: async ({ attempt, feedback }) => {
      calls.attempts.push({ attempt, feedback });
      const passed = verdicts[attempt - 1] === "pass";
      return passed ? { passed } : { passed, failure: failure(attempt) };
    },
    buildFeedback: async (gateFailure) => {
      calls.feedbackBuilt.push(gateFailure);
      return { feedbackRef: `feedback:${gateFailure.evidenceRef}`, feedbackDigest: digestOf(7), bytes: feedbackBytes };
    },
    sealAttempt: async (input) => {
      calls.sealed.push(input);
      return { capsuleDigest: digestOf(input.attempt) };
    },
    loadState: async () => persisted.state,
    saveState: async (state) => {
      calls.savedStages.push(state.stage);
      persisted.state = {
        attempts: state.attempts,
        attemptCapsuleDigests: state.attemptCapsuleDigests,
        budgetLedger: state.budgetLedger
      };
    }
  };
  return { calls, ports, persisted };
}

const POLICY = { maxAttempts: 3, feedbackToDriver: true, escalateAfter: 3 };

test("a flaky gate converges on the second attempt with feedback attached", async () => {
  const { calls, ports } = harness(["fail", "pass"]);
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "CONVERGED");
  assert.equal(outcome.attempts, 2);
  // The first attempt runs cold; the second carries the bounded feedback built
  // from the first failure.
  assert.equal(calls.attempts[0].feedback, undefined);
  assert.equal(calls.attempts[1].feedback.feedbackRef, "feedback:evidence:attempt-1");
  assert.deepEqual(calls.savedStages, ["repair", "converged"]);
});

test("a permanent failure escalates at exactly the declared point", async () => {
  const { calls, ports } = harness(["fail", "fail", "fail", "fail"]);
  const outcome = await runGateRepairLoop({ onGateFailure: { ...POLICY, maxAttempts: 5, escalateAfter: 2 } }, ports);
  assert.equal(outcome.status, "ESCALATED");
  assert.equal(outcome.attempts, 2);
  // No autonomous attempt past the escalation point, even with attempts left.
  assert.equal(calls.attempts.length, 2);
  assert.equal(calls.savedStages.at(-1), "escalated");
});

test("exhausting a declared policy escalates rather than silently failing", async () => {
  const { ports } = harness(["fail", "fail", "fail"]);
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "ESCALATED");
  assert.equal(outcome.attempts, 3);
  assert.equal(outcome.failure.evidenceRef, "evidence:attempt-3");
});

test("no declared policy keeps today's semantics: one attempt, terminal gate-failed", async () => {
  const { calls, ports } = harness(["fail"]);
  const outcome = await runGateRepairLoop({}, ports);
  assert.equal(outcome.status, "GATE_FAILED");
  assert.equal(outcome.attempts, 1);
  assert.equal(calls.attempts.length, 1);
  assert.equal(calls.feedbackBuilt.length, 0);
  assert.deepEqual(calls.savedStages, ["gate-failed"]);
});

test("attempt capsules chain through previousAttemptDigest", async () => {
  const { calls, ports } = harness(["fail", "fail", "pass"]);
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, ports);
  assert.equal(outcome.status, "CONVERGED");
  assert.deepEqual(
    calls.sealed.map((entry) => entry.previousAttemptDigest),
    [null, digestOf(1), digestOf(2)]
  );
  assert.deepEqual(outcome.attemptCapsuleDigests, [digestOf(1), digestOf(2), digestOf(3)]);
});

test("withheld feedback is recorded as a decision, not an omission", async () => {
  const { calls, ports } = harness(["fail", "pass"]);
  await runGateRepairLoop({ onGateFailure: { ...POLICY, feedbackToDriver: false } }, ports);
  assert.equal(calls.feedbackBuilt.length, 0);
  assert.equal(calls.attempts[1].feedback, undefined);
  assert.deepEqual(
    calls.sealed.map((entry) => entry.feedbackWithheld),
    [false, true]
  );
});

test("a crash between attempts resumes with correct counts and no duplicate capsule", async () => {
  const persisted = {};
  const first = harness(["fail", "crash-here"], { persisted });
  // Simulate the crash by throwing from the second attempt after the first was
  // durably recorded.
  first.ports.attempt = async ({ attempt, feedback }) => {
    first.calls.attempts.push({ attempt, feedback });
    if (attempt === 1) return { passed: false, failure: failure(1) };
    throw new Error("process crashed mid-attempt");
  };
  await assert.rejects(runGateRepairLoop({ onGateFailure: POLICY }, first.ports), /crashed/u);
  // A loop with no budget port persists a null ledger, so the recovered shape
  // stays complete rather than silently omitting the field.
  assert.deepEqual(persisted.state, { attempts: 1, attemptCapsuleDigests: [digestOf(1)], budgetLedger: null });

  // The resumed loop continues at attempt 2; attempt 1 is not re-run.
  const resumed = harness(["irrelevant", "pass"], { persisted });
  const outcome = await runGateRepairLoop({ onGateFailure: POLICY }, resumed.ports);
  assert.equal(outcome.status, "CONVERGED");
  assert.equal(outcome.attempts, 2);
  assert.deepEqual(
    resumed.calls.attempts.map((entry) => entry.attempt),
    [2]
  );
  assert.deepEqual(outcome.attemptCapsuleDigests, [digestOf(1), digestOf(2)]);
});

test("unbounded feedback fails closed instead of reaching the driver", async () => {
  const { ports } = harness(["fail", "pass"], { feedbackBytes: FEEDBACK_BYTE_BUDGET + 1 });
  await assert.rejects(runGateRepairLoop({ onGateFailure: POLICY }, ports), {
    code: "VES_REPAIR_FEEDBACK_INVALID"
  });
});

for (const [label, policy] of [
  ["zero attempts", { maxAttempts: 0, feedbackToDriver: false, escalateAfter: 1 }],
  ["six attempts", { maxAttempts: 6, feedbackToDriver: false, escalateAfter: 1 }],
  ["escalation past the last attempt", { maxAttempts: 2, feedbackToDriver: false, escalateAfter: 3 }],
  ["a stringly boolean", { maxAttempts: 2, feedbackToDriver: "yes", escalateAfter: 1 }],
  ["an unknown field", { maxAttempts: 2, feedbackToDriver: false, escalateAfter: 1, retryForever: true }]
]) {
  test(`a policy with ${label} is rejected`, async () => {
    const { calls, ports } = harness(["pass"]);
    await assert.rejects(runGateRepairLoop({ onGateFailure: policy }, ports), { code: "VES_REPAIR_INPUT_INVALID" });
    assert.equal(calls.attempts.length, 0);
  });
}

test("tampered recovered state fails closed", async () => {
  const { ports } = harness(["pass"], { persisted: { state: { attempts: 2, attemptCapsuleDigests: [digestOf(1)] } } });
  await assert.rejects(runGateRepairLoop({ onGateFailure: POLICY }, ports), { code: "VES_REPAIR_STATE_INVALID" });
});
