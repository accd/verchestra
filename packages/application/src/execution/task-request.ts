import { canonicalizeJsonV2 } from "@verchestra/domain";

import type { DeclaredBudgets } from "./budget-meter.ts";
import { canonicalTaskGatePlan, TaskGateError, type TaskGateCommand } from "./gate-commit.ts";
import type { GateRepairPolicy } from "./gate-repair.ts";
import { modelPriceTable } from "./model-price-table.ts";
import { normalizeTask, TaskExecutorError, type AtomicExecutionTask } from "./task-executor.ts";

// A Task Request is the only thing a user hands to `vestra task plan`. It is
// untrusted: it never carries workspace or run identity, digests, executable
// paths, credentials, or approvals. The canonical contract is
// schemas/task-request/1.schema.json; this normalizer enforces the same shape
// plus the cross-field rules a JSON Schema cannot express.

type Row = Record<string, unknown>;

const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
// invariant: identical to the schema's gate-argument pattern. An argument is
// passed to a locally allowlisted executable inside the worktree, so it may not
// name an absolute location or climb out of the worktree.
const GATE_ARGUMENT =
  /^(?![\\/])(?![A-Za-z]:)(?!.*=[\\/])(?!.*=[A-Za-z]:)(?!.*(?:^|[\\/=])\.\.(?:[\\/]|$))[\x20-\x7e]{1,512}$/u;
const DRIVER_MODEL = /^claude-[a-z0-9][a-z0-9.-]{0,63}$/u;
const VERIFIER_MODEL = /^gpt-[a-z0-9][a-z0-9.-]{0,63}$/u;
// hazard: bidirectional overrides and isolates (Trojan Source) make reviewed
// text differ from what a model reads; C0 controls other than tab and newline
// and DEL have no place in human instructions.
const INSTRUCTIONS = /^[^\u0000-\u0008\u000B-\u001F\u007F‪-‮⁦-⁩]+$/u;
const MAXIMUM_INSTRUCTION_CHARACTERS = 8192;
const MAXIMUM_INSTRUCTION_BYTES = 16_384;
const MAXIMUM_COST_USD = 1000;
const MAXIMUM_TOKENS = 100_000_000;
const MAXIMUM_DURATION_MS = 86_400_000;

export type TaskRequestErrorCode =
  | "VES_TASK_REQUEST_INVALID"
  | "VES_TASK_REQUEST_TASK_INVALID"
  | "VES_TASK_REQUEST_GATES_INVALID"
  | "VES_TASK_REQUEST_BUDGET_INVALID"
  | "VES_TASK_REQUEST_REPAIR_POLICY_INVALID"
  | "VES_TASK_REQUEST_DRIVER_UNSUPPORTED"
  | "VES_TASK_REQUEST_MODEL_UNPRICED";

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

function fail(code: TaskRequestErrorCode, message: string, options?: ErrorOptions): never {
  throw new TaskRequestError(code, message, options);
}

function exact(
  value: unknown,
  label: string,
  code: TaskRequestErrorCode,
  required: readonly string[],
  optional: readonly string[] = []
): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const row = value as Row;
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

const GATE_FIELDS = [
  "gateId",
  "requirementIds",
  "declaredCommand",
  "commandRef",
  "args",
  "cwd",
  "timeoutMs",
  "outputLimitBytes",
  "resultProtocol",
  "minimumTests"
] as const;

function assertGateArguments(gate: unknown): void {
  const args = exact(gate, "gate", "VES_TASK_REQUEST_GATES_INVALID", GATE_FIELDS)["args"];
  if (!Array.isArray(args) || args.some((argument) => typeof argument !== "string" || !GATE_ARGUMENT.test(argument)))
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
  const row = exact(value, "budgets", "VES_TASK_REQUEST_BUDGET_INVALID", [
    "maximumCostUsd",
    "maximumTokens",
    "maximumDurationMs"
  ]);
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
  const row = exact(value, "onGateFailure", "VES_TASK_REQUEST_REPAIR_POLICY_INVALID", [
    "maxAttempts",
    "feedbackToDriver",
    "escalateAfter"
  ]);
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

function normalizeModelBinding<T extends string>(
  value: unknown,
  label: string,
  driverId: T,
  model: RegExp
): { readonly driverId: T; readonly model: string } {
  const row = exact(value, label, "VES_TASK_REQUEST_DRIVER_UNSUPPORTED", ["driverId", "model"]);
  if (row["driverId"] !== driverId) fail("VES_TASK_REQUEST_DRIVER_UNSUPPORTED", `${label} must use ${driverId}`);
  const selected = row["model"];
  if (typeof selected !== "string" || !model.test(selected))
    fail("VES_TASK_REQUEST_DRIVER_UNSUPPORTED", `${label} model is not supported by ${driverId}`);
  // why: an unpriced model would stop the run at its first usage event with
  // VES_BUDGET_MODEL_UNKNOWN; refusing it at intake avoids a spent approval.
  if (!Object.hasOwn(modelPriceTable.models, selected))
    fail("VES_TASK_REQUEST_MODEL_UNPRICED", `${label} model has no priced entry`);
  return { driverId, model: selected };
}

function normalizeInstructions(value: unknown): string {
  if (
    typeof value !== "string" ||
    !INSTRUCTIONS.test(value) ||
    [...value].length > MAXIMUM_INSTRUCTION_CHARACTERS ||
    new TextEncoder().encode(value).byteLength > MAXIMUM_INSTRUCTION_BYTES
  )
    fail("VES_TASK_REQUEST_INVALID", "instructions must be bounded text without control or bidirectional characters");
  return value;
}

export function normalizeTaskRequest(value: unknown): NormalizedTaskRequest {
  const request = exact(
    value,
    "task request",
    "VES_TASK_REQUEST_INVALID",
    ["schemaVersion", "sourceRevision", "task", "gates", "budgets", "driver", "verifier", "instructions"],
    ["onGateFailure"]
  );
  if (request["schemaVersion"] !== 1) fail("VES_TASK_REQUEST_INVALID", "task request schemaVersion must be 1");
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
  return deepFreeze({
    schemaVersion: 1,
    sourceRevision,
    task,
    gates,
    budgets,
    ...(onGateFailure === undefined ? {} : { onGateFailure }),
    driver: normalizeModelBinding(request["driver"], "driver", "claude-code", DRIVER_MODEL),
    verifier: normalizeModelBinding(request["verifier"], "verifier", "codex", VERIFIER_MODEL),
    instructions: normalizeInstructions(request["instructions"])
  });
}

// The deterministic encoding the composition digests and presents for approval.
export function canonicalTaskRequest(value: unknown): string {
  return canonicalizeJsonV2(normalizeTaskRequest(value));
}
