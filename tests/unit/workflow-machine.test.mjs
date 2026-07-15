import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WORKFLOW_COMMANDS,
  WORKFLOW_DEFINITION,
  WORKFLOW_STATES,
  WorkflowMachine,
  createHandoffSuccessor,
  validateWorkflowDefinition,
  workflowPublicErrorRegistry
} from "../../packages/domain/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";

const ACTIVE_STATES = [
  "CREATED",
  "INTAKE_REQUIRED",
  "READY",
  "DISCOVERY_REQUIRED",
  "RECONNING",
  "SPECIFYING",
  "SPEC_REVIEW",
  "DESIGNING",
  "DESIGN_REVIEW",
  "TASKING",
  "EXECUTION_READY",
  "AWAITING_EXECUTION_APPROVAL",
  "EXECUTION_AUTHORIZED",
  "IMPLEMENTING",
  "VERIFYING",
  "REPAIRING",
  "HUMAN_RESOLUTION_REQUIRED",
  "HUMAN_REVIEW",
  "HANDOFF_PREPARING",
  "AWAITING_HANDOFF_PUBLICATION_APPROVAL"
];
const TERMINAL_STATES = ["COMPLETED", "HANDED_OFF", "FAILED", "ABORTED", "INTERRUPTED", "RECOVERED"];
const COMMANDS = [
  "REQUIRE_INTAKE",
  "READY_WITHOUT_INTAKE",
  "COMPLETE_INTAKE",
  "REQUIRE_DISCOVERY",
  "START_RECONNAISSANCE",
  "START_SPECIFICATION",
  "SUBMIT_SPEC_REVIEW",
  "APPROVE_SPEC",
  "SUBMIT_DESIGN_REVIEW",
  "APPROVE_DESIGN",
  "COMPLETE_TASKING",
  "REQUEST_EXECUTION_APPROVAL",
  "GRANT_EXECUTION_APPROVAL",
  "START_IMPLEMENTATION",
  "START_VERIFICATION",
  "REQUEST_REPAIR",
  "COMPLETE_REPAIR",
  "RESOLVE_REPAIR",
  "PASS_VERIFICATION",
  "APPROVE_HUMAN_REVIEW",
  "PREPARE_HANDOFF",
  "REQUEST_HANDOFF_PUBLICATION_APPROVAL",
  "COMPLETE_HANDOFF",
  "INVALIDATE_EXECUTION_APPROVAL",
  "FAIL",
  "ABORT",
  "INTERRUPT",
  "COMPLETE_RECOVERY",
  "EXPAND_REPAIR_SCOPE"
];

const bindingDigest = `sha256:${"a".repeat(64)}`;

function snapshot(state, overrides = {}) {
  return {
    runId: "run_018f0b6d-7b1a-7abc-8def-0123456789ab",
    runKind: "feature",
    state,
    version: 7,
    repairCycles: 0,
    approval:
      state === "EXECUTION_AUTHORIZED" || ["IMPLEMENTING", "VERIFYING", "REPAIRING"].includes(state)
        ? { bindingDigest }
        : undefined,
    implementationActorId: ["IMPLEMENTING", "VERIFYING", "REPAIRING"].includes(state) ? "actor:implementer" : undefined,
    ...overrides
  };
}

function command(type, overrides = {}) {
  return {
    type,
    expectedVersion: 7,
    actorRole: "controller",
    actorId: "actor:controller",
    evidence: [
      "intake-record",
      "discovery-report",
      "specification",
      "spec-review",
      "design",
      "design-review",
      "execution-package",
      "execution-approval",
      "writer-lease",
      "task-gate-evidence",
      "verification-evidence",
      "repair-evidence",
      "human-resolution",
      "human-review-record",
      "signed-package",
      "handoff-publication-approval",
      "handoff-publication-receipt",
      "terminal-error-evidence",
      "recovery-evidence"
    ],
    currentBindingDigest: bindingDigest,
    approvalBindingDigest: bindingDigest,
    publicationRequired: false,
    ...overrides
  };
}

test("workflow state and command vocabularies are exact and stable", () => {
  assert.deepEqual(WORKFLOW_STATES, [...ACTIVE_STATES, ...TERMINAL_STATES]);
  assert.deepEqual(WORKFLOW_COMMANDS, COMMANDS);
});

test("workflow decision is referentially transparent and does not mutate inputs", () => {
  const current = snapshot("TASKING");
  const requested = command("COMPLETE_TASKING");
  const currentBefore = structuredClone(current);
  const requestedBefore = structuredClone(requested);
  assert.deepEqual(WorkflowMachine.decide(current, requested), WorkflowMachine.decide(current, requested));
  assert.deepEqual(current, currentBefore);
  assert.deepEqual(requested, requestedBefore);
});

test("accepted decisions, snapshots, and event lists are immutable", () => {
  const decision = WorkflowMachine.decide(snapshot("TASKING"), command("COMPLETE_TASKING"));
  assert.equal(decision.accepted, true);
  assert.equal(Object.isFrozen(decision), true);
  assert.equal(Object.isFrozen(decision.snapshot), true);
  assert.equal(Object.isFrozen(decision.events), true);
});

for (const state of [...ACTIVE_STATES, ...TERMINAL_STATES]) {
  for (const type of COMMANDS) {
    test(`total decision: ${state} × ${type}`, () => {
      const decision = WorkflowMachine.decide(snapshot(state), command(type));
      assert.equal(typeof decision.accepted, "boolean");
      if (decision.accepted) {
        assert.equal(decision.previousState, state);
        assert.equal(decision.version, 8);
        assert.ok(WORKFLOW_STATES.includes(decision.nextState));
        assert.ok(decision.events.length >= 1);
      } else {
        assert.match(decision.code, /^VES_WORKFLOW_[A-Z_]+$/u);
      }
    });
  }
}

test("canonical happy path cannot skip execution approval or human review", () => {
  const steps = [
    ["READY_WITHOUT_INTAKE", "READY"],
    ["START_SPECIFICATION", "SPECIFYING"],
    ["SUBMIT_SPEC_REVIEW", "SPEC_REVIEW"],
    ["APPROVE_SPEC", "DESIGNING", "human"],
    ["SUBMIT_DESIGN_REVIEW", "DESIGN_REVIEW"],
    ["APPROVE_DESIGN", "TASKING", "human"],
    ["COMPLETE_TASKING", "EXECUTION_READY"],
    ["REQUEST_EXECUTION_APPROVAL", "AWAITING_EXECUTION_APPROVAL"],
    ["GRANT_EXECUTION_APPROVAL", "EXECUTION_AUTHORIZED", "human"],
    ["START_IMPLEMENTATION", "IMPLEMENTING", "implementer"],
    ["START_VERIFICATION", "VERIFYING", "implementer"],
    ["PASS_VERIFICATION", "HUMAN_REVIEW", "verifier"],
    ["APPROVE_HUMAN_REVIEW", "COMPLETED", "human"]
  ];
  let current = snapshot("CREATED", { version: 0 });
  for (const [type, nextState, actorRole = "controller"] of steps) {
    const decision = WorkflowMachine.decide(
      current,
      command(type, {
        expectedVersion: current.version,
        actorRole,
        actorId: `actor:${actorRole}`
      })
    );
    assert.equal(decision.accepted, true, `${type} must be accepted`);
    assert.equal(decision.nextState, nextState);
    current = { ...current, ...decision.snapshot };
  }
  assert.equal(current.state, "COMPLETED");
  assert.equal(current.terminalCapsuleRequired, true);
});

test("stale expected version rejects every command before transition logic", () => {
  for (const state of WORKFLOW_STATES) {
    for (const type of WORKFLOW_COMMANDS) {
      assert.deepEqual(WorkflowMachine.decide(snapshot(state), command(type, { expectedVersion: 6 })), {
        accepted: false,
        code: "VES_WORKFLOW_VERSION_CONFLICT"
      });
    }
  }
});

test("implementation cannot start from EXECUTION_READY", () => {
  assert.deepEqual(WorkflowMachine.decide(snapshot("EXECUTION_READY"), command("START_IMPLEMENTATION")), {
    accepted: false,
    code: "VES_WORKFLOW_COMMAND_REJECTED"
  });
});

test("granting approval requires a human actor", () => {
  assert.deepEqual(
    WorkflowMachine.decide(snapshot("AWAITING_EXECUTION_APPROVAL"), command("GRANT_EXECUTION_APPROVAL")),
    { accepted: false, code: "VES_WORKFLOW_ACTOR_DENIED" }
  );
});

test("granting approval binds the exact current execution digest", () => {
  const decision = WorkflowMachine.decide(
    snapshot("AWAITING_EXECUTION_APPROVAL"),
    command("GRANT_EXECUTION_APPROVAL", { actorRole: "human" })
  );
  assert.equal(decision.accepted, true);
  assert.deepEqual(decision.snapshot.approval, { bindingDigest });
});

test("approval with a stale binding is rejected", () => {
  assert.deepEqual(
    WorkflowMachine.decide(
      snapshot("AWAITING_EXECUTION_APPROVAL"),
      command("GRANT_EXECUTION_APPROVAL", {
        actorRole: "human",
        approvalBindingDigest: `sha256:${"b".repeat(64)}`
      })
    ),
    { accepted: false, code: "VES_WORKFLOW_APPROVAL_STALE" }
  );
});

test("effect-time binding drift invalidates execution approval", () => {
  const decision = WorkflowMachine.decide(
    snapshot("EXECUTION_AUTHORIZED"),
    command("START_IMPLEMENTATION", {
      actorRole: "implementer",
      currentBindingDigest: `sha256:${"b".repeat(64)}`
    })
  );
  assert.equal(decision.accepted, true);
  assert.equal(decision.nextState, "AWAITING_EXECUTION_APPROVAL");
  assert.equal(decision.snapshot.approval, undefined);
  assert.equal(decision.events[0].type, "EXECUTION_APPROVAL_INVALIDATED");
});

test("explicit bound-field change invalidates approval from every mutable execution state", () => {
  for (const state of ["EXECUTION_AUTHORIZED", "IMPLEMENTING", "VERIFYING", "REPAIRING"]) {
    const decision = WorkflowMachine.decide(snapshot(state), command("INVALIDATE_EXECUTION_APPROVAL"));
    assert.equal(decision.accepted, true);
    assert.equal(decision.nextState, "AWAITING_EXECUTION_APPROVAL");
    assert.equal(decision.snapshot.approval, undefined);
  }
});

test("repair inside approved scope retains approval for three cycles", () => {
  for (const repairCycles of [0, 1, 2]) {
    const decision = WorkflowMachine.decide(
      snapshot("VERIFYING", { repairCycles }),
      command("REQUEST_REPAIR", { actorRole: "verifier" })
    );
    assert.equal(decision.accepted, true);
    assert.equal(decision.nextState, "REPAIRING");
    assert.equal(decision.snapshot.repairCycles, repairCycles + 1);
    assert.deepEqual(decision.snapshot.approval, { bindingDigest });
  }
});

test("fourth unresolved verification gap automatically requires human resolution", () => {
  const decision = WorkflowMachine.decide(
    snapshot("VERIFYING", { repairCycles: 3 }),
    command("REQUEST_REPAIR", { actorRole: "verifier" })
  );
  assert.equal(decision.accepted, true);
  assert.equal(decision.nextState, "HUMAN_RESOLUTION_REQUIRED");
});

test("human resolution explicitly resets the bounded repair cycle", () => {
  const decision = WorkflowMachine.decide(
    snapshot("HUMAN_RESOLUTION_REQUIRED", { repairCycles: 3 }),
    command("RESOLVE_REPAIR", { actorRole: "human" })
  );
  assert.equal(decision.accepted, true);
  assert.equal(decision.nextState, "REPAIRING");
  assert.equal(decision.snapshot.repairCycles, 0);
});

test("repair scope expansion returns to execution approval", () => {
  const decision = WorkflowMachine.decide(snapshot("REPAIRING"), command("EXPAND_REPAIR_SCOPE"));
  assert.equal(decision.accepted, true);
  assert.equal(decision.nextState, "AWAITING_EXECUTION_APPROVAL");
  assert.equal(decision.snapshot.approval, undefined);
});

test("verifier must be distinct from implementer role", () => {
  assert.deepEqual(
    WorkflowMachine.decide(snapshot("VERIFYING"), command("PASS_VERIFICATION", { actorRole: "implementer" })),
    { accepted: false, code: "VES_WORKFLOW_ACTOR_DENIED" }
  );
});

test("verifier identity must be distinct even when it claims the verifier role", () => {
  assert.deepEqual(
    WorkflowMachine.decide(
      snapshot("VERIFYING"),
      command("PASS_VERIFICATION", { actorRole: "verifier", actorId: "actor:implementer" })
    ),
    { accepted: false, code: "VES_WORKFLOW_AUTHOR_VERIFIER_CONFLICT" }
  );
});

test("human review is the only path to COMPLETED", () => {
  const incoming = WORKFLOW_DEFINITION.filter((edge) => edge.to === "COMPLETED");
  assert.deepEqual(
    incoming.map(({ from, command: type }) => [from, type]),
    [["HUMAN_REVIEW", "APPROVE_HUMAN_REVIEW"]]
  );
});

test("every terminal transition emits capsule-sealing intent", () => {
  for (const type of ["FAIL", "ABORT", "INTERRUPT"]) {
    for (const state of ACTIVE_STATES) {
      const decision = WorkflowMachine.decide(
        snapshot(state),
        command(type, { actorRole: type === "ABORT" ? "human" : "controller" })
      );
      assert.equal(decision.accepted, true);
      assert.equal(decision.snapshot.terminalCapsuleRequired, true);
      assert.equal(decision.events.at(-1).type, "TERMINAL_CAPSULE_REQUESTED");
    }
  }
});

test("terminal states reject every current and future command", () => {
  for (const state of TERMINAL_STATES) {
    for (const type of COMMANDS) {
      assert.deepEqual(WorkflowMachine.decide(snapshot(state), command(type)), {
        accepted: false,
        code: "VES_WORKFLOW_TERMINAL"
      });
    }
  }
});

test("local-only handoff can complete without publication approval", () => {
  const prepared = WorkflowMachine.decide(snapshot("EXECUTION_READY"), command("PREPARE_HANDOFF"));
  assert.equal(prepared.accepted, true);
  const completed = WorkflowMachine.decide(
    { ...snapshot("HANDOFF_PREPARING"), version: prepared.version },
    command("COMPLETE_HANDOFF", { expectedVersion: prepared.version, publicationRequired: false })
  );
  assert.equal(completed.accepted, true);
  assert.equal(completed.nextState, "HANDED_OFF");
  assert.equal(completed.snapshot.terminalCapsuleRequired, true);
});

test("remote handoff cannot bypass publication approval", () => {
  assert.deepEqual(
    WorkflowMachine.decide(snapshot("HANDOFF_PREPARING"), command("COMPLETE_HANDOFF", { publicationRequired: true })),
    { accepted: false, code: "VES_WORKFLOW_HANDOFF_APPROVAL_REQUIRED" }
  );
});

test("handoff preparation discards execution approval", () => {
  const decision = WorkflowMachine.decide(snapshot("EXECUTION_AUTHORIZED"), command("PREPARE_HANDOFF"));
  assert.equal(decision.accepted, true);
  assert.equal(decision.snapshot.approval, undefined);
});

test("handoff preparation binds a valid distinct successor and rejects malformed identity", () => {
  const successorRunId = "run_018f0b6d-7b1a-7abc-8def-1123456789ab";
  const decision = WorkflowMachine.decide(snapshot("EXECUTION_READY"), command("PREPARE_HANDOFF", { successorRunId }));
  assert.equal(decision.accepted, true);
  assert.equal(decision.snapshot.successorRunId, successorRunId);
  assert.deepEqual(
    WorkflowMachine.decide(snapshot("EXECUTION_READY"), command("PREPARE_HANDOFF", { successorRunId: "run:bad" })),
    { accepted: false, code: "VES_WORKFLOW_COMMAND_REJECTED" }
  );
});

test("handoff successor is a new linked run without inherited approval", () => {
  const successor = createHandoffSuccessor({
    source: snapshot("HANDED_OFF", {
      runId: "run_018f0b6d-7b1a-7abc-8def-0123456789ab",
      successorRunId: "run_018f0b6d-7b1a-7abc-8def-1123456789ab"
    }),
    successorRunId: "run_018f0b6d-7b1a-7abc-8def-1123456789ab",
    packageVerified: true,
    sourceStateDigest: bindingDigest,
    packageSourceStateDigest: bindingDigest,
    localBindingsReady: true,
    claimReady: true,
    policyReevaluated: true,
    firstPendingTaskId: "T42"
  });
  assert.equal(successor.state, "EXECUTION_READY");
  assert.equal(successor.version, 0);
  assert.equal(successor.predecessorRunId, "run_018f0b6d-7b1a-7abc-8def-0123456789ab");
  assert.equal(successor.approval, undefined);
});

test("successor rejects unverified package, source drift, reused ID, and non-handoff source", () => {
  const source = snapshot("HANDED_OFF", {
    successorRunId: "run_018f0b6d-7b1a-7abc-8def-1123456789ab"
  });
  const base = {
    source,
    successorRunId: source.successorRunId,
    packageVerified: true,
    sourceStateDigest: bindingDigest,
    packageSourceStateDigest: bindingDigest,
    localBindingsReady: true,
    claimReady: true,
    policyReevaluated: true,
    firstPendingTaskId: "T42"
  };
  assert.throws(() => createHandoffSuccessor({ ...base, packageVerified: false }), {
    code: "VES_WORKFLOW_SUCCESSOR_INVALID"
  });
  assert.throws(() => createHandoffSuccessor({ ...base, packageSourceStateDigest: `sha256:${"b".repeat(64)}` }), {
    code: "VES_WORKFLOW_SUCCESSOR_INVALID"
  });
  assert.throws(() => createHandoffSuccessor({ ...base, successorRunId: source.runId }), {
    code: "VES_WORKFLOW_SUCCESSOR_INVALID"
  });
  assert.throws(() => createHandoffSuccessor({ ...base, source: { ...source, state: "EXECUTION_READY" } }), {
    code: "VES_WORKFLOW_SUCCESSOR_INVALID"
  });
  for (const invalid of [
    { localBindingsReady: false },
    { claimReady: false },
    { policyReevaluated: false },
    { firstPendingTaskId: "" }
  ]) {
    assert.throws(() => createHandoffSuccessor({ ...base, ...invalid }), {
      code: "VES_WORKFLOW_SUCCESSOR_INVALID"
    });
  }
});

test("COMPLETE_RECOVERY is restricted to recovery runs", () => {
  assert.deepEqual(WorkflowMachine.decide(snapshot("READY"), command("COMPLETE_RECOVERY")), {
    accepted: false,
    code: "VES_WORKFLOW_RUN_KIND_MISMATCH"
  });
  const decision = WorkflowMachine.decide(
    snapshot("READY", { runKind: "recovery" }),
    command("COMPLETE_RECOVERY", { actorRole: "recovery" })
  );
  assert.equal(decision.accepted, true);
  assert.equal(decision.nextState, "RECOVERED");
  assert.equal(decision.snapshot.terminalCapsuleRequired, true);
});

const mutations = [
  {
    name: "missing execution approval boundary",
    alter: (edges) => edges.filter((edge) => edge.command !== "REQUEST_EXECUTION_APPROVAL")
  },
  {
    name: "direct authorization bypass",
    alter: (edges) => [...edges, { from: "EXECUTION_READY", command: "START_IMPLEMENTATION", to: "IMPLEMENTING" }]
  },
  {
    name: "human review bypass",
    alter: (edges) => [...edges, { from: "VERIFYING", command: "PASS_VERIFICATION", to: "COMPLETED" }]
  },
  {
    name: "outgoing terminal edge",
    alter: (edges) => [...edges, { from: "COMPLETED", command: "START_SPECIFICATION", to: "SPECIFYING" }]
  },
  {
    name: "repair expansion retains authority",
    alter: (edges) =>
      edges.map((edge) => (edge.command === "EXPAND_REPAIR_SCOPE" ? { ...edge, to: "REPAIRING" } : edge))
  }
];

for (const mutation of mutations) {
  test(`definition mutation is killed: ${mutation.name}`, () => {
    assert.ok(validateWorkflowDefinition(mutation.alter(WORKFLOW_DEFINITION)).length > 0);
  });
}

test("canonical workflow definition has zero structural violations", () => {
  assert.deepEqual(validateWorkflowDefinition(WORKFLOW_DEFINITION), []);
});

for (const transition of WORKFLOW_DEFINITION) {
  test(`declared edge accepts: ${transition.from} × ${transition.command} → ${transition.to}`, () => {
    const actorRole = transition.actorRole ?? "controller";
    const current = snapshot(transition.from, {
      runKind: transition.command === "COMPLETE_RECOVERY" ? "recovery" : "feature"
    });
    const decision = WorkflowMachine.decide(
      current,
      command(transition.command, {
        actorRole,
        actorId: `actor:${actorRole}`,
        publicationRequired: false
      })
    );
    assert.equal(decision.accepted, true);
    assert.equal(decision.nextState, transition.to);
  });

  if (transition.requiredEvidence?.length > 0) {
    test(`declared evidence is mandatory: ${transition.from} × ${transition.command}`, () => {
      const actorRole = transition.actorRole ?? "controller";
      const missing = transition.requiredEvidence[0];
      const full = command(transition.command).evidence;
      const decision = WorkflowMachine.decide(
        snapshot(transition.from, {
          runKind: transition.command === "COMPLETE_RECOVERY" ? "recovery" : "feature"
        }),
        command(transition.command, {
          actorRole,
          actorId: `actor:${actorRole}`,
          evidence: full.filter((item) => item !== missing)
        })
      );
      assert.deepEqual(decision, { accepted: false, code: "VES_WORKFLOW_EVIDENCE_REQUIRED" });
    });
  }

  if (transition.actorRole !== undefined) {
    test(`declared actor is mandatory: ${transition.from} × ${transition.command}`, () => {
      const wrongRole = transition.actorRole === "human" ? "controller" : "human";
      const decision = WorkflowMachine.decide(
        snapshot(transition.from, {
          runKind: transition.command === "COMPLETE_RECOVERY" ? "recovery" : "feature"
        }),
        command(transition.command, { actorRole: wrongRole, actorId: `actor:${wrongRole}` })
      );
      assert.deepEqual(decision, { accepted: false, code: "VES_WORKFLOW_ACTOR_DENIED" });
    });
  }
}

test("workflow public-error catalog is exact and schema-valid", async () => {
  assert.deepEqual(workflowPublicErrorRegistry.codes, [
    "VES_WORKFLOW_ACTOR_DENIED",
    "VES_WORKFLOW_APPROVAL_REQUIRED",
    "VES_WORKFLOW_APPROVAL_STALE",
    "VES_WORKFLOW_AUTHOR_VERIFIER_CONFLICT",
    "VES_WORKFLOW_COMMAND_REJECTED",
    "VES_WORKFLOW_EVIDENCE_REQUIRED",
    "VES_WORKFLOW_HANDOFF_APPROVAL_REQUIRED",
    "VES_WORKFLOW_RUN_KIND_MISMATCH",
    "VES_WORKFLOW_SUCCESSOR_INVALID",
    "VES_WORKFLOW_TERMINAL",
    "VES_WORKFLOW_VERSION_CONFLICT"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of workflowPublicErrorRegistry.codes) {
    assert.equal(schemas.validate("public-error", "1", workflowPublicErrorRegistry.create(code, {})).code, code);
  }
});
