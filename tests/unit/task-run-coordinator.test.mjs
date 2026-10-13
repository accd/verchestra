// invariant: the governed task run (#405) sequences the executor, the gate
// commit, the repair loop, and independent verification against the real
// workflow machine. Every port here is a scripted stand-in; the workflow
// decisions are the production WorkflowMachine's.
import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskRunCoordinator, TaskRunError, createBudgetMeter } from "../../packages/application/src/index.ts";
import { WorkflowMachine } from "../../packages/domain/src/index.ts";

const BINDING = `sha256:${"a".repeat(64)}`;
const CHANGE = `sha256:${"c".repeat(64)}`;
const EVIDENCE = `sha256:${"e".repeat(64)}`;
const digestOf = (index) => `sha256:${String(index).repeat(64).slice(0, 64)}`;

function snapshot(state, overrides = {}) {
  return Object.freeze({
    runId: "run_018f0b6d-7b1a-4abc-8def-112345678901",
    runKind: "feature",
    state,
    version: 2,
    repairCycles: 0,
    approval: { bindingDigest: BINDING },
    ...overrides
  });
}

const execution = Object.freeze({
  worktreeRef: `worktree:${"1".repeat(32)}:${"b".repeat(40)}`,
  baseCommit: "b".repeat(40),
  coordinationRef: "lease:1",
  changeDigest: CHANGE,
  changedPaths: ["src/value.txt"],
  checkpointRef: "checkpoint:executor:1"
});
const commit = Object.freeze({
  commitId: "d".repeat(40),
  baseCommit: "b".repeat(40),
  gateEvidenceDigest: EVIDENCE,
  gateEvidenceRefs: ["gate-evidence:1"]
});

function harness(options = {}) {
  const calls = { commands: [], executed: 0, committed: 0, released: 0, verified: 0, feedback: [] };
  let current = options.snapshot ?? snapshot("EXECUTION_AUTHORIZED");
  let committed = options.committed;
  const gateResults = [...(options.gateResults ?? ["pass"])];
  // why: a test that resumes a run hands the next harness the state the
  // previous one persisted, as the runtime store would.
  const persisted = options.persisted ?? {};
  const ports = {
    workflow: {
      current: async () => current,
      apply: async (command) => {
        calls.commands.push(command.type);
        const decision = WorkflowMachine.decide(current, { ...command, expectedVersion: current.version });
        if (!decision.accepted) throw new TaskRunError("VES_TASK_RUN_WORKFLOW_REJECTED", decision.code);
        current = decision.snapshot;
        return current;
      }
    },
    execution: {
      resumable: async () => options.resumable,
      execute: async ({ feedback, budgetMeter }) => {
        calls.executed += 1;
        calls.feedback.push(feedback);
        if (options.execute !== undefined) return options.execute({ budgetMeter });
        return execution;
      }
    },
    gates: {
      committed: async () => committed,
      commit: async () => {
        calls.committed += 1;
        const verdict = gateResults.shift() ?? "pass";
        if (verdict !== "pass")
          return { passed: false, failure: { failedGateId: "gate:test", evidenceRef: "gate-evidence:fail" } };
        committed = commit;
        return { passed: true, commit };
      }
    },
    repair: {
      ...(options.budget === undefined ? {} : { budget: options.budget }),
      buildFeedback: async (failure) => ({
        feedbackRef: `feedback:${failure.evidenceRef}`,
        feedbackDigest: digestOf(7),
        bytes: 32
      }),
      sealAttempt: async (input) => {
        calls.sealed = (calls.sealed ?? 0) + 1;
        return { capsuleDigest: digestOf(input.attempt) };
      },
      loadState: async () => persisted.state,
      saveState: async (state) => {
        persisted.state = { ...state };
      }
    },
    verification: {
      verify: async (verifiedCommit, run) => {
        calls.verified += 1;
        assert.equal(verifiedCommit.commitId, commit.commitId);
        const verdict = options.verdict ?? "PASS";
        const decision = WorkflowMachine.decide(run, {
          type: verdict === "PASS" ? "PASS_VERIFICATION" : "REQUEST_REPAIR",
          expectedVersion: run.version,
          actorRole: "verifier",
          actorId: "actor:codex-verifier",
          evidence: ["verification-evidence"]
        });
        current = decision.snapshot;
        return { verdict, nextState: decision.nextState, reportRef: "verification:report:1" };
      }
    },
    release: async () => {
      calls.released += 1;
    }
  };
  return { calls, ports, state: () => current };
}

function input(overrides = {}) {
  return {
    bindingDigest: BINDING,
    implementerActorId: "actor:claude-code-implementer",
    cancelActorId: "human:local-operator",
    signal: new AbortController().signal,
    ...overrides
  };
}

test("an authorized run is implemented, gated, verified, and stops at human review", async () => {
  const { calls, ports, state } = harness();
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.equal(outcome.status, "HUMAN_REVIEW");
  assert.equal(outcome.commit.commitId, commit.commitId);
  assert.equal(state().state, "HUMAN_REVIEW");
  assert.deepEqual(calls.commands, ["START_IMPLEMENTATION", "START_VERIFICATION"]);
  assert.equal(calls.executed, 1);
  assert.equal(calls.released, 0);
});

test("a resumable awaiting-gate result skips the implementer entirely", async () => {
  const { calls, ports } = harness({ snapshot: snapshot("IMPLEMENTING"), resumable: execution });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.equal(outcome.status, "HUMAN_REVIEW");
  assert.equal(calls.executed, 0);
  assert.equal(calls.committed, 1);
  assert.deepEqual(calls.commands, ["START_VERIFICATION"]);
});

test("an already committed task resumes straight into verification", async () => {
  const { calls, ports } = harness({ snapshot: snapshot("IMPLEMENTING"), committed: commit });
  assert.equal((await new TaskRunCoordinator(ports).run(input())).status, "HUMAN_REVIEW");
  assert.equal(calls.executed, 0);
  assert.equal(calls.committed, 0);
});

test("a verifying run resumes verification without re-running implementation or gates", async () => {
  const { calls, ports } = harness({ snapshot: snapshot("VERIFYING"), committed: commit });
  assert.equal((await new TaskRunCoordinator(ports).run(input())).status, "HUMAN_REVIEW");
  assert.deepEqual([calls.executed, calls.committed, calls.verified], [0, 0, 1]);
});

test("a stale binding returns the run to approval instead of implementing", async () => {
  const { calls, ports, state } = harness();
  const outcome = await new TaskRunCoordinator(ports).run(input({ bindingDigest: `sha256:${"f".repeat(64)}` }));
  assert.equal(outcome.status, "APPROVAL_INVALIDATED");
  assert.equal(state().state, "AWAITING_EXECUTION_APPROVAL");
  assert.equal(calls.executed, 0);
});

test("a failed gate without a repair policy fails the run and releases the worktree", async () => {
  const { calls, ports, state } = harness({ gateResults: ["fail"] });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.deepEqual(outcome, { status: "FAILED", reason: "VES_TASK_GATE_FAILED" });
  assert.equal(state().state, "FAILED");
  assert.equal(calls.released, 1);
  assert.equal(calls.verified, 0);
});

test("a declared repair policy re-executes with feedback and converges", async () => {
  const { calls, ports } = harness({ gateResults: ["fail", "pass"] });
  const outcome = await new TaskRunCoordinator(ports).run(
    input({ onGateFailure: { maxAttempts: 2, feedbackToDriver: true, escalateAfter: 2 } })
  );
  assert.equal(outcome.status, "HUMAN_REVIEW");
  assert.equal(calls.executed, 2);
  assert.equal(calls.feedback[0], undefined);
  assert.equal(calls.feedback[1].feedbackRef, "feedback:gate-evidence:fail");
});

test("an exhausted repair policy escalates and leaves the run for a human", async () => {
  const { ports, state, calls } = harness({ gateResults: ["fail", "fail"] });
  const outcome = await new TaskRunCoordinator(ports).run(
    input({ onGateFailure: { maxAttempts: 2, feedbackToDriver: false, escalateAfter: 2 } })
  );
  assert.equal(outcome.status, "ESCALATED");
  assert.equal(state().state, "IMPLEMENTING");
  assert.equal(calls.released, 0);
});

test("an exhausted budget is a budget outcome, not a gate failure", async () => {
  const budgets = { maximumCostUsd: 1, maximumTokens: 100, maximumDurationMs: 60_000 };
  const priceTable = { version: "test", models: { m: { inputPerMToken: 1, outputPerMToken: 1 } } };
  const { ports, state } = harness({
    budget: { create: (resume) => createBudgetMeter({ budgets, priceTable, resume }) },
    execute: async ({ budgetMeter }) => {
      budgetMeter.recordUsage({ model: "m", inputTokens: 95, outputTokens: 0 });
      throw Object.assign(new Error("budget"), { code: "VES_EXECUTOR_BUDGET_EXCEEDED" });
    }
  });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.deepEqual(outcome, { status: "FAILED", reason: "VES_EXECUTOR_BUDGET_EXCEEDED" });
  assert.equal(state().state, "FAILED");
});

test("a cancelled run is aborted by the requesting human and released", async () => {
  const controller = new AbortController();
  const { ports, state, calls } = harness({
    execute: async () => {
      controller.abort();
      throw Object.assign(new Error("cancelled"), { code: "VES_EXECUTOR_CANCELLED" });
    }
  });
  const outcome = await new TaskRunCoordinator(ports).run(input({ signal: controller.signal }));
  assert.deepEqual(outcome, { status: "ABORTED", reason: "VES_EXECUTOR_CANCELLED" });
  assert.equal(state().state, "ABORTED");
  assert.equal(calls.released, 1);
});

test("an executor failure fails the run with the executor's stable code", async () => {
  const { ports, state } = harness({
    execute: async () => {
      throw Object.assign(new Error("denied"), { code: "VES_EXECUTOR_APPROVAL_INVALID" });
    }
  });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.deepEqual(outcome, { status: "FAILED", reason: "VES_EXECUTOR_APPROVAL_INVALID" });
  assert.equal(state().state, "FAILED");
});

// invariant: the reason a failed run records names the cause. The public code
// `VES_TASK_FAILED` is not promoted: its `reason` safe detail is what the run
// records, and only for that code. An executor or node error records the
// stable code its driver reported, and any other error records its own.
const publicFailure = (code, safeDetails) =>
  Object.assign(new Error("private message"), { code, envelope: { code, safeDetails } });

for (const [label, error, reason] of [
  [
    "an executor error that carries its driver's code",
    Object.assign(new Error("driver"), { code: "VES_EXECUTOR_DRIVER_FAILED", reason: "VES_CODEX_MODEL_UNAVAILABLE" }),
    "VES_CODEX_MODEL_UNAVAILABLE"
  ],
  [
    "a node error that carries its driver's code",
    Object.assign(new Error("node"), { code: "VES_COORDINATION_NODE_FAILED", reason: "VES_CLAUDE_PROCESS_FAILED" }),
    "VES_CLAUDE_PROCESS_FAILED"
  ],
  [
    "an executor error whose carried reason is no stable code",
    Object.assign(new Error("driver"), { code: "VES_EXECUTOR_DRIVER_FAILED", reason: "model is gone" }),
    "VES_EXECUTOR_DRIVER_FAILED"
  ],
  [
    "a public task failure that names its reason",
    publicFailure("VES_TASK_FAILED", { reason: "VES_CODEX_MODEL_UNAVAILABLE" }),
    "VES_CODEX_MODEL_UNAVAILABLE"
  ],
  [
    "a public task failure whose reason is no stable code",
    publicFailure("VES_TASK_FAILED", { reason: "model is gone" }),
    "VES_TASK_FAILED"
  ],
  ["a public task failure with no reason", publicFailure("VES_TASK_FAILED", {}), "VES_TASK_FAILED"],
  [
    "another public error whose detail is named reason",
    publicFailure("VES_TASK_STATE_INVALID", { reason: "VES_CODEX_MODEL_UNAVAILABLE" }),
    "VES_TASK_STATE_INVALID"
  ]
]) {
  test(`${label} fails the run with ${reason}, from the implementer and from the verifier`, async () => {
    const implementing = harness({
      execute: async () => {
        throw error;
      }
    });
    assert.deepEqual(await new TaskRunCoordinator(implementing.ports).run(input()), { status: "FAILED", reason });
    assert.equal(implementing.state().state, "FAILED");
    const verifying = verifierRaising(error);
    assert.deepEqual(await new TaskRunCoordinator(verifying.ports).run(input()), { status: "FAILED", reason });
    assert.equal(verifying.state().state, "FAILED");
  });
}

test("a failed verification requests repair and never reaches human review", async () => {
  const { ports, state } = harness({ verdict: "FAIL" });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.equal(outcome.status, "VERIFICATION_FAILED");
  assert.equal(outcome.state, "REPAIRING");
  assert.equal(state().state, "REPAIRING");
});

test("a run outside the startable states is refused before any port is touched", async () => {
  for (const state of ["AWAITING_EXECUTION_APPROVAL", "HUMAN_REVIEW", "COMPLETED", "ABORTED"]) {
    const { calls, ports } = harness({ snapshot: snapshot(state) });
    await assert.rejects(new TaskRunCoordinator(ports).run(input()), { code: "VES_TASK_RUN_STATE_INVALID" });
    assert.deepEqual([calls.commands.length, calls.executed, calls.released], [0, 0, 0]);
  }
});

test("resuming an escalated run never buys the attempts the escalation point withheld", async () => {
  const policy = { maxAttempts: 3, feedbackToDriver: false, escalateAfter: 1 };
  const { ports, calls } = harness({ gateResults: ["fail", "pass"] });
  const first = await new TaskRunCoordinator(ports).run(input({ onGateFailure: policy }));
  assert.equal(first.status, "ESCALATED");
  assert.equal(calls.executed, 1);
  const resumed = await new TaskRunCoordinator(ports).run(input({ onGateFailure: policy }));
  assert.equal(resumed.status, "ESCALATED");
  assert.equal(calls.executed, 1);
  assert.equal(calls.committed, 1);
});

// invariant: SSI-60 and SSI-64 (AD-071). A suspended execution ends the run
// SUSPENDED with no workflow command after the start of implementation: the
// run stays IMPLEMENTING, nothing is released, no gate runs, and the attempt
// is neither counted nor sealed, so a resume runs the same attempt again.
test("a suspended execution ends the run SUSPENDED in IMPLEMENTING with nothing released", async () => {
  const suspension = Object.freeze({
    reason: "VES_DRIVER_QUOTA_EXHAUSTED",
    provider: "claude-code",
    at: "2026-10-03T12:00:00.000Z",
    scope: "five_hour"
  });
  const persisted = {};
  const { calls, ports, state } = harness({
    persisted,
    execute: async () => {
      throw Object.assign(new Error("suspended"), { code: "VES_EXECUTOR_SUSPENDED", suspension });
    }
  });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.deepEqual(outcome, { status: "SUSPENDED", suspension });
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(state().state, "IMPLEMENTING");
  assert.deepEqual(calls.commands, ["START_IMPLEMENTATION"]);
  assert.deepEqual([calls.released, calls.committed, calls.verified, calls.sealed ?? 0], [0, 0, 0, 0]);
  assert.deepEqual(persisted.state, { stage: "repair", attempts: 0, attemptCapsuleDigests: [], budgetLedger: null });
});

test("an error that names the suspension code without its record is a failure, not a suspension", async () => {
  const { ports, state } = harness({
    execute: async () => {
      throw Object.assign(new Error("suspended"), { code: "VES_EXECUTOR_SUSPENDED" });
    }
  });
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.deepEqual(outcome, { status: "FAILED", reason: "VES_EXECUTOR_SUSPENDED" });
  assert.equal(state().state, "FAILED");
});

// invariant: SSI-39 and SSI-68, with a clock the test controls. The run's one
// ledger carries usage and active time across a suspension: the spend at the
// moment of suspension is saved, and the meter of the resumed run continues
// from it, so the hours the run spent suspended are never counted.
test("budget continuity across a suspension: tokens accumulate and suspended time is not counted", async () => {
  let now = 1_000_000;
  const budgets = { maximumCostUsd: 1, maximumTokens: 10_000, maximumDurationMs: 600_000 };
  const priceTable = { version: "test", models: {} };
  const budget = {
    create: (resume) =>
      createBudgetMeter({ budgets, priceTable, unbilledModels: ["claude-sonnet-5"], now: () => now, resume })
  };
  const suspension = { reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "claude-code", at: "2026-10-03T12:00:00.000Z" };
  const persisted = {};
  const first = harness({
    persisted,
    budget,
    execute: async ({ budgetMeter }) => {
      now += 2_000;
      budgetMeter.recordUsage({ model: "claude-sonnet-5", inputTokens: 30, outputTokens: 10 });
      throw Object.assign(new Error("suspended"), { code: "VES_EXECUTOR_SUSPENDED", suspension });
    }
  });
  assert.equal((await new TaskRunCoordinator(first.ports).run(input())).status, "SUSPENDED");
  assert.deepEqual(persisted.state.budgetLedger, {
    consumedCostUsd: 0,
    consumedTokens: 40,
    consumedDurationMs: 2_000,
    usageEvents: 1,
    stopReason: null,
    unbilledTokens: 40
  });
  // why: five hours pass while the run waits for its owner.
  now += 5 * 60 * 60 * 1000;
  let resumedAt;
  const second = harness({
    persisted,
    snapshot: snapshot("IMPLEMENTING"),
    budget,
    execute: async ({ budgetMeter }) => {
      resumedAt = budgetMeter.consumedDurationMs();
      now += 500;
      budgetMeter.recordUsage({ model: "claude-sonnet-5", inputTokens: 20, outputTokens: 5 });
      return execution;
    }
  });
  assert.equal((await new TaskRunCoordinator(second.ports).run(input())).status, "HUMAN_REVIEW");
  assert.equal(resumedAt, 2_000, "the resumed meter counted the time the run was suspended");
  assert.deepEqual(persisted.state.budgetLedger, {
    consumedCostUsd: 0,
    consumedTokens: 65,
    consumedDurationMs: 2_500,
    usageEvents: 2,
    stopReason: null,
    unbilledTokens: 65
  });
  assert.equal(persisted.state.attempts, 1, "the suspended attempt and its resumption are one attempt");
});

// invariant: D3b and SSI-60 for the verifier. A suspension the verifier's
// provider raised ends the run SUSPENDED in VERIFYING: no workflow command
// after verification started, the task commit kept, and the writer
// coordination released, so a resume verifies again. A verifier error that is
// no suspension, or a suspension after the command was cancelled, ends the run
// as before.
function verifierRaising(error) {
  const run = harness();
  run.ports.verification.verify = async () => {
    run.calls.verified += 1;
    throw error;
  };
  return run;
}

test("a suspension raised by the verifier ends the run SUSPENDED in VERIFYING, released", async () => {
  const suspension = Object.freeze({
    reason: "VES_CODEX_CREDITS_PRESENT",
    provider: "codex",
    at: "2026-10-04T12:00:00.000Z"
  });
  const { calls, ports, state } = verifierRaising(
    Object.assign(new Error("suspended"), { code: "VES_EXECUTOR_SUSPENDED", suspension })
  );
  const outcome = await new TaskRunCoordinator(ports).run(input());
  assert.deepEqual(outcome, { status: "SUSPENDED", suspension });
  assert.equal(Object.isFrozen(outcome), true);
  assert.equal(state().state, "VERIFYING");
  assert.deepEqual(calls.commands, ["START_IMPLEMENTATION", "START_VERIFICATION"]);
  assert.deepEqual([calls.committed, calls.verified, calls.released], [1, 1, 1]);
});

test("a verifier error that is no suspension, or a suspension after a cancel, does not suspend the run", async () => {
  const failing = verifierRaising(Object.assign(new Error("failed"), { code: "VES_TASK_VERIFIER_FAILED" }));
  assert.deepEqual(await new TaskRunCoordinator(failing.ports).run(input()), {
    status: "FAILED",
    reason: "VES_TASK_VERIFIER_FAILED"
  });
  assert.equal(failing.state().state, "FAILED");
  const controller = new AbortController();
  const suspension = { reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "codex", at: "2026-10-04T12:00:00.000Z" };
  const cancelled = harness();
  cancelled.ports.verification.verify = async () => {
    controller.abort();
    throw Object.assign(new Error("suspended"), { code: "VES_EXECUTOR_SUSPENDED", suspension });
  };
  const outcome = await new TaskRunCoordinator(cancelled.ports).run(input({ signal: controller.signal }));
  assert.deepEqual(outcome, { status: "ABORTED", reason: "VES_EXECUTOR_CANCELLED" });
  assert.equal(cancelled.state().state, "ABORTED");
});
