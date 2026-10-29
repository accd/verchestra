import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { WorkflowMachine } from "../../packages/domain/src/index.ts";
import { capsuleHarness, capsuleInput } from "../helpers/run-capsule-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

const bindingDigest = `sha256:${"a".repeat(64)}`;
const KIND_MISMATCH = { accepted: false, code: "VES_WORKFLOW_RUN_KIND_MISMATCH" };

// why: every state a run reaches here carries what its own edge asks for, so a
// refusal can only come from the run's kind.
function snapshot(runKind, state) {
  const approved = ["EXECUTION_AUTHORIZED", "IMPLEMENTING", "VERIFYING", "REPAIRING", "HUMAN_REVIEW"].includes(state);
  return {
    runId: "run_018f0b6d-7b1a-7abc-8def-0123456789ab",
    runKind,
    state,
    version: 3,
    repairCycles: 0,
    approval: approved ? { bindingDigest } : undefined,
    ...(["IMPLEMENTING", "VERIFYING", "REPAIRING", "HUMAN_REVIEW"].includes(state)
      ? { implementationActorId: "actor:implementer" }
      : {}),
    terminalCapsuleRequired: false
  };
}

function command(type, actorRole) {
  return {
    type,
    expectedVersion: 3,
    actorRole,
    actorId: `actor:${actorRole}-on-duty`,
    evidence: [
      "execution-approval",
      "writer-lease",
      "task-gate-evidence",
      "verification-evidence",
      "human-review-record",
      "signed-package",
      "terminal-error-evidence",
      "recovery-evidence",
      "probe-result"
    ],
    currentBindingDigest: bindingDigest,
    approvalBindingDigest: bindingDigest
  };
}

// The events a probe run refuses, each in the state where its edge exists and
// with the actor that edge names, beside the run kind that takes it there.
const REFUSED_FOR_A_PROBE_RUN = [
  ["START_IMPLEMENTATION", "EXECUTION_AUTHORIZED", "implementer", "feature"],
  ["START_VERIFICATION", "IMPLEMENTING", "implementer", "feature"],
  ["REQUEST_REPAIR", "VERIFYING", "verifier", "feature"],
  ["PASS_VERIFICATION", "VERIFYING", "verifier", "feature"],
  ["APPROVE_HUMAN_REVIEW", "HUMAN_REVIEW", "human", "feature"],
  ["PREPARE_HANDOFF", "EXECUTION_AUTHORIZED", "controller", "feature"],
  ["COMPLETE_RECOVERY", "EXECUTION_AUTHORIZED", "recovery", "recovery"]
];

test("the workflow completes a probe run only through COMPLETE_PROBE", () => {
  const completed = WorkflowMachine.decide(
    snapshot("probe", "EXECUTION_AUTHORIZED"),
    command("COMPLETE_PROBE", "controller")
  );
  assert.equal(completed.accepted, true);
  assert.equal(completed.previousState, "EXECUTION_AUTHORIZED");
  assert.equal(completed.nextState, "COMPLETED");
  assert.equal(completed.snapshot.runKind, "probe");
  assert.equal(completed.events[0].type, "COMPLETE_PROBE_ACCEPTED");

  for (const runKind of ["feature", "recovery"]) {
    assert.deepEqual(
      WorkflowMachine.decide(snapshot(runKind, "EXECUTION_AUTHORIZED"), command("COMPLETE_PROBE", "controller")),
      KIND_MISMATCH,
      `COMPLETE_PROBE for a ${runKind} run`
    );
  }
  assert.deepEqual(
    WorkflowMachine.decide(snapshot("probe", "AWAITING_EXECUTION_APPROVAL"), command("COMPLETE_PROBE", "controller")),
    { accepted: false, code: "VES_WORKFLOW_COMMAND_REJECTED" }
  );

  for (const [type, state, actorRole, acceptingKind] of REFUSED_FOR_A_PROBE_RUN) {
    const otherwise = WorkflowMachine.decide(snapshot(acceptingKind, state), command(type, actorRole));
    assert.equal(otherwise.accepted, true, `${type} from ${state} is accepted for a ${acceptingKind} run`);
    assert.deepEqual(
      WorkflowMachine.decide(snapshot("probe", state), command(type, actorRole)),
      KIND_MISMATCH,
      `${type} from ${state} for a probe run`
    );
  }
});

// why: not a check's proof. The probe command moves its run through these
// events, so the kind guard must not refuse them.
test("a probe run is approved, failed, aborted or interrupted like any run", () => {
  const authorized = WorkflowMachine.decide(
    snapshot("probe", "AWAITING_EXECUTION_APPROVAL"),
    command("GRANT_EXECUTION_APPROVAL", "human")
  );
  assert.equal(authorized.nextState, "EXECUTION_AUTHORIZED");
  const requested = WorkflowMachine.decide(
    { ...snapshot("probe", "EXECUTION_READY"), approval: undefined },
    { ...command("REQUEST_EXECUTION_APPROVAL", "controller"), evidence: ["execution-package"] }
  );
  assert.equal(requested.nextState, "AWAITING_EXECUTION_APPROVAL");
  for (const state of ["AWAITING_EXECUTION_APPROVAL", "EXECUTION_AUTHORIZED"]) {
    for (const [type, actorRole, nextState] of [
      ["FAIL", "controller", "FAILED"],
      ["ABORT", "human", "ABORTED"],
      ["INTERRUPT", "controller", "INTERRUPTED"]
    ]) {
      const decision = WorkflowMachine.decide(snapshot("probe", state), command(type, actorRole));
      assert.equal(decision.nextState, nextState, `${type} from ${state}`);
    }
  }
  assert.deepEqual(
    WorkflowMachine.decide(
      snapshot("probe", "EXECUTION_AUTHORIZED"),
      command("INVALIDATE_EXECUTION_APPROVAL", "human")
    ),
    KIND_MISMATCH
  );
});

test("the run capsule accepts a probe run", async () => {
  const { builder } = capsuleHarness();
  for (const status of ["FAILED", "ABORTED"]) {
    const input = capsuleInput(status, "low", {
      runKind: "probe",
      terminalTransition: { ...capsuleInput(status).terminalTransition, fromState: "EXECUTION_AUTHORIZED" }
    });
    const capsule = await builder.build(input);
    assert.equal(capsule.payload.runKind, "probe", status);
    assert.equal(capsule.payload.status, status);
  }
  await assert.rejects(builder.build(capsuleInput("FAILED", "low", { runKind: "maintenance" })), {
    code: "VES_RUN_CAPSULE_INVALID",
    message: "Run kind is invalid"
  });
});

// why: a run the store holds, moved through the workflow as the commands move
// it, one decided transition at a time.
function persisted(store, runKind, runId) {
  let current = { ...snapshot(runKind, "EXECUTION_READY"), runId, version: 0, approval: undefined };
  store.createRun(current);
  return (type, actorRole, evidence) => {
    const decision = WorkflowMachine.decide(current, {
      ...command(type, actorRole),
      expectedVersion: current.version,
      ...(evidence === undefined ? {} : { evidence })
    });
    assert.equal(decision.accepted, true, `${type} for a ${runKind} run: ${decision.code}`);
    store.applyTransition(runId, decision, {
      eventId: `event-${runId}-${decision.version}`,
      payloadDigest: "a".repeat(64),
      actor: { kind: actorRole, id: `actor:${actorRole}` },
      occurredAt: "2026-07-13T12:00:00.000Z"
    });
    current = decision.snapshot;
    return decision;
  };
}

test("a probe run needs no terminal capsule", async () => {
  for (const [type, actorRole, nextState] of [
    ["COMPLETE_PROBE", "controller", "COMPLETED"],
    ["FAIL", "controller", "FAILED"],
    ["ABORT", "human", "ABORTED"]
  ]) {
    const decision = WorkflowMachine.decide(snapshot("probe", "EXECUTION_AUTHORIZED"), command(type, actorRole));
    assert.equal(decision.nextState, nextState, type);
    assert.equal(decision.snapshot.terminalCapsuleRequired, false, `${type} of a probe run`);
    assert.deepEqual(
      decision.events.map((event) => event.type),
      [`${type}_ACCEPTED`],
      `${type} of a probe run requests no capsule`
    );
  }
  const featureFailed = WorkflowMachine.decide(
    snapshot("feature", "EXECUTION_AUTHORIZED"),
    command("FAIL", "controller")
  );
  assert.equal(featureFailed.snapshot.terminalCapsuleRequired, true, "FAIL of a feature run");
  assert.deepEqual(
    featureFailed.events.map((event) => event.type),
    ["FAIL_ACCEPTED", "TERMINAL_CAPSULE_REQUESTED"]
  );

  const { store } = await opened();
  const completed = persisted(store, "probe", "run_018f0b6d-7b1a-7abc-8def-00000000000a");
  completed("REQUEST_EXECUTION_APPROVAL", "controller", ["execution-package"]);
  completed("GRANT_EXECUTION_APPROVAL", "human");
  completed("COMPLETE_PROBE", "controller");
  const aborted = persisted(store, "probe", "run_018f0b6d-7b1a-7abc-8def-00000000000b");
  aborted("REQUEST_EXECUTION_APPROVAL", "controller", ["execution-package"]);
  aborted("ABORT", "human");
  const failed = persisted(store, "feature", "run_018f0b6d-7b1a-7abc-8def-00000000000c");
  failed("REQUEST_EXECUTION_APPROVAL", "controller", ["execution-package"]);
  failed("FAIL", "controller");
  assert.equal(store.getRun("run_018f0b6d-7b1a-7abc-8def-00000000000a").state, "COMPLETED");
  assert.equal(store.getRun("run_018f0b6d-7b1a-7abc-8def-00000000000b").state, "ABORTED");
  assert.deepEqual(
    store.listUnsealedTerminalRuns().map((run) => [run.runId, run.runKind, run.status]),
    [["run_018f0b6d-7b1a-7abc-8def-00000000000c", "feature", "FAILED"]],
    "only the ended feature run owes a capsule"
  );
});
