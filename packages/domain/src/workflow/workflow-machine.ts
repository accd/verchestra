import { Digest } from "../primitives/digest.ts";
import { StableId } from "../primitives/stable-id.ts";

export const WORKFLOW_STATES = [
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
  "AWAITING_HANDOFF_PUBLICATION_APPROVAL",
  "COMPLETED",
  "HANDED_OFF",
  "FAILED",
  "ABORTED",
  "INTERRUPTED",
  "RECOVERED"
] as const;
export type RunState = (typeof WORKFLOW_STATES)[number];

export const TERMINAL_WORKFLOW_STATES = [
  "COMPLETED",
  "HANDED_OFF",
  "FAILED",
  "ABORTED",
  "INTERRUPTED",
  "RECOVERED"
] as const satisfies readonly RunState[];

export const WORKFLOW_COMMANDS = [
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
] as const;
export type WorkflowCommandType = (typeof WORKFLOW_COMMANDS)[number];

export const WORKFLOW_ACTOR_ROLES = ["human", "planner", "implementer", "verifier", "controller", "recovery"] as const;
export type WorkflowActorRole = (typeof WORKFLOW_ACTOR_ROLES)[number];

export interface ExecutionApproval {
  readonly bindingDigest: string;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly runKind: "feature" | "recovery";
  readonly state: RunState;
  readonly version: number;
  readonly repairCycles: number;
  readonly approval: ExecutionApproval | undefined;
  readonly implementationActorId?: string;
  readonly terminalCapsuleRequired?: boolean;
  readonly predecessorRunId?: string;
  readonly successorRunId?: string;
}

export interface WorkflowCommand {
  readonly type: WorkflowCommandType;
  readonly expectedVersion: number;
  readonly actorRole: WorkflowActorRole;
  readonly actorId: string;
  readonly evidence: readonly string[];
  readonly currentBindingDigest?: string;
  readonly approvalBindingDigest?: string;
  readonly publicationRequired?: boolean;
  readonly successorRunId?: string;
}

export interface TransitionDefinition {
  readonly from: RunState;
  readonly command: WorkflowCommandType;
  readonly to: RunState;
  readonly actorRole?: WorkflowActorRole;
  readonly requiredEvidence?: readonly string[];
}

export interface WorkflowEvent {
  readonly type: string;
  readonly previousState: RunState;
  readonly nextState: RunState;
  readonly expectedVersion: number;
}

export type WorkflowRejectionCode =
  | "VES_WORKFLOW_VERSION_CONFLICT"
  | "VES_WORKFLOW_TERMINAL"
  | "VES_WORKFLOW_COMMAND_REJECTED"
  | "VES_WORKFLOW_ACTOR_DENIED"
  | "VES_WORKFLOW_EVIDENCE_REQUIRED"
  | "VES_WORKFLOW_APPROVAL_STALE"
  | "VES_WORKFLOW_APPROVAL_REQUIRED"
  | "VES_WORKFLOW_HANDOFF_APPROVAL_REQUIRED"
  | "VES_WORKFLOW_RUN_KIND_MISMATCH"
  | "VES_WORKFLOW_AUTHOR_VERIFIER_CONFLICT";

export type WorkflowDecision =
  | { readonly accepted: false; readonly code: WorkflowRejectionCode }
  | {
      readonly accepted: true;
      readonly previousState: RunState;
      readonly nextState: RunState;
      readonly version: number;
      readonly events: readonly WorkflowEvent[];
      readonly snapshot: RunSnapshot;
    };

const edge = (
  from: RunState,
  command: WorkflowCommandType,
  to: RunState,
  options: Pick<TransitionDefinition, "actorRole" | "requiredEvidence"> = {}
): TransitionDefinition =>
  Object.freeze({
    from,
    command,
    to,
    ...options,
    ...(options.requiredEvidence === undefined
      ? {}
      : { requiredEvidence: Object.freeze([...options.requiredEvidence]) })
  });

const BASE_EDGES: readonly TransitionDefinition[] = [
  edge("CREATED", "REQUIRE_INTAKE", "INTAKE_REQUIRED"),
  edge("CREATED", "READY_WITHOUT_INTAKE", "READY"),
  edge("INTAKE_REQUIRED", "COMPLETE_INTAKE", "READY", { requiredEvidence: ["intake-record"] }),
  edge("READY", "REQUIRE_DISCOVERY", "DISCOVERY_REQUIRED"),
  edge("READY", "START_RECONNAISSANCE", "RECONNING"),
  edge("DISCOVERY_REQUIRED", "START_RECONNAISSANCE", "RECONNING"),
  edge("READY", "START_SPECIFICATION", "SPECIFYING"),
  edge("RECONNING", "START_SPECIFICATION", "SPECIFYING", { requiredEvidence: ["discovery-report"] }),
  edge("SPECIFYING", "SUBMIT_SPEC_REVIEW", "SPEC_REVIEW", { requiredEvidence: ["specification"] }),
  edge("SPEC_REVIEW", "APPROVE_SPEC", "DESIGNING", {
    actorRole: "human",
    requiredEvidence: ["spec-review"]
  }),
  edge("DESIGNING", "SUBMIT_DESIGN_REVIEW", "DESIGN_REVIEW", { requiredEvidence: ["design"] }),
  edge("DESIGN_REVIEW", "APPROVE_DESIGN", "TASKING", {
    actorRole: "human",
    requiredEvidence: ["design-review"]
  }),
  edge("TASKING", "COMPLETE_TASKING", "EXECUTION_READY", { requiredEvidence: ["execution-package"] }),
  edge("EXECUTION_READY", "REQUEST_EXECUTION_APPROVAL", "AWAITING_EXECUTION_APPROVAL", {
    requiredEvidence: ["execution-package"]
  }),
  edge("AWAITING_EXECUTION_APPROVAL", "GRANT_EXECUTION_APPROVAL", "EXECUTION_AUTHORIZED", {
    actorRole: "human",
    requiredEvidence: ["execution-approval"]
  }),
  edge("EXECUTION_AUTHORIZED", "START_IMPLEMENTATION", "IMPLEMENTING", {
    actorRole: "implementer",
    requiredEvidence: ["writer-lease"]
  }),
  edge("IMPLEMENTING", "START_VERIFICATION", "VERIFYING", {
    actorRole: "implementer",
    requiredEvidence: ["task-gate-evidence"]
  }),
  edge("VERIFYING", "REQUEST_REPAIR", "REPAIRING", {
    actorRole: "verifier",
    requiredEvidence: ["verification-evidence"]
  }),
  edge("REPAIRING", "COMPLETE_REPAIR", "VERIFYING", {
    actorRole: "implementer",
    requiredEvidence: ["repair-evidence"]
  }),
  edge("HUMAN_RESOLUTION_REQUIRED", "RESOLVE_REPAIR", "REPAIRING", {
    actorRole: "human",
    requiredEvidence: ["human-resolution"]
  }),
  edge("VERIFYING", "PASS_VERIFICATION", "HUMAN_REVIEW", {
    actorRole: "verifier",
    requiredEvidence: ["verification-evidence"]
  }),
  edge("HUMAN_REVIEW", "APPROVE_HUMAN_REVIEW", "COMPLETED", {
    actorRole: "human",
    requiredEvidence: ["human-review-record"]
  }),
  edge("EXECUTION_READY", "PREPARE_HANDOFF", "HANDOFF_PREPARING", {
    requiredEvidence: ["signed-package"]
  }),
  edge("EXECUTION_AUTHORIZED", "PREPARE_HANDOFF", "HANDOFF_PREPARING", {
    requiredEvidence: ["signed-package"]
  }),
  edge("HANDOFF_PREPARING", "REQUEST_HANDOFF_PUBLICATION_APPROVAL", "AWAITING_HANDOFF_PUBLICATION_APPROVAL", {
    requiredEvidence: ["signed-package"]
  }),
  edge("HANDOFF_PREPARING", "COMPLETE_HANDOFF", "HANDED_OFF", { requiredEvidence: ["signed-package"] }),
  edge("AWAITING_HANDOFF_PUBLICATION_APPROVAL", "COMPLETE_HANDOFF", "HANDED_OFF", {
    requiredEvidence: ["signed-package", "handoff-publication-approval", "handoff-publication-receipt"]
  }),
  ...(["EXECUTION_AUTHORIZED", "IMPLEMENTING", "VERIFYING", "REPAIRING"] as const).map((from) =>
    edge(from, "INVALIDATE_EXECUTION_APPROVAL", "AWAITING_EXECUTION_APPROVAL")
  ),
  edge("REPAIRING", "EXPAND_REPAIR_SCOPE", "AWAITING_EXECUTION_APPROVAL")
];

const ACTIVE_STATES = WORKFLOW_STATES.filter(
  (state) => !(TERMINAL_WORKFLOW_STATES as readonly RunState[]).includes(state)
);

const TERMINAL_EDGES: readonly TransitionDefinition[] = ACTIVE_STATES.flatMap((from) => [
  edge(from, "FAIL", "FAILED", { requiredEvidence: ["terminal-error-evidence"] }),
  edge(from, "ABORT", "ABORTED", { actorRole: "human" }),
  edge(from, "INTERRUPT", "INTERRUPTED"),
  edge(from, "COMPLETE_RECOVERY", "RECOVERED", {
    actorRole: "recovery",
    requiredEvidence: ["recovery-evidence"]
  })
]);

export const WORKFLOW_DEFINITION: readonly TransitionDefinition[] = Object.freeze([...BASE_EDGES, ...TERMINAL_EDGES]);

const REQUIRED_EDGE_KEYS = new Set([
  "EXECUTION_READY|REQUEST_EXECUTION_APPROVAL|AWAITING_EXECUTION_APPROVAL",
  "AWAITING_EXECUTION_APPROVAL|GRANT_EXECUTION_APPROVAL|EXECUTION_AUTHORIZED",
  "VERIFYING|PASS_VERIFICATION|HUMAN_REVIEW",
  "HUMAN_REVIEW|APPROVE_HUMAN_REVIEW|COMPLETED",
  "REPAIRING|EXPAND_REPAIR_SCOPE|AWAITING_EXECUTION_APPROVAL"
]);

const edgeKey = (value: TransitionDefinition): string => `${value.from}|${value.command}|${value.to}`;

export function validateWorkflowDefinition(definition: readonly TransitionDefinition[]): readonly string[] {
  const violations: string[] = [];
  const pairKeys = new Set<string>();
  const fullKeys = new Set(definition.map(edgeKey));
  for (const transition of definition) {
    const pair = `${transition.from}|${transition.command}`;
    if (pairKeys.has(pair)) violations.push(`duplicate:${pair}`);
    pairKeys.add(pair);
    if ((TERMINAL_WORKFLOW_STATES as readonly RunState[]).includes(transition.from)) {
      violations.push(`terminal-outgoing:${edgeKey(transition)}`);
    }
    if (transition.from === "EXECUTION_READY" && transition.to === "IMPLEMENTING") {
      violations.push(`approval-bypass:${edgeKey(transition)}`);
    }
    if (transition.to === "COMPLETED" && edgeKey(transition) !== "HUMAN_REVIEW|APPROVE_HUMAN_REVIEW|COMPLETED") {
      violations.push(`human-review-bypass:${edgeKey(transition)}`);
    }
    if (transition.command === "EXPAND_REPAIR_SCOPE" && transition.to !== "AWAITING_EXECUTION_APPROVAL") {
      violations.push(`repair-scope-bypass:${edgeKey(transition)}`);
    }
  }
  for (const required of REQUIRED_EDGE_KEYS) {
    if (!fullKeys.has(required)) violations.push(`missing:${required}`);
  }
  return Object.freeze(violations);
}

if (validateWorkflowDefinition(WORKFLOW_DEFINITION).length !== 0) {
  throw new Error("canonical workflow definition is invalid");
}

function reject(code: WorkflowRejectionCode): WorkflowDecision {
  return { accepted: false, code };
}

function transition(
  current: RunSnapshot,
  command: WorkflowCommand,
  nextState: RunState,
  eventType = `${command.type}_ACCEPTED`
): WorkflowDecision {
  const terminal = (TERMINAL_WORKFLOW_STATES as readonly RunState[]).includes(nextState);
  let approval = current.approval;
  let repairCycles = current.repairCycles;
  let implementationActorId = current.implementationActorId;
  let successorRunId = current.successorRunId;
  if (command.type === "GRANT_EXECUTION_APPROVAL") {
    approval = Object.freeze({ bindingDigest: command.approvalBindingDigest as string });
  }
  if (
    command.type === "INVALIDATE_EXECUTION_APPROVAL" ||
    command.type === "EXPAND_REPAIR_SCOPE" ||
    command.type === "PREPARE_HANDOFF" ||
    eventType === "EXECUTION_APPROVAL_INVALIDATED"
  ) {
    approval = undefined;
  }
  if (command.type === "REQUEST_REPAIR" && nextState === "REPAIRING") repairCycles += 1;
  if (command.type === "RESOLVE_REPAIR") repairCycles = 0;
  if (command.type === "START_IMPLEMENTATION") implementationActorId = command.actorId;
  if (command.type === "PREPARE_HANDOFF" && command.successorRunId !== undefined) {
    try {
      StableId.parse(command.successorRunId, "run");
    } catch {
      return reject("VES_WORKFLOW_COMMAND_REJECTED");
    }
    if (command.successorRunId === current.runId) return reject("VES_WORKFLOW_COMMAND_REJECTED");
    successorRunId = command.successorRunId;
  }

  const version = current.version + 1;
  const snapshot: RunSnapshot = Object.freeze({
    ...current,
    state: nextState,
    version,
    repairCycles,
    approval,
    ...(implementationActorId === undefined ? {} : { implementationActorId }),
    ...(successorRunId === undefined ? {} : { successorRunId }),
    terminalCapsuleRequired: terminal || current.terminalCapsuleRequired === true
  });
  const events: WorkflowEvent[] = [
    Object.freeze({
      type: eventType,
      previousState: current.state,
      nextState,
      expectedVersion: command.expectedVersion
    })
  ];
  if (terminal) {
    events.push(
      Object.freeze({
        type: "TERMINAL_CAPSULE_REQUESTED",
        previousState: current.state,
        nextState,
        expectedVersion: command.expectedVersion
      })
    );
  }
  return Object.freeze({
    accepted: true,
    previousState: current.state,
    nextState,
    version,
    events: Object.freeze(events),
    snapshot
  });
}

export class WorkflowMachine {
  static decide(current: RunSnapshot, command: WorkflowCommand): WorkflowDecision {
    if (command.expectedVersion !== current.version) return reject("VES_WORKFLOW_VERSION_CONFLICT");
    if ((TERMINAL_WORKFLOW_STATES as readonly RunState[]).includes(current.state)) {
      return reject("VES_WORKFLOW_TERMINAL");
    }

    const definition = WORKFLOW_DEFINITION.find(
      (candidate) => candidate.from === current.state && candidate.command === command.type
    );
    if (definition === undefined) return reject("VES_WORKFLOW_COMMAND_REJECTED");
    if (command.type === "COMPLETE_RECOVERY" && current.runKind !== "recovery") {
      return reject("VES_WORKFLOW_RUN_KIND_MISMATCH");
    }
    if (definition.actorRole !== undefined && definition.actorRole !== command.actorRole) {
      return reject("VES_WORKFLOW_ACTOR_DENIED");
    }
    if (definition.requiredEvidence?.some((required) => !command.evidence.includes(required)) === true) {
      return reject("VES_WORKFLOW_EVIDENCE_REQUIRED");
    }
    if (command.type === "GRANT_EXECUTION_APPROVAL") {
      if (
        command.approvalBindingDigest === undefined ||
        command.currentBindingDigest === undefined ||
        command.approvalBindingDigest !== command.currentBindingDigest ||
        !isCanonicalDigest(command.approvalBindingDigest)
      ) {
        return reject("VES_WORKFLOW_APPROVAL_STALE");
      }
    }
    if (command.type === "START_IMPLEMENTATION") {
      if (current.approval === undefined) return reject("VES_WORKFLOW_APPROVAL_REQUIRED");
      if (
        current.approval.bindingDigest !== command.currentBindingDigest ||
        !isCanonicalDigest(current.approval.bindingDigest)
      ) {
        return transition(current, command, "AWAITING_EXECUTION_APPROVAL", "EXECUTION_APPROVAL_INVALIDATED");
      }
    }
    if (
      (command.type === "REQUEST_REPAIR" || command.type === "PASS_VERIFICATION") &&
      current.implementationActorId !== undefined &&
      current.implementationActorId === command.actorId
    ) {
      return reject("VES_WORKFLOW_AUTHOR_VERIFIER_CONFLICT");
    }
    if (
      command.type === "COMPLETE_HANDOFF" &&
      current.state === "HANDOFF_PREPARING" &&
      command.publicationRequired === true
    ) {
      return reject("VES_WORKFLOW_HANDOFF_APPROVAL_REQUIRED");
    }
    if (command.type === "REQUEST_REPAIR" && current.repairCycles >= 3) {
      return transition(current, command, "HUMAN_RESOLUTION_REQUIRED", "REPAIR_LIMIT_REACHED");
    }
    return transition(current, command, definition.to);
  }
}

export class WorkflowInvariantError extends Error {
  readonly code = "VES_WORKFLOW_SUCCESSOR_INVALID" as const;

  constructor(message: string) {
    super(message);
    this.name = "WorkflowInvariantError";
  }
}

function isCanonicalDigest(value: string): boolean {
  try {
    Digest.parse(value);
    return true;
  } catch {
    return false;
  }
}

interface HandoffSuccessorInput {
  readonly source: RunSnapshot;
  readonly successorRunId: string;
  readonly packageVerified: boolean;
  readonly sourceStateDigest: string;
  readonly packageSourceStateDigest: string;
  readonly localBindingsReady: boolean;
  readonly claimReady: boolean;
  readonly policyReevaluated: boolean;
  readonly firstPendingTaskId: string;
}

export function createHandoffSuccessor(input: HandoffSuccessorInput): RunSnapshot {
  let validIds = true;
  try {
    StableId.parse(input.source.runId, "run");
    StableId.parse(input.successorRunId, "run");
  } catch {
    validIds = false;
  }
  if (
    !validIds ||
    input.source.state !== "HANDED_OFF" ||
    !input.packageVerified ||
    !input.localBindingsReady ||
    !input.claimReady ||
    !input.policyReevaluated ||
    input.firstPendingTaskId.trim().length === 0 ||
    input.sourceStateDigest !== input.packageSourceStateDigest ||
    !isCanonicalDigest(input.sourceStateDigest) ||
    input.successorRunId === input.source.runId ||
    input.source.successorRunId !== input.successorRunId
  ) {
    throw new WorkflowInvariantError("Handoff successor invariants are not satisfied");
  }
  return Object.freeze({
    runId: input.successorRunId,
    runKind: "feature",
    state: "EXECUTION_READY",
    version: 0,
    repairCycles: 0,
    approval: undefined,
    terminalCapsuleRequired: false,
    predecessorRunId: input.source.runId
  });
}
