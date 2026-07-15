type Digest = `sha256:${string}`;
type Row = Record<string, unknown>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const PRINTABLE_TEXT = /^[\x20-\x7e]{1,512}$/u;
const REQUIREMENT = /^VES-[A-Z]{3}-[0-9]{3}$/u;
const LOGICAL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;

export type TaskExecutorErrorCode =
  | "VES_EXECUTOR_INPUT_INVALID"
  | "VES_EXECUTOR_TASK_INVALID"
  | "VES_EXECUTOR_APPROVAL_INVALID"
  | "VES_EXECUTOR_COORDINATION_INVALID"
  | "VES_EXECUTOR_WORKTREE_INVALID"
  | "VES_EXECUTOR_CONTEXT_INVALID"
  | "VES_EXECUTOR_TOOL_INVALID"
  | "VES_EXECUTOR_TASK_MISMATCH"
  | "VES_EXECUTOR_CAPABILITY_DENIED"
  | "VES_EXECUTOR_SCOPE_DENIED"
  | "VES_EXECUTOR_PROTECTED_PATH"
  | "VES_EXECUTOR_COMMIT_FORBIDDEN"
  | "VES_EXECUTOR_DRIVER_FAILED"
  | "VES_EXECUTOR_CANCELLED";

export class TaskExecutorError extends Error {
  readonly code: TaskExecutorErrorCode;

  constructor(code: TaskExecutorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskExecutorError";
    this.code = code;
  }
}

function fail(code: TaskExecutorErrorCode, message: string, options?: ErrorOptions): never {
  throw new TaskExecutorError(code, message, options);
}

function exactRow(value: unknown, label: string, allowed: readonly string[], code: TaskExecutorErrorCode): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const result = value as Row;
  if (Object.keys(result).some((key) => !allowed.includes(key))) fail(code, `${label} contains unknown fields`);
  return result;
}

function safe(value: unknown, label: string, code: TaskExecutorErrorCode): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function boundedText(value: unknown, label: string, code: TaskExecutorErrorCode): string {
  if (typeof value !== "string" || !PRINTABLE_TEXT.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_EXECUTOR_INPUT_INVALID", `${label} is invalid`);
  return value as Digest;
}

function stringList(
  value: unknown,
  label: string,
  pattern: RegExp = SAFE,
  code: TaskExecutorErrorCode = "VES_EXECUTOR_TASK_INVALID"
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) fail(code, `${label} is invalid`);
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !pattern.test(entry)) fail(code, `${label} contains an invalid value`);
    return entry;
  });
  if (new Set(result).size !== result.length) fail(code, `${label} contains duplicates`);
  return Object.freeze(result);
}

function textList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100)
    fail("VES_EXECUTOR_TASK_INVALID", `${label} is invalid`);
  const result = value.map((entry) => boundedText(entry, label, "VES_EXECUTOR_TASK_INVALID"));
  if (new Set(result).size !== result.length) fail("VES_EXECUTOR_TASK_INVALID", `${label} contains duplicates`);
  return Object.freeze(result);
}

function optionalSafeList(value: unknown, label: string, code: TaskExecutorErrorCode): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) fail(code, `${label} is invalid`);
  const result = value.map((entry) => safe(entry, label, code));
  if (new Set(result).size !== result.length) fail(code, `${label} contains duplicates`);
  return Object.freeze(result);
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const entry of Object.values(value as Row)) deepFreeze(entry, seen);
  return Object.freeze(value);
}

export interface AtomicExecutionTask {
  readonly taskId: string;
  readonly requirementIds: readonly string[];
  readonly dependencyTaskIds: readonly string[];
  readonly component: string;
  readonly changeScope: readonly string[];
  readonly protectedPaths: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly doneCriteria: readonly string[];
  readonly risk: "low" | "medium" | "high" | "critical";
  readonly expectedCommitBoundary: string;
}

export interface TaskExecutionInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runId: string;
  readonly executionPackageDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly sourceRevision: string;
  readonly contextManifestDigest: Digest;
  readonly mode: "personal" | "team";
  readonly task: AtomicExecutionTask;
  readonly authority: {
    readonly approvalRef: string;
    readonly approvalBindingDigest: Digest;
    readonly capabilityGrantRefs: readonly string[];
  };
}

export interface ExecutionToolRequest {
  readonly requestId: string;
  readonly taskId: string;
  readonly capabilityGrantRef: string;
  readonly operation: "write" | "delete" | "command";
  readonly targetPaths: readonly string[];
  readonly payloadRef: string;
}

export interface ExecutionAuthorityPort {
  verify(
    input: TaskExecutionInput,
    phase: "start" | "tool-effect"
  ): Promise<{
    readonly authorized: boolean;
    readonly bindingDigest?: string;
  }>;
}

export interface ExecutionCoordinationPort {
  acquire(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly taskId: string;
    readonly mode: "personal" | "team";
    readonly changeScope: readonly string[];
  }): Promise<{ readonly coordinationRef: string; readonly expiresAt: string }>;
  release(coordinationRef: string): Promise<void>;
}

export interface ExecutionWorktreePort {
  create(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly taskId: string;
    readonly sourceStateDigest: Digest;
    readonly sourceRevision: string;
    readonly changeScope: readonly string[];
    readonly protectedPaths: readonly string[];
  }): Promise<{ readonly worktreeRef: string; readonly baseCommit: string }>;
  inspect(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<{
    readonly changedPaths: readonly string[];
    readonly changeDigest: string;
    readonly commitCountSinceBase: number;
  }>;
  cleanup(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<void>;
}

export interface ExecutionCheckpoint {
  readonly checkpointRef?: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly stage: string;
  readonly sequence: number;
  readonly data: unknown;
}

export interface ExecutionCheckpointPort {
  load(workspaceId: string, runId: string, taskId: string): Promise<ExecutionCheckpoint | undefined>;
  save(checkpoint: Omit<ExecutionCheckpoint, "checkpointRef">): Promise<{ readonly checkpointRef: string }>;
}

export interface ExecutionContextPort {
  compile(input: {
    readonly task: AtomicExecutionTask;
    readonly executionPackageDigest: Digest;
    readonly expectedContextManifestDigest: Digest;
    readonly worktreeRef: string;
    readonly checkpoint: ExecutionCheckpoint | undefined;
  }): Promise<{ readonly contextRef: string; readonly contextDigest: string }>;
}

export interface ExecutionToolPort {
  invoke(request: ExecutionToolRequest & { readonly worktreeRef: string }): Promise<{
    readonly receiptRef: string;
    readonly outputRef?: string;
  }>;
}

export interface ExecutionDriverPort {
  execute(
    request: {
      readonly workspaceId: string;
      readonly runId: string;
      readonly task: AtomicExecutionTask;
      readonly worktreeRef: string;
      readonly contextRef: string;
      readonly checkpoint: ExecutionCheckpoint | undefined;
      readonly capabilityGrantRefs: readonly string[];
    },
    control: {
      readonly signal: AbortSignal | undefined;
      invokeTool(request: ExecutionToolRequest): Promise<{ readonly receiptRef: string; readonly outputRef?: string }>;
      checkpoint(stage: string, data: unknown): Promise<string>;
    }
  ): Promise<{ readonly status: "completed" | "failed" | "cancelled"; readonly outputRefs: readonly string[] }>;
  cancel(worktreeRef: string): Promise<void>;
}

interface TaskExecutorPorts {
  readonly authority: ExecutionAuthorityPort;
  readonly coordination: ExecutionCoordinationPort;
  readonly worktrees: ExecutionWorktreePort;
  readonly checkpoints: ExecutionCheckpointPort;
  readonly context: ExecutionContextPort;
  readonly tools: ExecutionToolPort;
  readonly driver: ExecutionDriverPort;
}

function normalizeTask(value: unknown): AtomicExecutionTask {
  const task = exactRow(
    value,
    "task",
    [
      "taskId",
      "requirementIds",
      "dependencyTaskIds",
      "component",
      "changeScope",
      "protectedPaths",
      "verificationCommands",
      "doneCriteria",
      "risk",
      "expectedCommitBoundary"
    ],
    "VES_EXECUTOR_TASK_INVALID"
  );
  const risk = task["risk"];
  if (!(risk === "low" || risk === "medium" || risk === "high" || risk === "critical"))
    fail("VES_EXECUTOR_TASK_INVALID", "task risk is invalid");
  return deepFreeze({
    taskId: safe(task["taskId"], "taskId", "VES_EXECUTOR_TASK_INVALID"),
    requirementIds: stringList(task["requirementIds"], "requirementIds", REQUIREMENT),
    dependencyTaskIds: stringList(task["dependencyTaskIds"], "dependencyTaskIds"),
    component: safe(task["component"], "component", "VES_EXECUTOR_TASK_INVALID"),
    changeScope: stringList(task["changeScope"], "changeScope", LOGICAL_PATH),
    protectedPaths: stringList(task["protectedPaths"], "protectedPaths", LOGICAL_PATH),
    verificationCommands: textList(task["verificationCommands"], "verificationCommands"),
    doneCriteria: textList(task["doneCriteria"], "doneCriteria"),
    risk,
    expectedCommitBoundary: boundedText(
      task["expectedCommitBoundary"],
      "expectedCommitBoundary",
      "VES_EXECUTOR_TASK_INVALID"
    )
  });
}

function normalizeInput(value: unknown): TaskExecutionInput {
  const input = exactRow(
    value,
    "task execution input",
    [
      "schemaVersion",
      "workspaceId",
      "runId",
      "executionPackageDigest",
      "sourceStateDigest",
      "sourceRevision",
      "contextManifestDigest",
      "mode",
      "task",
      "authority"
    ],
    "VES_EXECUTOR_INPUT_INVALID"
  );
  if (input["schemaVersion"] !== 1 || !(input["mode"] === "personal" || input["mode"] === "team"))
    fail("VES_EXECUTOR_INPUT_INVALID", "task execution schema or mode is invalid");
  const authority = exactRow(
    input["authority"],
    "execution authority",
    ["approvalRef", "approvalBindingDigest", "capabilityGrantRefs"],
    "VES_EXECUTOR_INPUT_INVALID"
  );
  return deepFreeze({
    schemaVersion: 1,
    workspaceId: safe(input["workspaceId"], "workspaceId", "VES_EXECUTOR_INPUT_INVALID"),
    runId: safe(input["runId"], "runId", "VES_EXECUTOR_INPUT_INVALID"),
    executionPackageDigest: digest(input["executionPackageDigest"], "executionPackageDigest"),
    sourceStateDigest: digest(input["sourceStateDigest"], "sourceStateDigest"),
    sourceRevision:
      typeof input["sourceRevision"] === "string" && GIT_OBJECT_ID.test(input["sourceRevision"])
        ? input["sourceRevision"]
        : fail("VES_EXECUTOR_INPUT_INVALID", "sourceRevision is invalid"),
    contextManifestDigest: digest(input["contextManifestDigest"], "contextManifestDigest"),
    mode: input["mode"],
    task: normalizeTask(input["task"]),
    authority: Object.freeze({
      approvalRef: safe(authority["approvalRef"], "approvalRef", "VES_EXECUTOR_INPUT_INVALID"),
      approvalBindingDigest: digest(authority["approvalBindingDigest"], "approvalBindingDigest"),
      capabilityGrantRefs: stringList(
        authority["capabilityGrantRefs"],
        "capabilityGrantRefs",
        SAFE,
        "VES_EXECUTOR_INPUT_INVALID"
      )
    })
  });
}

function logicalPath(value: string): string {
  if (!LOGICAL_PATH.test(value)) fail("VES_EXECUTOR_SCOPE_DENIED", "Tool target is not a logical path");
  return value.replaceAll(/\/{2,}/gu, "/").replace(/\/$/u, "");
}

function within(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function assertTarget(task: AtomicExecutionTask, value: string): string {
  const path = logicalPath(value);
  if (within(path, task.protectedPaths)) fail("VES_EXECUTOR_PROTECTED_PATH", "Tool target is protected");
  if (!within(path, task.changeScope)) fail("VES_EXECUTOR_SCOPE_DENIED", "Tool target is outside task scope");
  return path;
}

export class TaskExecutionCoordinator {
  readonly #ports: TaskExecutorPorts;

  constructor(ports: TaskExecutorPorts) {
    this.#ports = ports;
  }

  async execute(inputValue: unknown, options: { readonly signal?: AbortSignal } = {}) {
    if (options.signal?.aborted === true) fail("VES_EXECUTOR_CANCELLED", "Task execution was cancelled before start");
    const input = normalizeInput(inputValue);
    let coordinationRef: string | undefined;
    let worktree: { readonly worktreeRef: string; readonly baseCommit: string } | undefined;
    let driverStarted = false;
    let sequence = 0;
    let lastCheckpoint = await this.#ports.checkpoints.load(input.workspaceId, input.runId, input.task.taskId);
    if (lastCheckpoint !== undefined) {
      if (
        lastCheckpoint.workspaceId !== input.workspaceId ||
        lastCheckpoint.runId !== input.runId ||
        lastCheckpoint.taskId !== input.task.taskId ||
        !SAFE.test(lastCheckpoint.stage) ||
        (lastCheckpoint.checkpointRef !== undefined && !SAFE.test(lastCheckpoint.checkpointRef)) ||
        !Number.isSafeInteger(lastCheckpoint.sequence) ||
        lastCheckpoint.sequence < 0
      )
        fail("VES_EXECUTOR_INPUT_INVALID", "recovered checkpoint is invalid");
      sequence = lastCheckpoint.sequence;
    }
    const toolReceiptRefs: string[] = [];
    const toolOutputRefs: string[] = [];
    const saveCheckpoint = async (stage: string, data: unknown): Promise<string> => {
      const checkpoint = {
        workspaceId: input.workspaceId,
        runId: input.runId,
        taskId: input.task.taskId,
        stage: safe(stage, "checkpoint stage", "VES_EXECUTOR_INPUT_INVALID"),
        sequence: ++sequence,
        data
      };
      const saved = await this.#ports.checkpoints.save(checkpoint);
      lastCheckpoint = { ...checkpoint, checkpointRef: saved.checkpointRef };
      return saved.checkpointRef;
    };
    try {
      await this.#assertAuthority(input, "start");
      const coordination = await this.#ports.coordination.acquire({
        workspaceId: input.workspaceId,
        runId: input.runId,
        taskId: input.task.taskId,
        mode: input.mode,
        changeScope: input.task.changeScope
      });
      if (!SAFE.test(coordination.coordinationRef) || !Number.isFinite(Date.parse(coordination.expiresAt)))
        fail("VES_EXECUTOR_COORDINATION_INVALID", "writer coordination is invalid");
      coordinationRef = coordination.coordinationRef;
      worktree = await this.#ports.worktrees.create({
        workspaceId: input.workspaceId,
        runId: input.runId,
        taskId: input.task.taskId,
        sourceStateDigest: input.sourceStateDigest,
        sourceRevision: input.sourceRevision,
        changeScope: input.task.changeScope,
        protectedPaths: input.task.protectedPaths
      });
      if (!SAFE.test(worktree.worktreeRef) || !/^[a-f0-9]{40,64}$/u.test(worktree.baseCommit))
        fail("VES_EXECUTOR_WORKTREE_INVALID", "isolated worktree handle is invalid");
      const context = await this.#ports.context.compile({
        task: input.task,
        executionPackageDigest: input.executionPackageDigest,
        expectedContextManifestDigest: input.contextManifestDigest,
        worktreeRef: worktree.worktreeRef,
        checkpoint: lastCheckpoint
      });
      if (!SAFE.test(context.contextRef) || context.contextDigest !== input.contextManifestDigest)
        fail("VES_EXECUTOR_CONTEXT_INVALID", "compiled execution Context is invalid");
      driverStarted = true;
      const driverResult = await this.#ports.driver.execute(
        {
          workspaceId: input.workspaceId,
          runId: input.runId,
          task: input.task,
          worktreeRef: worktree.worktreeRef,
          contextRef: context.contextRef,
          checkpoint: lastCheckpoint,
          capabilityGrantRefs: input.authority.capabilityGrantRefs
        },
        {
          signal: options.signal,
          checkpoint: saveCheckpoint,
          invokeTool: async (requestValue) => {
            const request = this.#normalizeToolRequest(requestValue, input);
            await this.#assertAuthority(input, "tool-effect");
            const result = await this.#ports.tools.invoke({ ...request, worktreeRef: worktree!.worktreeRef });
            if (!SAFE.test(result.receiptRef) || (result.outputRef !== undefined && !SAFE.test(result.outputRef)))
              fail("VES_EXECUTOR_TOOL_INVALID", "Tool result is invalid");
            toolReceiptRefs.push(result.receiptRef);
            if (result.outputRef !== undefined) toolOutputRefs.push(result.outputRef);
            return result;
          }
        }
      );
      const driverRow = exactRow(driverResult, "Driver result", ["status", "outputRefs"], "VES_EXECUTOR_DRIVER_FAILED");
      const driverStatus = driverRow["status"];
      if (!(driverStatus === "completed" || driverStatus === "failed" || driverStatus === "cancelled"))
        fail("VES_EXECUTOR_DRIVER_FAILED", "Task Driver returned an invalid status");
      const driverOutputRefs = optionalSafeList(
        driverRow["outputRefs"],
        "Driver outputRefs",
        "VES_EXECUTOR_DRIVER_FAILED"
      );
      if (driverStatus === "cancelled" || Boolean(options.signal?.aborted))
        fail("VES_EXECUTOR_CANCELLED", "Task Driver was cancelled");
      if (driverStatus !== "completed") fail("VES_EXECUTOR_DRIVER_FAILED", "Task Driver did not complete");
      const inspection = await this.#ports.worktrees.inspect(worktree);
      if (
        !DIGEST.test(inspection.changeDigest) ||
        !Number.isSafeInteger(inspection.commitCountSinceBase) ||
        inspection.commitCountSinceBase < 0 ||
        !Array.isArray(inspection.changedPaths) ||
        inspection.changedPaths.length > 10_000
      )
        fail("VES_EXECUTOR_WORKTREE_INVALID", "worktree inspection is invalid");
      if (inspection.commitCountSinceBase !== 0)
        fail("VES_EXECUTOR_COMMIT_FORBIDDEN", "Task Driver created a commit before its gate");
      const changedPaths = inspection.changedPaths.map((path) => {
        if (typeof path !== "string") fail("VES_EXECUTOR_WORKTREE_INVALID", "worktree path is invalid");
        return assertTarget(input.task, path);
      });
      const checkpointRef = await saveCheckpoint("awaiting-gate", {
        changeDigest: inspection.changeDigest,
        changedPaths,
        toolReceiptRefs
      });
      return deepFreeze({
        status: "AWAITING_GATE" as const,
        workspaceId: input.workspaceId,
        runId: input.runId,
        taskId: input.task.taskId,
        requirementIds: input.task.requirementIds,
        worktreeRef: worktree.worktreeRef,
        baseCommit: worktree.baseCommit,
        coordinationRef,
        changeDigest: inspection.changeDigest,
        changedPaths,
        checkpointRef,
        toolReceiptRefs,
        outputRefs: [...driverOutputRefs, ...toolOutputRefs]
      });
    } catch (error) {
      const cancelled = error instanceof TaskExecutorError && error.code === "VES_EXECUTOR_CANCELLED";
      if (driverStarted && worktree !== undefined) {
        try {
          await this.#ports.driver.cancel(worktree.worktreeRef);
        } catch {
          // The original failure remains authoritative.
        }
      }
      if (worktree !== undefined) {
        try {
          await saveCheckpoint(cancelled ? "cancelled" : "failed", {
            errorCode: error instanceof TaskExecutorError ? error.code : "VES_EXECUTOR_DRIVER_FAILED",
            requirementIds: input.task.requirementIds
          });
        } catch {
          // Checkpoint failure must not replace the primary execution failure.
        }
        try {
          await this.#ports.worktrees.cleanup(worktree);
        } catch {
          // Cleanup is reconciled later; preserve the primary failure.
        }
      }
      if (coordinationRef !== undefined) {
        try {
          await this.#ports.coordination.release(coordinationRef);
        } catch {
          // Release is reconciled later; preserve the primary failure.
        }
      }
      throw error;
    }
  }

  async #assertAuthority(input: TaskExecutionInput, phase: "start" | "tool-effect"): Promise<void> {
    const result = await this.#ports.authority.verify(input, phase);
    if (!result.authorized || result.bindingDigest !== input.authority.approvalBindingDigest)
      fail("VES_EXECUTOR_APPROVAL_INVALID", "Execution Approval is missing or stale");
  }

  #normalizeToolRequest(value: unknown, input: TaskExecutionInput): ExecutionToolRequest {
    const request = exactRow(
      value,
      "Tool request",
      ["requestId", "taskId", "capabilityGrantRef", "operation", "targetPaths", "payloadRef"],
      "VES_EXECUTOR_TOOL_INVALID"
    );
    if (!(request["operation"] === "write" || request["operation"] === "delete" || request["operation"] === "command"))
      fail("VES_EXECUTOR_TOOL_INVALID", "Tool operation is invalid");
    const taskId = safe(request["taskId"], "Tool taskId", "VES_EXECUTOR_TOOL_INVALID");
    if (taskId !== input.task.taskId) fail("VES_EXECUTOR_TASK_MISMATCH", "Tool request belongs to another task");
    const capabilityGrantRef = safe(request["capabilityGrantRef"], "capabilityGrantRef", "VES_EXECUTOR_TOOL_INVALID");
    if (!input.authority.capabilityGrantRefs.includes(capabilityGrantRef))
      fail("VES_EXECUTOR_CAPABILITY_DENIED", "Tool request lacks a declared capability grant");
    return deepFreeze({
      requestId: safe(request["requestId"], "requestId", "VES_EXECUTOR_TOOL_INVALID"),
      taskId,
      capabilityGrantRef,
      operation: request["operation"],
      targetPaths: stringList(request["targetPaths"], "targetPaths", LOGICAL_PATH, "VES_EXECUTOR_SCOPE_DENIED").map(
        (path) => assertTarget(input.task, path)
      ),
      payloadRef: safe(request["payloadRef"], "payloadRef", "VES_EXECUTOR_TOOL_INVALID")
    });
  }
}
