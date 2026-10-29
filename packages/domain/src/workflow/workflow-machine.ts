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

export type TerminalWorkflowState = (typeof TERMINAL_WORKFLOW_STATES)[number];

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
  "EXPAND_REPAIR_SCOPE",
  "COMPLETE_PROBE"
] as const;
export type WorkflowCommandType = (typeof WORKFLOW_COMMANDS)[number];

// invariant: AD-086. A `probe` run is one approved statement through one
// admitted worker under one single-use `database-read` grant; it shares the
// approval and terminal events of the other kinds and nothing else.
export const RUN_KINDS = ["feature", "recovery", "probe"] as const;
export type RunKind = (typeof RUN_KINDS)[number];

export const WORKFLOW_ACTOR_ROLES = ["human", "planner", "implementer", "verifier", "controller", "recovery"] as const;
export type WorkflowActorRole = (typeof WORKFLOW_ACTOR_ROLES)[number];

export interface ExecutionApproval {
  readonly bindingDigest: string;
}

export interface RunSnapshot {
  readonly runId: string;
  readonly runKind: RunKind;
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
  // invariant: AD-086. Only a probe run takes this edge (runKindGuard); its
  // statement ran under the approval the owner typed back, and no
  // implementation, verification or review follows it.
  edge("EXECUTION_AUTHORIZED", "COMPLETE_PROBE", "COMPLETED", {
    actorRole: "controller",
    requiredEvidence: ["probe-result"]
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

// invariant: the only edges into COMPLETED. A task run completes through Human
// Review; the probe edge is accepted for a probe run only (runKindGuard).
const COMPLETION_EDGE_KEYS: ReadonlySet<string> = new Set([
  "HUMAN_REVIEW|APPROVE_HUMAN_REVIEW|COMPLETED",
  "EXECUTION_AUTHORIZED|COMPLETE_PROBE|COMPLETED"
]);

// Each rule names the violation a transition records when its predicate holds;
// rules are checked, and violations reported, in this order.
const TRANSITION_RULES: readonly {
  readonly kind: string;
  readonly violates: (transition: TransitionDefinition) => boolean;
}[] = [
  {
    kind: "terminal-outgoing",
    violates: (transition) => (TERMINAL_WORKFLOW_STATES as readonly RunState[]).includes(transition.from)
  },
  {
    kind: "approval-bypass",
    violates: (transition) => transition.from === "EXECUTION_READY" && transition.to === "IMPLEMENTING"
  },
  {
    kind: "human-review-bypass",
    violates: (transition) => transition.to === "COMPLETED" && !COMPLETION_EDGE_KEYS.has(edgeKey(transition))
  },
  {
    kind: "repair-scope-bypass",
    violates: (transition) =>
      transition.command === "EXPAND_REPAIR_SCOPE" && transition.to !== "AWAITING_EXECUTION_APPROVAL"
  }
];

export function validateWorkflowDefinition(definition: readonly TransitionDefinition[]): readonly string[] {
  const violations: string[] = [];
  const pairKeys = new Set<string>();
  const fullKeys = new Set(definition.map(edgeKey));
  for (const transition of definition) {
    const pair = `${transition.from}|${transition.command}`;
    if (pairKeys.has(pair)) violations.push(`duplicate:${pair}`);
    pairKeys.add(pair);
    for (const rule of TRANSITION_RULES) {
      if (rule.violates(transition)) violations.push(`${rule.kind}:${edgeKey(transition)}`);
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

function approvalAfter(current: RunSnapshot, command: WorkflowCommand, eventType: string): RunSnapshot["approval"] {
  if (
    command.type === "INVALIDATE_EXECUTION_APPROVAL" ||
    command.type === "EXPAND_REPAIR_SCOPE" ||
    command.type === "PREPARE_HANDOFF" ||
    eventType === "EXECUTION_APPROVAL_INVALIDATED"
  ) {
    return undefined;
  }
  if (command.type === "GRANT_EXECUTION_APPROVAL") {
    return Object.freeze({ bindingDigest: command.approvalBindingDigest as string });
  }
  return current.approval;
}

function repairCyclesAfter(current: RunSnapshot, command: WorkflowCommand, nextState: RunState): number {
  if (command.type === "REQUEST_REPAIR" && nextState === "REPAIRING") return current.repairCycles + 1;
  if (command.type === "RESOLVE_REPAIR") return 0;
  return current.repairCycles;
}

// Returns undefined when a handoff names a successor the Run cannot have.
function successorAfter(
  current: RunSnapshot,
  command: WorkflowCommand
): { readonly successorRunId: string | undefined } | undefined {
  if (command.type !== "PREPARE_HANDOFF" || command.successorRunId === undefined) {
    return { successorRunId: current.successorRunId };
  }
  try {
    StableId.parse(command.successorRunId, "run");
  } catch {
    return undefined;
  }
  if (command.successorRunId === current.runId) return undefined;
  return { successorRunId: command.successorRunId };
}

function transition(
  current: RunSnapshot,
  command: WorkflowCommand,
  nextState: RunState,
  eventType = `${command.type}_ACCEPTED`
): WorkflowDecision {
  const terminal = (TERMINAL_WORKFLOW_STATES as readonly RunState[]).includes(nextState);
  // invariant: AD-086. An ended task or recovery run owes a sealed Run
  // Capsule; an ended probe run owes none: its record is the run, its approval
  // and its grant in the authority store, and the result envelope it printed.
  const capsuleRequired = terminal && current.runKind !== "probe";
  const approval = approvalAfter(current, command, eventType);
  const repairCycles = repairCyclesAfter(current, command, nextState);
  const implementationActorId =
    command.type === "START_IMPLEMENTATION" ? command.actorId : current.implementationActorId;
  const successor = successorAfter(current, command);
  if (successor === undefined) return reject("VES_WORKFLOW_COMMAND_REJECTED");
  const { successorRunId } = successor;

  const version = current.version + 1;
  const snapshot: RunSnapshot = Object.freeze({
    ...current,
    state: nextState,
    version,
    repairCycles,
    approval,
    ...(implementationActorId === undefined ? {} : { implementationActorId }),
    ...(successorRunId === undefined ? {} : { successorRunId }),
    terminalCapsuleRequired: capsuleRequired || current.terminalCapsuleRequired === true
  });
  const events: WorkflowEvent[] = [
    Object.freeze({
      type: eventType,
      previousState: current.state,
      nextState,
      expectedVersion: command.expectedVersion
    })
  ];
  if (capsuleRequired) {
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

interface DecisionInput {
  readonly current: RunSnapshot;
  readonly command: WorkflowCommand;
  readonly definition: TransitionDefinition;
}

// A guard returns the decision that pre-empts the defined transition, or
// undefined to let the next guard decide. Guards run in this order.
const DECISION_GUARDS: readonly ((input: DecisionInput) => WorkflowDecision | undefined)[] = [
  ({ current, command }) => runKindGuard(current, command),
  ({ command, definition }) =>
    definition.actorRole !== undefined && definition.actorRole !== command.actorRole
      ? reject("VES_WORKFLOW_ACTOR_DENIED")
      : undefined,
  ({ command, definition }) =>
    definition.requiredEvidence?.some((required) => !command.evidence.includes(required)) === true
      ? reject("VES_WORKFLOW_EVIDENCE_REQUIRED")
      : undefined,
  ({ command }) => (command.type === "GRANT_EXECUTION_APPROVAL" ? grantApprovalGuard(command) : undefined),
  ({ current, command }) =>
    command.type === "START_IMPLEMENTATION" ? startImplementationGuard(current, command) : undefined,
  ({ current, command }) =>
    (command.type === "REQUEST_REPAIR" || command.type === "PASS_VERIFICATION") &&
    current.implementationActorId !== undefined &&
    current.implementationActorId === command.actorId
      ? reject("VES_WORKFLOW_AUTHOR_VERIFIER_CONFLICT")
      : undefined,
  ({ current, command }) =>
    command.type === "COMPLETE_HANDOFF" && current.state === "HANDOFF_PREPARING" && command.publicationRequired === true
      ? reject("VES_WORKFLOW_HANDOFF_APPROVAL_REQUIRED")
      : undefined,
  ({ current, command }) =>
    command.type === "REQUEST_REPAIR" && current.repairCycles >= 3
      ? transition(current, command, "HUMAN_RESOLUTION_REQUIRED", "REPAIR_LIMIT_REACHED")
      : undefined
];

// invariant: AD-086. A probe run takes only these events: its approval, its
// completion, and the terminal failure, abort and interruption. Every
// implementation, verification, repair, review, handoff and recovery event is
// refused for it, as is every event added later until it is listed here.
const PROBE_RUN_COMMANDS: ReadonlySet<WorkflowCommandType> = new Set([
  "REQUEST_EXECUTION_APPROVAL",
  "GRANT_EXECUTION_APPROVAL",
  "COMPLETE_PROBE",
  "FAIL",
  "ABORT",
  "INTERRUPT"
]);

function runKindGuard(current: RunSnapshot, command: WorkflowCommand): WorkflowDecision | undefined {
  if (command.type === "COMPLETE_RECOVERY" && current.runKind !== "recovery")
    return reject("VES_WORKFLOW_RUN_KIND_MISMATCH");
  if (command.type === "COMPLETE_PROBE" && current.runKind !== "probe") return reject("VES_WORKFLOW_RUN_KIND_MISMATCH");
  if (current.runKind === "probe" && !PROBE_RUN_COMMANDS.has(command.type))
    return reject("VES_WORKFLOW_RUN_KIND_MISMATCH");
  return undefined;
}

function grantApprovalGuard(command: WorkflowCommand): WorkflowDecision | undefined {
  if (
    command.approvalBindingDigest === undefined ||
    command.currentBindingDigest === undefined ||
    command.approvalBindingDigest !== command.currentBindingDigest ||
    !isCanonicalDigest(command.approvalBindingDigest)
  ) {
    return reject("VES_WORKFLOW_APPROVAL_STALE");
  }
  return undefined;
}

function startImplementationGuard(current: RunSnapshot, command: WorkflowCommand): WorkflowDecision | undefined {
  if (current.approval === undefined) return reject("VES_WORKFLOW_APPROVAL_REQUIRED");
  if (
    current.approval.bindingDigest !== command.currentBindingDigest ||
    !isCanonicalDigest(current.approval.bindingDigest)
  ) {
    return transition(current, command, "AWAITING_EXECUTION_APPROVAL", "EXECUTION_APPROVAL_INVALIDATED");
  }
  return undefined;
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
    for (const guard of DECISION_GUARDS) {
      const decision = guard({ current, command, definition });
      if (decision !== undefined) return decision;
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
