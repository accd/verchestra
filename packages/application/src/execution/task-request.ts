import { canonicalizeJsonV2, isTaskPath } from "@verchestra/domain";

import type { DeclaredBudgets } from "./budget-meter.ts";
import {
  COORDINATION_LIMIT_CEILINGS,
  COORDINATION_LIMIT_DEFAULTS,
  coordinationPlanFault,
  type CoordinationEdge,
  type CoordinationHandoff,
  type CoordinationLimits,
  type CoordinationNode,
  type CoordinationPlan
} from "./coordination-plan.ts";
import { canonicalTaskGatePlan, TASK_GATE_COMMAND_FIELDS, TaskGateError, type TaskGateCommand } from "./gate-commit.ts";
import type { GateRepairPolicy } from "./gate-repair.ts";
import { isKnownModel, type SubscriptionDriverId } from "./model-price-table.ts";
import {
  ATOMIC_EXECUTION_TASK_FIELDS,
  normalizeTask,
  TaskExecutorError,
  type AtomicExecutionTask
} from "./task-executor.ts";

// A Task Request is the only thing a user hands to `vestra task plan`. It is
// untrusted: it never carries workspace or run identity, digests, executable
// paths, credentials, or approvals. The canonical contracts are
// schemas/task-request/1.schema.json and 2.schema.json; this normalizer
// enforces the same shapes plus the cross-field rules a JSON Schema cannot
// express.

type Row = Record<string, unknown>;

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const PRINTABLE_GATE_ARGUMENT = /^[\x20-\x7e]{1,512}$/u;
const DRIVE_LETTER = /^[A-Za-z]$/u;
const DRIVER_MODEL = /^claude-[a-z0-9][a-z0-9.-]{0,63}$/u;
const VERIFIER_MODEL = /^gpt-[a-z0-9][a-z0-9.-]{0,63}$/u;
// hazard: bidirectional overrides and isolates (Trojan Source) make reviewed
// text differ from what a model reads; C0 controls other than tab and newline
// and DEL have no place in human instructions.
const INSTRUCTIONS = /^[^\u0000-\u0008\u000B-\u001F\u007F\u202A-\u202E\u2066-\u2069]+$/u;
const MAXIMUM_INSTRUCTION_CHARACTERS = 8192;
const MAXIMUM_INSTRUCTION_BYTES = 16_384;
const MAXIMUM_COST_USD = 1000;
const MAXIMUM_TOKENS = 100_000_000;
const MAXIMUM_DURATION_MS = 86_400_000;
const BUDGET_FIELDS = Object.freeze(["maximumCostUsd", "maximumTokens", "maximumDurationMs"]);
const REPAIR_POLICY_FIELDS = Object.freeze(["maxAttempts", "feedbackToDriver", "escalateAfter"]);
const MODEL_BINDING_FIELDS = Object.freeze(["driverId", "model"]);
const NODE_ID = /^[a-z][a-z0-9-]{0,31}$/u;
const NODE_DESCRIPTION = /^[\x20-\x7e]{1,256}$/u;
const MAXIMUM_SCOPE_ENTRIES = 100;

export type TaskRequestErrorCode =
  | "VES_TASK_REQUEST_INVALID"
  | "VES_TASK_REQUEST_TASK_INVALID"
  | "VES_TASK_REQUEST_GATES_INVALID"
  | "VES_TASK_REQUEST_BUDGET_INVALID"
  | "VES_TASK_REQUEST_REPAIR_POLICY_INVALID"
  | "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  | "VES_TASK_REQUEST_MODEL_UNPRICED"
  | "VES_TASK_REQUEST_EXECUTION_INVALID";

export class TaskRequestError extends Error {
  readonly code: TaskRequestErrorCode;

  constructor(code: TaskRequestErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskRequestError";
    this.code = code;
  }
}

export type TaskRequestGate = TaskGateCommand;

export interface NormalizedTaskRequest {
  readonly schemaVersion: 1;
  readonly sourceRevision: string;
  readonly task: AtomicExecutionTask;
  readonly gates: readonly TaskRequestGate[];
  readonly budgets: DeclaredBudgets;
  readonly onGateFailure?: GateRepairPolicy;
  readonly driver: { readonly driverId: "claude-code"; readonly model: string };
  readonly verifier: { readonly driverId: "codex"; readonly model: string };
  readonly instructions: string;
}

// invariant: a v2 request has no single driver; each node of its execution
// descriptor names its own, and the descriptor is normalized into a
// coordination plan with every limit explicit.
export interface NormalizedTaskRequestV2 {
  readonly schemaVersion: 2;
  readonly sourceRevision: string;
  readonly task: AtomicExecutionTask;
  readonly gates: readonly TaskRequestGate[];
  readonly budgets: DeclaredBudgets;
  readonly onGateFailure?: GateRepairPolicy;
  readonly verifier: { readonly driverId: "codex"; readonly model: string };
  readonly instructions: string;
  readonly execution: CoordinationPlan;
}

function fail(code: TaskRequestErrorCode, message: string, options?: ErrorOptions): never {
  throw new TaskRequestError(code, message, options);
}

function isRow(value: unknown): value is Row {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(
  value: unknown,
  label: string,
  code: TaskRequestErrorCode,
  required: readonly string[],
  optional: readonly string[] = []
): Row {
  if (!isRow(value)) fail(code, `${label} must be an object`);
  const row = value;
  if (Object.keys(row).some((key) => !required.includes(key) && !optional.includes(key)))
    fail(code, `${label} contains unknown fields`);
  if (required.some((key) => !Object.hasOwn(row, key))) fail(code, `${label} is missing a required field`);
  return row;
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

function namesAbsoluteLocation(argument: string, index: number): boolean {
  const first = argument[index];
  if (first === "/" || first === "\\") return true;
  return first !== undefined && DRIVE_LETTER.test(first) && argument[index + 1] === ":";
}

// invariant: accepts exactly the strings the schema's gate-argument pattern
// accepts; tests/contract/task-request.test.mjs compares the two. An argument
// is passed to a locally allowlisted executable inside the worktree, so it may
// not name an absolute location, directly or after `=`, or climb out of it.
function isGateArgument(argument: unknown): boolean {
  if (typeof argument !== "string" || !PRINTABLE_GATE_ARGUMENT.test(argument)) return false;
  if (namesAbsoluteLocation(argument, 0)) return false;
  for (let index = argument.indexOf("="); index >= 0; index = argument.indexOf("=", index + 1))
    if (namesAbsoluteLocation(argument, index + 1)) return false;
  // hazard: `=` opens a parent segment (`--dir=..`) but does not close one.
  return !argument.split(/[\\/]/u).some((segment) => segment === ".." || segment.endsWith("=.."));
}

function assertGateArguments(gate: unknown): void {
  const args = exact(gate, "gate", "VES_TASK_REQUEST_GATES_INVALID", TASK_GATE_COMMAND_FIELDS)["args"];
  if (!Array.isArray(args) || args.some((argument) => !isGateArgument(argument)))
    fail("VES_TASK_REQUEST_GATES_INVALID", "gate arguments must be bounded, relative, and inside the worktree");
}

function gatePlanCommands(value: readonly unknown[]): readonly TaskRequestGate[] {
  try {
    return (
      JSON.parse(canonicalTaskGatePlan({ schemaVersion: 1, commands: value })) as {
        readonly commands: readonly TaskRequestGate[];
      }
    ).commands;
  } catch (error) {
    if (error instanceof TaskGateError)
      fail("VES_TASK_REQUEST_GATES_INVALID", "gates do not form a valid gate plan", { cause: error });
    throw error;
  }
}

// invariant: the same coverage rules TaskGateCommitCoordinator applies at gate
// time, so a request that cannot pass its gates fails at intake.
function assertGateCoverage(commands: readonly TaskRequestGate[], task: AtomicExecutionTask): void {
  const declared = new Set(commands.map((gate) => gate.declaredCommand));
  if (
    declared.size !== task.verificationCommands.length ||
    task.verificationCommands.some((command) => !declared.has(command))
  )
    fail("VES_TASK_REQUEST_GATES_INVALID", "gates must exactly cover the task verification commands");
  const covered = new Set(commands.flatMap((gate) => gate.requirementIds));
  if (task.requirementIds.some((requirementId) => !covered.has(requirementId)))
    fail("VES_TASK_REQUEST_GATES_INVALID", "gates leave a task requirement uncovered");
  if (commands.some((gate) => gate.requirementIds.some((id) => !task.requirementIds.includes(id))))
    fail("VES_TASK_REQUEST_GATES_INVALID", "gates reference a requirement outside the task");
}

function normalizeGates(value: unknown, task: AtomicExecutionTask): readonly TaskRequestGate[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50)
    fail("VES_TASK_REQUEST_GATES_INVALID", "gates must list between 1 and 50 gates");
  for (const gate of value) assertGateArguments(gate);
  const commands = gatePlanCommands(value);
  assertGateCoverage(commands, task);
  return commands;
}

function normalizeBudgets(value: unknown): DeclaredBudgets {
  const row = exact(value, "budgets", "VES_TASK_REQUEST_BUDGET_INVALID", BUDGET_FIELDS);
  const cost = row["maximumCostUsd"];
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0 || cost > MAXIMUM_COST_USD)
    fail("VES_TASK_REQUEST_BUDGET_INVALID", `maximumCostUsd must be within (0, ${MAXIMUM_COST_USD}]`);
  if (!integer(row["maximumTokens"], 1, MAXIMUM_TOKENS))
    fail("VES_TASK_REQUEST_BUDGET_INVALID", `maximumTokens must be an integer within [1, ${MAXIMUM_TOKENS}]`);
  if (!integer(row["maximumDurationMs"], 1, MAXIMUM_DURATION_MS))
    fail("VES_TASK_REQUEST_BUDGET_INVALID", `maximumDurationMs must be an integer within [1, ${MAXIMUM_DURATION_MS}]`);
  return {
    maximumCostUsd: cost,
    maximumTokens: row["maximumTokens"] as number,
    maximumDurationMs: row["maximumDurationMs"] as number
  };
}

function normalizeRepairPolicy(value: unknown): GateRepairPolicy {
  const row = exact(value, "onGateFailure", "VES_TASK_REQUEST_REPAIR_POLICY_INVALID", REPAIR_POLICY_FIELDS);
  const maxAttempts = row["maxAttempts"];
  if (!integer(maxAttempts, 1, 5)) fail("VES_TASK_REQUEST_REPAIR_POLICY_INVALID", "maxAttempts must be within [1, 5]");
  if (typeof row["feedbackToDriver"] !== "boolean")
    fail("VES_TASK_REQUEST_REPAIR_POLICY_INVALID", "feedbackToDriver must be a boolean");
  if (!integer(row["escalateAfter"], 1, maxAttempts))
    fail("VES_TASK_REQUEST_REPAIR_POLICY_INVALID", "escalateAfter must be within [1, maxAttempts]");
  return {
    maxAttempts,
    feedbackToDriver: row["feedbackToDriver"],
    escalateAfter: row["escalateAfter"] as number
  };
}

function normalizeModelBinding<T extends SubscriptionDriverId>(
  value: unknown,
  label: string,
  driverId: T,
  model: RegExp
): { readonly driverId: T; readonly model: string } {
  const row = exact(value, label, "VES_TASK_REQUEST_DRIVER_UNSUPPORTED", MODEL_BINDING_FIELDS);
  if (row["driverId"] !== driverId) fail("VES_TASK_REQUEST_DRIVER_UNSUPPORTED", `${label} must use ${driverId}`);
  const selected = row["model"];
  if (typeof selected !== "string" || !model.test(selected))
    fail("VES_TASK_REQUEST_DRIVER_UNSUPPORTED", `${label} model is not supported by ${driverId}`);
  // why: a model neither priced nor offered on a subscription would stop the
  // run at its first usage event with VES_BUDGET_MODEL_UNKNOWN; refusing it at
  // intake avoids a spent approval. A subscription-only model passes: the run
  // refuses it on an API key before any effect.
  if (!isKnownModel(driverId, selected))
    fail("VES_TASK_REQUEST_MODEL_UNPRICED", `${label} model has no priced or subscription entry`);
  return { driverId, model: selected };
}

function isInstructions(value: unknown): value is string {
  return (
    typeof value === "string" &&
    INSTRUCTIONS.test(value) &&
    [...value].length <= MAXIMUM_INSTRUCTION_CHARACTERS &&
    new TextEncoder().encode(value).byteLength <= MAXIMUM_INSTRUCTION_BYTES
  );
}

function normalizeInstructions(value: unknown): string {
  if (!isInstructions(value))
    fail("VES_TASK_REQUEST_INVALID", "instructions must be bounded text without control or bidirectional characters");
  return value;
}

// invariant: the members v1 and v2 share, checked in the order v1 always
// checked them, so a v1 request meets the same first refusal it always met.
function normalizeSharedMembers(request: Row) {
  const sourceRevision = request["sourceRevision"];
  if (typeof sourceRevision !== "string" || !OBJECT_ID.test(sourceRevision))
    fail("VES_TASK_REQUEST_INVALID", "sourceRevision must be a complete Git object ID");
  let task: AtomicExecutionTask;
  try {
    task = normalizeTask(request["task"]);
  } catch (error) {
    if (error instanceof TaskExecutorError)
      fail("VES_TASK_REQUEST_TASK_INVALID", "task is not a valid atomic execution task", { cause: error });
    throw error;
  }
  const gates = normalizeGates(request["gates"], task);
  const budgets = normalizeBudgets(request["budgets"]);
  const onGateFailure =
    request["onGateFailure"] === undefined ? undefined : normalizeRepairPolicy(request["onGateFailure"]);
  return { sourceRevision, task, gates, budgets, ...(onGateFailure === undefined ? {} : { onGateFailure }) };
}

function normalizeTaskRequestV1(value: unknown): NormalizedTaskRequest {
  const request = exact(
    value,
    "task request",
    "VES_TASK_REQUEST_INVALID",
    ["schemaVersion", "sourceRevision", "task", "gates", "budgets", "driver", "verifier", "instructions"],
    ["onGateFailure"]
  );
  if (request["schemaVersion"] !== 1) fail("VES_TASK_REQUEST_INVALID", "task request schemaVersion must be 1");
  return deepFreeze({
    schemaVersion: 1,
    ...normalizeSharedMembers(request),
    driver: normalizeModelBinding(request["driver"], "driver", "claude-code", DRIVER_MODEL),
    verifier: normalizeModelBinding(request["verifier"], "verifier", "codex", VERIFIER_MODEL),
    instructions: normalizeInstructions(request["instructions"])
  });
}

function executionInvalid(message: string): never {
  return fail("VES_TASK_REQUEST_EXECUTION_INVALID", message);
}

function nodeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !NODE_ID.test(value)) executionInvalid(`${label} is not a node identifier`);
  return value;
}

function uniqueList(
  value: unknown,
  label: string,
  bounds: { readonly minimum: number; readonly maximum: number },
  accepts: (entry: string) => boolean
): readonly string[] {
  if (!Array.isArray(value) || value.length < bounds.minimum || value.length > bounds.maximum)
    executionInvalid(`${label} has too few or too many entries`);
  if (value.some((entry) => typeof entry !== "string" || !accepts(entry)) || new Set(value).size !== value.length)
    executionInvalid(`${label} holds an invalid or repeated entry`);
  return [...(value as readonly string[])];
}

const nodeIds = (value: unknown, label: string, minimum: number) =>
  uniqueList(value, label, { minimum, maximum: COORDINATION_LIMIT_CEILINGS.maxNodes }, (entry) => NODE_ID.test(entry));
const scope = (value: unknown, label: string) =>
  uniqueList(value, label, { minimum: 0, maximum: MAXIMUM_SCOPE_ENTRIES }, isTaskPath);

const NODE_MODELS = Object.freeze({ "claude-code": DRIVER_MODEL, codex: VERIFIER_MODEL });

function normalizeNodeDriver(value: unknown): CoordinationNode["driver"] {
  const driverId = exact(value, "node driver", "VES_TASK_REQUEST_INVALID", MODEL_BINDING_FIELDS)["driverId"];
  if (driverId !== "claude-code" && driverId !== "codex")
    fail("VES_TASK_REQUEST_DRIVER_UNSUPPORTED", "a node driver must be claude-code or codex");
  return normalizeModelBinding(value, "node driver", driverId, NODE_MODELS[driverId]);
}

function normalizeNode(value: unknown): CoordinationNode {
  const row = exact(value, "execution node", "VES_TASK_REQUEST_INVALID", [
    "nodeId",
    "driver",
    "description",
    "instructions",
    "readScope",
    "writeScope",
    "inputs"
  ]);
  const node = { nodeId: nodeId(row["nodeId"], "nodeId"), driver: normalizeNodeDriver(row["driver"]) };
  const description = row["description"];
  if (typeof description !== "string" || !NODE_DESCRIPTION.test(description))
    executionInvalid("a node description must be printable text of at most 256 characters");
  if (!isInstructions(row["instructions"]))
    executionInvalid("node instructions must be bounded text without control or bidirectional characters");
  return {
    ...node,
    description,
    instructions: row["instructions"],
    readScope: scope(row["readScope"], "readScope"),
    writeScope: scope(row["writeScope"], "writeScope"),
    inputs: nodeIds(row["inputs"], "inputs", 0)
  };
}

function normalizeEdges(value: unknown): readonly CoordinationEdge[] {
  if (!Array.isArray(value) || value.length > COORDINATION_LIMIT_CEILINGS.maxEdges)
    executionInvalid("edges must list at most the edge ceiling");
  const edges = value.map((entry: unknown) => {
    const row = exact(entry, "execution edge", "VES_TASK_REQUEST_INVALID", ["from", "to"]);
    return { from: nodeId(row["from"], "edge source"), to: nodeId(row["to"], "edge target") };
  });
  // why: node identifiers never hold `>`, so the key names one edge.
  if (new Set(edges.map((edge) => `${edge.from}>${edge.to}`)).size !== edges.length)
    executionInvalid("an edge is listed twice");
  return edges;
}

function normalizeHandoffs(value: unknown): readonly CoordinationHandoff[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > COORDINATION_LIMIT_CEILINGS.maxNodes)
    executionInvalid("handoffs must list between one entry and the node ceiling");
  return value.map((entry: unknown) => {
    const row = exact(entry, "execution handoff", "VES_TASK_REQUEST_INVALID", ["from", "to"]);
    return { from: nodeId(row["from"], "handoff source"), to: nodeIds(row["to"], "handoff targets", 1) };
  });
}

const LIMIT_NAMES = Object.freeze(Object.keys(COORDINATION_LIMIT_DEFAULTS) as (keyof CoordinationLimits)[]);

// invariant: SSI-23, SSI-37, SSI-38. An undeclared limit takes its default; a
// declared one is an integer from 1 to its ceiling. The result names all seven.
function normalizeLimits(value: unknown): CoordinationLimits {
  const row = value === undefined ? {} : exact(value, "execution limits", "VES_TASK_REQUEST_INVALID", [], LIMIT_NAMES);
  const limits = { ...COORDINATION_LIMIT_DEFAULTS };
  for (const name of LIMIT_NAMES) {
    const declared = row[name];
    if (declared === undefined) continue;
    if (!integer(declared, 1, COORDINATION_LIMIT_CEILINGS[name]))
      executionInvalid(`${name} must be an integer from 1 to its ceiling`);
    limits[name] = declared;
  }
  return limits;
}

// invariant: the members each mode has. A member of another mode is a member
// outside the schema (SSI-24), as the schema's mode conditions state it.
const MODE_MEMBERS = Object.freeze({ agent: [], graph: ["edges"], swarm: ["start", "handoffs"] });
const EXECUTION_OPTIONS = Object.freeze(["edges", "start", "handoffs", "limits"]);

function modeOf(value: unknown): CoordinationPlan["mode"] {
  if (value !== "agent" && value !== "graph" && value !== "swarm")
    executionInvalid("execution mode must be agent, graph, or swarm");
  return value;
}

function planOf(mode: CoordinationPlan["mode"], row: Row): CoordinationPlan {
  if (
    !Array.isArray(row["nodes"]) ||
    row["nodes"].length === 0 ||
    row["nodes"].length > COORDINATION_LIMIT_CEILINGS.maxNodes
  )
    executionInvalid("nodes must list between one node and the node ceiling");
  const nodes = row["nodes"].map(normalizeNode);
  const limits = normalizeLimits(row["limits"]);
  switch (mode) {
    case "agent":
      return { mode, nodes, limits };
    case "graph":
      return { mode, nodes, edges: normalizeEdges(row["edges"]), limits };
    case "swarm":
      return {
        mode,
        nodes,
        start: nodeId(row["start"], "start"),
        handoffs: normalizeHandoffs(row["handoffs"]),
        limits
      };
  }
}

function normalizeExecution(value: unknown, task: AtomicExecutionTask): CoordinationPlan {
  const declared = exact(value, "execution", "VES_TASK_REQUEST_INVALID", ["mode", "nodes"], EXECUTION_OPTIONS);
  const mode = modeOf(declared["mode"]);
  const row = exact(
    declared,
    "execution",
    "VES_TASK_REQUEST_INVALID",
    ["mode", "nodes", ...MODE_MEMBERS[mode]],
    ["limits"]
  );
  const plan = planOf(mode, row);
  const fault = coordinationPlanFault(plan, task);
  if (fault !== undefined) executionInvalid(fault);
  return plan;
}

// invariant: SSI-24. A member outside the v2 schema is refused as one at any
// depth, in the members v2 shares with v1 as well, before any section rule.
const SHARED_SECTION_FIELDS = Object.freeze([
  ["task", ATOMIC_EXECUTION_TASK_FIELDS],
  ["budgets", BUDGET_FIELDS],
  ["onGateFailure", REPAIR_POLICY_FIELDS],
  ["verifier", MODEL_BINDING_FIELDS]
] as const);

function assertKnownMembers(value: unknown, label: string, fields: readonly string[]): void {
  if (isRow(value) && Object.keys(value).some((key) => !fields.includes(key)))
    fail("VES_TASK_REQUEST_INVALID", `${label} contains unknown fields`);
}

function assertClosedSharedSections(request: Row): void {
  for (const [key, fields] of SHARED_SECTION_FIELDS) assertKnownMembers(request[key], key, fields);
  const gates = request["gates"];
  if (Array.isArray(gates)) for (const gate of gates) assertKnownMembers(gate, "gate", TASK_GATE_COMMAND_FIELDS);
}

function normalizeTaskRequestV2(value: Row): NormalizedTaskRequestV2 {
  const request = exact(
    value,
    "task request",
    "VES_TASK_REQUEST_INVALID",
    ["schemaVersion", "sourceRevision", "task", "gates", "budgets", "verifier", "instructions", "execution"],
    ["onGateFailure"]
  );
  assertClosedSharedSections(request);
  const shared = normalizeSharedMembers(request);
  return deepFreeze({
    schemaVersion: 2,
    ...shared,
    verifier: normalizeModelBinding(request["verifier"], "verifier", "codex", VERIFIER_MODEL),
    instructions: normalizeInstructions(request["instructions"]),
    execution: normalizeExecution(request["execution"], shared.task)
  });
}

// invariant: only a request that declares version 2 is read as one; every
// other value, a malformed one included, is read exactly as before v2 existed.
export function normalizeTaskRequest(value: unknown): NormalizedTaskRequest | NormalizedTaskRequestV2 {
  return isRow(value) && value["schemaVersion"] === 2 ? normalizeTaskRequestV2(value) : normalizeTaskRequestV1(value);
}

// The deterministic encoding the composition digests and presents for approval.
export function canonicalTaskRequest(value: unknown): string {
  return canonicalizeJsonV2(normalizeTaskRequest(value));
}
