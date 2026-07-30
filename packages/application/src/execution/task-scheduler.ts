import type { DeclaredBudgets } from "./budget-meter.ts";
import {
  normalizeTask,
  TaskExecutionCoordinator,
  TaskExecutorError,
  type AtomicExecutionTask
} from "./task-executor.ts";

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

export type ScheduledTaskStatus = "completed" | "failed" | "blocked";

export interface ScheduleRound {
  readonly round: number;
  readonly started: readonly { readonly taskId: string }[];
  readonly deferred: readonly { readonly taskId: string; readonly reason: string }[];
}

export interface ScheduledTaskOutcome {
  readonly taskId: string;
  readonly status: ScheduledTaskStatus;
  readonly coordinationRef?: string;
  readonly changeDigest?: string;
  readonly errorCode?: string;
}

export interface TaskScheduleReport {
  readonly status: "completed" | "failed" | "cancelled";
  readonly workspaceId: string;
  readonly runId: string;
  readonly executionPackageDigest: Digest;
  readonly maxConcurrentTasks: number;
  readonly rounds: readonly ScheduleRound[];
  readonly outcomes: readonly ScheduledTaskOutcome[];
}

type TaskState = "pending" | "running" | "completed" | "failed" | "blocked";

type TaskExecutorPorts = ConstructorParameters<typeof TaskExecutionCoordinator>[0];

type SettledTask =
  | {
      readonly taskId: string;
      readonly ok: true;
      readonly result: Awaited<ReturnType<TaskExecutionCoordinator["execute"]>>;
    }
  | { readonly taskId: string; readonly ok: false; readonly error: unknown };

// Scope conflict is path equality or containment in either direction, the same
// rule the executor's within() applies to tool targets. Static analysis orders
// conflicting tasks deterministically; the per-task claim stays the backstop.
function pathsOverlap(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function scopesOverlap(left: readonly string[], right: readonly string[]): boolean {
  return left.some((a) => right.some((b) => pathsOverlap(a, b)));
}

function byTaskId(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface PlannedRound {
  readonly start: readonly AtomicExecutionTask[];
  readonly deferred: readonly { readonly taskId: string; readonly reason: string }[];
}

// Pure: identical state in, identical plan out. Determinism is what lets the
// scheduling report serve as evidence.
function planRound(input: {
  readonly tasks: readonly AtomicExecutionTask[];
  readonly states: ReadonlyMap<string, TaskState>;
  readonly runningScopes: ReadonlyMap<string, readonly string[]>;
  readonly freeSlots: number;
}): PlannedRound {
  const ready = input.tasks
    .filter((task) => input.states.get(task.taskId) === "pending")
    .filter((task) => task.dependencyTaskIds.every((dependency) => input.states.get(dependency) === "completed"))
    .sort((a, b) => byTaskId(a.taskId, b.taskId));
  const readyIds = new Set(ready.map((task) => task.taskId));
  const deferred: { readonly taskId: string; readonly reason: string }[] = [];
  for (const task of input.tasks) {
    if (input.states.get(task.taskId) === "pending" && !readyIds.has(task.taskId))
      deferred.push({ taskId: task.taskId, reason: "dependency-wait" });
  }
  const start: AtomicExecutionTask[] = [];
  for (const task of ready) {
    if (start.length >= input.freeSlots) {
      deferred.push({ taskId: task.taskId, reason: "concurrency-limit" });
      continue;
    }
    const conflictWithRunning = [...input.runningScopes.entries()].find(([, scope]) =>
      scopesOverlap(task.changeScope, scope)
    );
    if (conflictWithRunning !== undefined) {
      deferred.push({ taskId: task.taskId, reason: `scope-conflict:${conflictWithRunning[0]}` });
      continue;
    }
    const conflictWithSelected = start.find((selected) => scopesOverlap(task.changeScope, selected.changeScope));
    if (conflictWithSelected !== undefined) {
      deferred.push({ taskId: task.taskId, reason: `scope-conflict:${conflictWithSelected.taskId}` });
      continue;
    }
    start.push(task);
  }
  return {
    start,
    deferred: deferred.sort((a, b) => byTaskId(a.taskId, b.taskId))
  };
}

export class TaskScheduleCoordinator {
  readonly #executor: TaskExecutionCoordinator;

  constructor(ports: TaskExecutorPorts) {
    this.#executor = new TaskExecutionCoordinator(ports);
  }

  async execute(inputValue: unknown, options: { readonly signal?: AbortSignal } = {}): Promise<TaskScheduleReport> {
    if (options.signal?.aborted === true) fail("VES_SCHEDULER_CANCELLED", "Task schedule was cancelled before start");
    const input = normalizeTaskSchedule(inputValue);
    const states = new Map<string, TaskState>(input.tasks.map((task) => [task.taskId, "pending"]));
    const rounds: ScheduleRound[] = [];
    const outcomes = new Map<string, ScheduledTaskOutcome>();
    const running = new Map<string, { readonly scope: readonly string[]; readonly promise: Promise<SettledTask> }>();
    const settled: SettledTask[] = [];
    let wake: () => void = () => undefined;
    let waitForSettled = new Promise<void>((resolve) => {
      wake = resolve;
    });
    let halt = false;
    let cancelled = false;

    const launch = (task: AtomicExecutionTask): void => {
      const perTaskInput = {
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        runId: input.runId,
        executionPackageDigest: input.executionPackageDigest,
        sourceStateDigest: input.sourceStateDigest,
        sourceRevision: input.sourceRevision,
        contextManifestDigest: input.contextManifestDigest,
        mode: input.mode,
        task,
        authority: input.authority,
        ...(input.budgets === undefined ? {} : { budgets: input.budgets })
      };
      const promise = this.#executor
        .execute(perTaskInput, options.signal === undefined ? {} : { signal: options.signal })
        .then((result): SettledTask => ({ taskId: task.taskId, ok: true, result }))
        .catch((error: unknown): SettledTask => ({ taskId: task.taskId, ok: false, error }))
        .then((entry) => {
          settled.push(entry);
          wake();
          return entry;
        });
      running.set(task.taskId, { scope: task.changeScope, promise });
      states.set(task.taskId, "running");
    };

    // The loop only ever waits on the settled queue, so rounds record real
    // decisions instead of polling intervals.
    for (;;) {
      if (!halt) {
        const plan = planRound({
          tasks: input.tasks,
          states,
          runningScopes: new Map([...running].map(([taskId, entry]) => [taskId, entry.scope])),
          freeSlots: input.maxConcurrentTasks - running.size
        });
        if (plan.start.length > 0) {
          for (const task of plan.start) launch(task);
          rounds.push(
            deepFreeze({
              round: rounds.length + 1,
              started: plan.start.map((task) => Object.freeze({ taskId: task.taskId })),
              deferred: plan.deferred.map((entry) => Object.freeze(entry))
            })
          );
        }
      }
      if (running.size === 0) {
        // Nothing in flight: everything settled, or the remainder can never
        // start because a dependency failed or the schedule halted.
        for (const task of input.tasks) {
          if (states.get(task.taskId) !== "pending") continue;
          states.set(task.taskId, "blocked");
          outcomes.set(task.taskId, Object.freeze({ taskId: task.taskId, status: "blocked" }));
        }
        break;
      }
      if (settled.length === 0) await waitForSettled;
      const drained = settled.splice(0, settled.length);
      waitForSettled = new Promise<void>((resolve) => {
        wake = resolve;
      });
      for (const entry of drained) {
        running.delete(entry.taskId);
        if (entry.ok) {
          states.set(entry.taskId, "completed");
          outcomes.set(
            entry.taskId,
            Object.freeze({
              taskId: entry.taskId,
              status: "completed",
              coordinationRef: entry.result.coordinationRef,
              changeDigest: entry.result.changeDigest
            })
          );
        } else {
          states.set(entry.taskId, "failed");
          outcomes.set(
            entry.taskId,
            Object.freeze({
              taskId: entry.taskId,
              status: "failed",
              errorCode: entry.error instanceof TaskExecutorError ? entry.error.code : "VES_EXECUTOR_DRIVER_FAILED"
            })
          );
          // A1: one failure halts new launches; in-flight tasks settle.
          halt = true;
          if (entry.error instanceof TaskExecutorError && entry.error.code === "VES_EXECUTOR_CANCELLED")
            cancelled = true;
        }
      }
      if (Boolean(options.signal?.aborted)) {
        halt = true;
        cancelled = true;
      }
    }

    const ordered = [...outcomes.values()].sort((a, b) => byTaskId(a.taskId, b.taskId));
    const status = cancelled
      ? ("cancelled" as const)
      : ordered.some((outcome) => outcome.status !== "completed")
        ? ("failed" as const)
        : ("completed" as const);
    return deepFreeze({
      status,
      workspaceId: input.workspaceId,
      runId: input.runId,
      executionPackageDigest: input.executionPackageDigest,
      maxConcurrentTasks: input.maxConcurrentTasks,
      rounds,
      outcomes: ordered
    });
  }
}
