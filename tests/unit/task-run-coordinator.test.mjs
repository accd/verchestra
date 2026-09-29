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
  const persisted = {};
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
      sealAttempt: async (input) => ({ capsuleDigest: digestOf(input.attempt) }),
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
