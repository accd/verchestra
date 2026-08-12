import assert from "node:assert/strict";
import { test } from "node:test";

import { coordinator, digest, gateInput, gatePlan, gatePorts } from "../helpers/gate-commit-fixture.mjs";

test("all declared gates produce one atomic commit then cleanup and release", async () => {
  const { state, ports } = gatePorts();
  const result = await coordinator(ports).execute(gateInput());
  assert.equal(result.status, "COMMITTED");
  assert.equal(result.commitId, "b".repeat(40));
  assert.equal(state.commits.length, 1);
  assert.equal(state.cleaned, true);
  assert.equal(state.released, true);
});

test("gate transaction ordering keeps commit after evidence and stable post-inspection", async () => {
  const { state, ports } = gatePorts();
  await coordinator(ports).execute(gateInput());
  assert.deepEqual(state.calls, [
    "authority",
    "coordination:verify",
    "inspect",
    "authority",
    "coordination:verify",
    "gate:gate:typecheck",
    "evidence:gate:typecheck",
    "authority",
    "coordination:verify",
    "gate:gate:test",
    "evidence:gate:test",
    "inspect",
    "checkpoint:gates-passed",
    "authority",
    "coordination:verify",
    "commit",
    "checkpoint:committed",
    "cleanup",
    "release"
  ]);
});

test("commit request contains exact task requirements and deterministic trailers", async () => {
  const { state, ports } = gatePorts();
  await coordinator(ports).execute(gateInput());
  const request = state.commits[0];
  assert.deepEqual(request.requirementIds, ["VES-EXE-006", "VES-SPC-003", "VES-VFY-001", "VES-VFY-002"]);
  assert.equal(request.subject, "feat(execution): add gates and atomic commits");
  assert.match(request.idempotencyKey, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(request.expectedChangeDigest, "sha256:" + "5".repeat(64));
});

test("gate evidence binds each command to its covered requirements", async () => {
  const { state, ports } = gatePorts();
  const result = await coordinator(ports).execute(gateInput());
  assert.equal(result.gateEvidenceRefs.length, 2);
  assert.deepEqual(state.evidence[0].requirementIds, ["VES-VFY-001"]);
  assert.equal(state.evidence[1].tests.passed, 30);
});

test("runner receives command reference and argv without a shell command string", async () => {
  let observed;
  const { ports } = gatePorts({ gates: { run: async (command) => ((observed ??= command), pass(command)) } });
  await coordinator(ports).execute(gateInput());
  assert.equal(observed.commandRef, "command:pnpm");
  assert.deepEqual(observed.args, ["typecheck"]);
  assert.equal("shell" in observed, false);
});

test("non-test gate passes solely through bounded exit evidence", async () => {
  const { state, ports } = gatePorts();
  await coordinator(ports).execute(gateInput());
  assert.equal("tests" in state.evidence[0], false);
});

test("gates-passed checkpoint is durable before the commit effect", async () => {
  const { state, ports } = gatePorts();
  await coordinator(ports).execute(gateInput());
  assert.ok(state.calls.indexOf("checkpoint:gates-passed") < state.calls.indexOf("commit"));
});

test("already committed reconciliation skips gates and converges cleanup", async () => {
  const input = gateInput();
  const prior = {
    stage: "commit-uncertain",
    workspaceId: input.workspaceId,
    runId: input.runId,
    taskId: input.task.taskId,
    gatePlanDigest: input.gatePlan.planDigest,
    changeDigest: input.execution.changeDigest,
    gateEvidenceDigest: "sha256:" + "8".repeat(64),
    gateEvidenceRefs: ["evidence:gate:typecheck", "evidence:gate:test"]
  };
  const { state, ports } = gatePorts({
    checkpoints: { load: async () => prior },
    git: {
      reconcile: async (request) => ({
        status: "already-committed",
        commitId: "b".repeat(40),
        parentCommit: request.baseCommit,
        changeDigest: request.expectedChangeDigest,
        gateEvidenceDigest: request.gateEvidenceDigest,
        idempotencyKey: request.idempotencyKey
      })
    }
  });
  const result = await coordinator(ports).execute(input);
  assert.equal(result.status, "COMMITTED");
  assert.equal(result.commitStatus, "already-committed");
  assert.equal(state.gateRuns, 0);
  assert.equal(state.cleaned, true);
});

test("zero-change execution cannot manufacture a completion commit", async () => {
  const input = gateInput();
  input.execution.changedPaths = [];
  input.execution.changeDigest = digest("[]");
  const { state, ports } = gatePorts({
    worktrees: { inspect: async () => ({ changedPaths: [], changeDigest: digest("[]"), commitCountSinceBase: 0 }) }
  });
  await assert.rejects(coordinator(ports).execute(input), { code: "VES_GATE_NO_CHANGES" });
  assert.equal(state.commits.length, 0);
});

test("equivalent gate plan digest is deterministic", () => {
  assert.equal(gatePlan().planDigest, gatePlan().planDigest);
});

// Issue #58: the gate plan digest, idempotency key, and checkpoint digests
// must not depend on the machine's ambient locale.
test("gate plan digest and a full committed idempotency key are byte-identical under two different ambient locales", async () => {
  const priorLang = process.env.LANG;
  const priorLcAll = process.env.LC_ALL;
  try {
    process.env.LANG = "en_US.UTF-8";
    process.env.LC_ALL = "en_US.UTF-8";
    const firstPlanDigest = gatePlan().planDigest;
    const first = await coordinator(gatePorts().ports).execute(gateInput());
    process.env.LANG = "fr_FR.UTF-8";
    process.env.LC_ALL = "fr_FR.UTF-8";
    const secondPlanDigest = gatePlan().planDigest;
    const second = await coordinator(gatePorts().ports).execute(gateInput());
    assert.equal(firstPlanDigest, secondPlanDigest);
    assert.equal(first.idempotencyKey, second.idempotencyKey);
    assert.equal(first.gateEvidenceDigest, second.gateEvidenceDigest);
  } finally {
    if (priorLang === undefined) delete process.env.LANG;
    else process.env.LANG = priorLang;
    if (priorLcAll === undefined) delete process.env.LC_ALL;
    else process.env.LC_ALL = priorLcAll;
  }
});

function pass(command) {
  return {
    exitCode: 0,
    timedOut: false,
    outputLimitExceeded: false,
    stdoutDigest: digest("stdout"),
    stderrDigest: digest(""),
    stdoutBytes: 1,
    stderrBytes: 0,
    outputRef: "output:override",
    ...(command.resultProtocol === "test-summary"
      ? { tests: { total: 30, passed: 30, failed: 0, skipped: 0, cancelled: 0, todo: 0 } }
      : {})
  };
}
