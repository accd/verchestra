import type { DeclaredBudgets } from "./budget-meter.ts";
import { normalizeTask, TaskExecutorError, type AtomicExecutionTask } from "./task-executor.ts";

type Digest = `sha256:${string}`;
type Row = Record<string, unknown>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const MAX_TASKS = 100;
const MAX_CONCURRENT_TASKS = 100;

export type TaskSchedulerErrorCode =
  "VES_SCHEDULER_INPUT_INVALID" | "VES_SCHEDULER_GRAPH_INVALID" | "VES_SCHEDULER_CANCELLED";

export class TaskSchedulerError extends Error {
  readonly code: TaskSchedulerErrorCode;

  constructor(code: TaskSchedulerErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskSchedulerError";
    this.code = code;
  }
}

function fail(code: TaskSchedulerErrorCode, message: string, options?: ErrorOptions): never {
  throw new TaskSchedulerError(code, message, options);
}

function exactRow(value: unknown, label: string, allowed: readonly string[], code: TaskSchedulerErrorCode): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const result = value as Row;
  if (Object.keys(result).some((key) => !allowed.includes(key))) fail(code, `${label} contains unknown fields`);
  return result;
}

function safe(value: unknown, label: string, code: TaskSchedulerErrorCode): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_SCHEDULER_INPUT_INVALID", `${label} is invalid`);
  return value as Digest;
}

function stringList(
  value: unknown,
  label: string,
  pattern: RegExp = SAFE,
  code: TaskSchedulerErrorCode = "VES_SCHEDULER_INPUT_INVALID"
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) fail(code, `${label} is invalid`);
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !pattern.test(entry)) fail(code, `${label} contains an invalid value`);
    return entry;
  });
  if (new Set(result).size !== result.length) fail(code, `${label} contains duplicates`);
  return Object.freeze(result);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export interface TaskScheduleInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runId: string;
  readonly executionPackageDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly sourceRevision: string;
  readonly contextManifestDigest: Digest;
  readonly mode: "personal" | "team";
  readonly authority: {
    readonly approvalRef: string;
    readonly approvalBindingDigest: Digest;
    readonly capabilityGrantRefs: readonly string[];
  };
  readonly budgets?: DeclaredBudgets;
  readonly maxConcurrentTasks: number;
  readonly tasks: readonly AtomicExecutionTask[];
}

function normalizeBudgets(value: unknown): DeclaredBudgets {
  const budgets = exactRow(
    value,
    "declared budgets",
    ["maximumCostUsd", "maximumTokens", "maximumDurationMs"],
    "VES_SCHEDULER_INPUT_INVALID"
  );
  for (const field of ["maximumCostUsd", "maximumTokens", "maximumDurationMs"] as const) {
    const ceiling = budgets[field];
    if (typeof ceiling !== "number" || !Number.isFinite(ceiling) || ceiling <= 0)
      fail("VES_SCHEDULER_INPUT_INVALID", `${field} must be a positive finite number`);
  }
  return deepFreeze({
    maximumCostUsd: budgets["maximumCostUsd"] as number,
    maximumTokens: budgets["maximumTokens"] as number,
    maximumDurationMs: budgets["maximumDurationMs"] as number
  });
}

function normalizeTasks(value: unknown): readonly AtomicExecutionTask[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TASKS)
    fail("VES_SCHEDULER_INPUT_INVALID", "tasks is invalid");
  return value.map((entry, index) => {
    try {
      return normalizeTask(entry);
    } catch (error) {
      if (error instanceof TaskExecutorError)
        fail("VES_SCHEDULER_INPUT_INVALID", `tasks[${index}] is invalid: ${error.message}`, { cause: error });
      throw error;
    }
  });
}

// Graph integrity is a scheduling precondition, not a task property: duplicate
// identifiers, dangling references, self-dependencies, and cycles all fail
// closed before any task starts.
function assertValidGraph(tasks: readonly AtomicExecutionTask[]): void {
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.taskId)) fail("VES_SCHEDULER_GRAPH_INVALID", `duplicate taskId ${task.taskId}`);
    seen.add(task.taskId);
  }
  const dependents = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const task of tasks) {
    indegree.set(task.taskId, task.dependencyTaskIds.length);
    for (const dependency of task.dependencyTaskIds) {
      if (dependency === task.taskId) fail("VES_SCHEDULER_GRAPH_INVALID", `task ${task.taskId} depends on itself`);
      if (!seen.has(dependency))
        fail("VES_SCHEDULER_GRAPH_INVALID", `task ${task.taskId} depends on unknown task ${dependency}`);
      const list = dependents.get(dependency) ?? [];
      list.push(task.taskId);
      dependents.set(dependency, list);
    }
  }
  const queue = tasks.filter((task) => task.dependencyTaskIds.length === 0).map((task) => task.taskId);
  let visited = 0;
  while (queue.length > 0) {
    const taskId = queue.shift() as string;
    visited += 1;
    for (const dependent of dependents.get(taskId) ?? []) {
      const remaining = (indegree.get(dependent) as number) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }
  if (visited !== tasks.length) fail("VES_SCHEDULER_GRAPH_INVALID", "task dependency graph contains a cycle");
}

export function normalizeTaskSchedule(value: unknown): TaskScheduleInput {
  const input = exactRow(
    value,
    "task schedule input",
    [
      "schemaVersion",
      "workspaceId",
      "runId",
      "executionPackageDigest",
      "sourceStateDigest",
      "sourceRevision",
      "contextManifestDigest",
      "mode",
      "authority",
      "budgets",
      "maxConcurrentTasks",
      "tasks"
    ],
    "VES_SCHEDULER_INPUT_INVALID"
  );
  if (input["schemaVersion"] !== 1 || !(input["mode"] === "personal" || input["mode"] === "team"))
    fail("VES_SCHEDULER_INPUT_INVALID", "task schedule schema or mode is invalid");
  const maxConcurrentTasks = input["maxConcurrentTasks"];
  if (
    !Number.isSafeInteger(maxConcurrentTasks) ||
    (maxConcurrentTasks as number) < 1 ||
    (maxConcurrentTasks as number) > MAX_CONCURRENT_TASKS
  )
    fail("VES_SCHEDULER_INPUT_INVALID", "maxConcurrentTasks is invalid");
  const authority = exactRow(
    input["authority"],
    "execution authority",
    ["approvalRef", "approvalBindingDigest", "capabilityGrantRefs"],
    "VES_SCHEDULER_INPUT_INVALID"
  );
  const budgets = input["budgets"] === undefined ? undefined : normalizeBudgets(input["budgets"]);
  const tasks = normalizeTasks(input["tasks"]);
  assertValidGraph(tasks);
  return deepFreeze({
    schemaVersion: 1,
    workspaceId: safe(input["workspaceId"], "workspaceId", "VES_SCHEDULER_INPUT_INVALID"),
    runId: safe(input["runId"], "runId", "VES_SCHEDULER_INPUT_INVALID"),
    executionPackageDigest: digest(input["executionPackageDigest"], "executionPackageDigest"),
    sourceStateDigest: digest(input["sourceStateDigest"], "sourceStateDigest"),
    sourceRevision:
      typeof input["sourceRevision"] === "string" && GIT_OBJECT_ID.test(input["sourceRevision"])
        ? input["sourceRevision"]
        : fail("VES_SCHEDULER_INPUT_INVALID", "sourceRevision is invalid"),
    contextManifestDigest: digest(input["contextManifestDigest"], "contextManifestDigest"),
    mode: input["mode"],
    authority: Object.freeze({
      approvalRef: safe(authority["approvalRef"], "approvalRef", "VES_SCHEDULER_INPUT_INVALID"),
      approvalBindingDigest: digest(authority["approvalBindingDigest"], "approvalBindingDigest"),
      capabilityGrantRefs: stringList(authority["capabilityGrantRefs"], "capabilityGrantRefs")
    }),
    ...(budgets === undefined ? {} : { budgets }),
    maxConcurrentTasks: maxConcurrentTasks as number,
    tasks
  });
}
