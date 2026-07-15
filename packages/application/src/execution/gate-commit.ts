type Digest = `sha256:${string}`;
type Row = Record<string, unknown>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const REQUIREMENT = /^VES-[A-Z]{3}-[0-9]{3}$/u;
const LOGICAL_PATH = /^(?:\.|(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+)$/u;
const PRINTABLE = /^[\x20-\x7e]{1,512}$/u;

export type TaskGateErrorCode =
  | "VES_GATE_INPUT_INVALID"
  | "VES_GATE_PLAN_INVALID"
  | "VES_GATE_APPROVAL_INVALID"
  | "VES_GATE_DIFF_INVALID"
  | "VES_GATE_DIFF_DRIFT"
  | "VES_GATE_PROTECTED_PATH"
  | "VES_GATE_SCOPE_DENIED"
  | "VES_GATE_COMMIT_CONFLICT"
  | "VES_GATE_NO_CHANGES"
  | "VES_GATE_RUNNER_INVALID"
  | "VES_GATE_EVIDENCE_INVALID"
  | "VES_GATE_CHECKPOINT_INVALID"
  | "VES_GATE_COMMIT_RECEIPT_INVALID";

export class TaskGateError extends Error {
  readonly code: TaskGateErrorCode;

  constructor(code: TaskGateErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaskGateError";
    this.code = code;
  }
}

function fail(code: TaskGateErrorCode, message: string, options?: ErrorOptions): never {
  throw new TaskGateError(code, message, options);
}

function exact(value: unknown, label: string, allowed: readonly string[], code: TaskGateErrorCode): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const row = value as Row;
  if (Object.keys(row).some((key) => !allowed.includes(key))) fail(code, `${label} contains unknown fields`);
  return row;
}

function token(value: unknown, label: string, code: TaskGateErrorCode): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function text(value: unknown, label: string, code: TaskGateErrorCode): string {
  if (typeof value !== "string" || !PRINTABLE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string, code: TaskGateErrorCode = "VES_GATE_INPUT_INVALID"): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code, `${label} is invalid`);
  return value as Digest;
}

function list(
  value: unknown,
  label: string,
  pattern: RegExp,
  code: TaskGateErrorCode,
  allowEmpty = false
): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100)
    fail(code, `${label} is invalid`);
  const result = value.map((entry) => {
    if (typeof entry !== "string" || !pattern.test(entry)) fail(code, `${label} contains an invalid value`);
    return entry;
  });
  if (new Set(result).size !== result.length) fail(code, `${label} contains duplicates`);
  return Object.freeze(result);
}

function integer(value: unknown, label: string, min: number, max: number, code: TaskGateErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(code, `${label} is invalid`);
  return value as number;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Row)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Row)) freeze(child, seen);
  return Object.freeze(value);
}

export interface TaskGateCommand {
  readonly gateId: string;
  readonly requirementIds: readonly string[];
  readonly declaredCommand: string;
  readonly commandRef: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly outputLimitBytes: number;
  readonly resultProtocol: "exit-code" | "test-summary";
  readonly minimumTests: number;
}

interface NormalizedGatePlanMaterial {
  readonly schemaVersion: 1;
  readonly commands: readonly TaskGateCommand[];
}

function normalizePlanMaterial(value: unknown): NormalizedGatePlanMaterial {
  const plan = exact(value, "gate plan", ["schemaVersion", "commands"], "VES_GATE_PLAN_INVALID");
  if (plan["schemaVersion"] !== 1 || !Array.isArray(plan["commands"]) || plan["commands"].length === 0)
    fail("VES_GATE_PLAN_INVALID", "gate plan is invalid");
  if (plan["commands"].length > 50) fail("VES_GATE_PLAN_INVALID", "gate plan has too many commands");
  const commands = plan["commands"].map((value, index) => {
    const command = exact(
      value,
      `gate command ${index}`,
      [
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
      ],
      "VES_GATE_PLAN_INVALID"
    );
    const resultProtocol = command["resultProtocol"];
    if (!(resultProtocol === "exit-code" || resultProtocol === "test-summary"))
      fail("VES_GATE_PLAN_INVALID", "gate result protocol is invalid");
    const normalizedProtocol: TaskGateCommand["resultProtocol"] = resultProtocol;
    const minimumTests = integer(command["minimumTests"], "minimumTests", 0, 1_000_000, "VES_GATE_PLAN_INVALID");
    if ((normalizedProtocol === "test-summary") !== minimumTests > 0)
      fail("VES_GATE_PLAN_INVALID", "test gates require a positive immutable test baseline");
    const args = list(command["args"], "gate args", PRINTABLE, "VES_GATE_PLAN_INVALID", true);
    return freeze({
      gateId: token(command["gateId"], "gateId", "VES_GATE_PLAN_INVALID"),
      requirementIds: [
        ...list(command["requirementIds"], "gate requirementIds", REQUIREMENT, "VES_GATE_PLAN_INVALID")
      ].sort(),
      declaredCommand: text(command["declaredCommand"], "declaredCommand", "VES_GATE_PLAN_INVALID"),
      commandRef: token(command["commandRef"], "commandRef", "VES_GATE_PLAN_INVALID"),
      args,
      cwd:
        typeof command["cwd"] === "string" && LOGICAL_PATH.test(command["cwd"])
          ? command["cwd"]
          : fail("VES_GATE_PLAN_INVALID", "gate cwd is invalid"),
      timeoutMs: integer(command["timeoutMs"], "timeoutMs", 1, 3_600_000, "VES_GATE_PLAN_INVALID"),
      outputLimitBytes: integer(
        command["outputLimitBytes"],
        "outputLimitBytes",
        1,
        16_000_000,
        "VES_GATE_PLAN_INVALID"
      ),
      resultProtocol: normalizedProtocol,
      minimumTests
    });
  });
  if (new Set(commands.map((entry) => entry.gateId)).size !== commands.length)
    fail("VES_GATE_PLAN_INVALID", "gate IDs must be unique");
  if (new Set(commands.map((entry) => entry.declaredCommand)).size !== commands.length)
    fail("VES_GATE_PLAN_INVALID", "declared gate commands must be unique");
  return freeze({ schemaVersion: 1, commands });
}

export function canonicalTaskGatePlan(value: unknown): string {
  return canonicalJson(normalizePlanMaterial(value));
}

export interface TaskGateCommitInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly runId: string;
  readonly task: {
    readonly taskId: string;
    readonly requirementIds: readonly string[];
    readonly verificationCommands: readonly string[];
    readonly changeScope: readonly string[];
    readonly protectedPaths: readonly string[];
    readonly expectedCommitBoundary: string;
  };
  readonly execution: {
    readonly worktreeRef: string;
    readonly baseCommit: string;
    readonly coordinationRef: string;
    readonly changeDigest: Digest;
    readonly changedPaths: readonly string[];
    readonly checkpointRef: string;
  };
  readonly authority: { readonly approvalBindingDigest: Digest };
  readonly gatePlan: NormalizedGatePlanMaterial & { readonly planDigest: Digest };
}

export interface TaskGateRunnerResult {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly outputLimitExceeded: boolean;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly outputRef: string;
  readonly tests?: {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly cancelled: number;
    readonly todo: number;
  };
}

interface GatePorts {
  readonly digest: { sha256(value: string): string };
  readonly authority: {
    verify(input: TaskGateCommitInput): Promise<{
      readonly authorized: boolean;
      readonly bindingDigest?: string;
      readonly gatePlanDigest?: string;
    }>;
  };
  readonly worktrees: {
    inspect(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<{
      readonly changedPaths: readonly string[];
      readonly changeDigest: string;
      readonly commitCountSinceBase: number;
    }>;
    cleanup(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<void>;
  };
  readonly gates: { run(command: TaskGateCommand & { readonly worktreeRef: string }): Promise<TaskGateRunnerResult> };
  readonly evidence: {
    record(
      entry: Readonly<Record<string, unknown>>
    ): Promise<{ readonly evidenceRef: string; readonly evidenceDigest: string }>;
  };
  readonly checkpoints: {
    load(workspaceId: string, runId: string, taskId: string): Promise<unknown>;
    save(entry: Readonly<Record<string, unknown>>): Promise<{ readonly checkpointRef: string }>;
  };
  readonly git: {
    reconcile(request: AtomicCommitRequest): Promise<unknown>;
    commitAtomic(request: AtomicCommitRequest): Promise<unknown>;
  };
  readonly coordination: {
    verify(coordinationRef: string): Promise<{ readonly active: boolean }>;
    release(coordinationRef: string): Promise<void>;
  };
}

interface AtomicCommitRequest {
  readonly workspaceId: string;
  readonly runId: string;
  readonly taskId: string;
  readonly requirementIds: readonly string[];
  readonly worktreeRef: string;
  readonly baseCommit: string;
  readonly subject: string;
  readonly expectedChangedPaths: readonly string[];
  readonly expectedChangeDigest: Digest;
  readonly gatePlanDigest: Digest;
  readonly gateEvidenceDigest: Digest;
  readonly gateEvidenceRefs: readonly string[];
  readonly idempotencyKey: Digest;
}

function normalizeInput(value: unknown, sha256: (value: string) => string): TaskGateCommitInput {
  const input = exact(
    value,
    "gate commit input",
    ["schemaVersion", "workspaceId", "runId", "task", "execution", "authority", "gatePlan"],
    "VES_GATE_INPUT_INVALID"
  );
  if (input["schemaVersion"] !== 1) fail("VES_GATE_INPUT_INVALID", "gate commit schema is invalid");
  const task = exact(
    input["task"],
    "gate task",
    ["taskId", "requirementIds", "verificationCommands", "changeScope", "protectedPaths", "expectedCommitBoundary"],
    "VES_GATE_INPUT_INVALID"
  );
  const execution = exact(
    input["execution"],
    "gate execution",
    ["worktreeRef", "baseCommit", "coordinationRef", "changeDigest", "changedPaths", "checkpointRef"],
    "VES_GATE_INPUT_INVALID"
  );
  const authority = exact(input["authority"], "gate authority", ["approvalBindingDigest"], "VES_GATE_INPUT_INVALID");
  const rawPlan = exact(
    input["gatePlan"],
    "gate plan",
    ["schemaVersion", "commands", "planDigest"],
    "VES_GATE_PLAN_INVALID"
  );
  const plan = normalizePlanMaterial({ schemaVersion: rawPlan["schemaVersion"], commands: rawPlan["commands"] });
  const planDigest = digest(rawPlan["planDigest"], "gatePlan.planDigest", "VES_GATE_PLAN_INVALID");
  if (sha256(canonicalJson(plan)) !== planDigest)
    fail("VES_GATE_PLAN_INVALID", "gate plan digest does not match content");
  const requirementIds = [
    ...list(task["requirementIds"], "task requirementIds", REQUIREMENT, "VES_GATE_INPUT_INVALID")
  ].sort();
  const verificationCommands = list(
    task["verificationCommands"],
    "verificationCommands",
    PRINTABLE,
    "VES_GATE_INPUT_INVALID"
  );
  const declared = plan.commands.map((entry) => entry.declaredCommand).sort();
  if (canonicalJson(declared) !== canonicalJson([...verificationCommands].sort()))
    fail("VES_GATE_PLAN_INVALID", "gate plan does not exactly cover declared verification commands");
  const covered = new Set(plan.commands.flatMap((entry) => entry.requirementIds));
  if (requirementIds.some((requirementId) => !covered.has(requirementId)))
    fail("VES_GATE_PLAN_INVALID", "gate plan leaves a task requirement uncovered");
  if (plan.commands.some((entry) => entry.requirementIds.some((id) => !requirementIds.includes(id))))
    fail("VES_GATE_PLAN_INVALID", "gate plan references a requirement outside the task");
  const baseCommit = execution["baseCommit"];
  if (typeof baseCommit !== "string" || !OBJECT_ID.test(baseCommit))
    fail("VES_GATE_INPUT_INVALID", "baseCommit is invalid");
  return freeze({
    schemaVersion: 1,
    workspaceId: token(input["workspaceId"], "workspaceId", "VES_GATE_INPUT_INVALID"),
    runId: token(input["runId"], "runId", "VES_GATE_INPUT_INVALID"),
    task: {
      taskId: token(task["taskId"], "taskId", "VES_GATE_INPUT_INVALID"),
      requirementIds,
      verificationCommands,
      changeScope: list(task["changeScope"], "changeScope", LOGICAL_PATH, "VES_GATE_INPUT_INVALID"),
      protectedPaths: list(task["protectedPaths"], "protectedPaths", LOGICAL_PATH, "VES_GATE_INPUT_INVALID"),
      expectedCommitBoundary: text(task["expectedCommitBoundary"], "expectedCommitBoundary", "VES_GATE_INPUT_INVALID")
    },
    execution: {
      worktreeRef: token(execution["worktreeRef"], "worktreeRef", "VES_GATE_INPUT_INVALID"),
      baseCommit,
      coordinationRef: token(execution["coordinationRef"], "coordinationRef", "VES_GATE_INPUT_INVALID"),
      changeDigest: digest(execution["changeDigest"], "execution.changeDigest"),
      changedPaths: [
        ...list(execution["changedPaths"], "changedPaths", LOGICAL_PATH, "VES_GATE_INPUT_INVALID", true)
      ].sort(),
      checkpointRef: token(execution["checkpointRef"], "checkpointRef", "VES_GATE_INPUT_INVALID")
    },
    authority: { approvalBindingDigest: digest(authority["approvalBindingDigest"], "approvalBindingDigest") },
    gatePlan: { ...plan, planDigest }
  });
}

function within(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

function normalizeInspection(value: unknown) {
  const row = exact(
    value,
    "worktree inspection",
    ["changedPaths", "changeDigest", "commitCountSinceBase"],
    "VES_GATE_DIFF_INVALID"
  );
  return {
    changedPaths: [
      ...list(row["changedPaths"], "inspection changedPaths", LOGICAL_PATH, "VES_GATE_DIFF_INVALID", true)
    ].sort(),
    changeDigest: digest(row["changeDigest"], "inspection changeDigest", "VES_GATE_DIFF_INVALID"),
    commitCountSinceBase: integer(
      row["commitCountSinceBase"],
      "commitCountSinceBase",
      0,
      1_000_000,
      "VES_GATE_DIFF_INVALID"
    )
  };
}

function normalizeRunner(value: unknown, protocol: TaskGateCommand["resultProtocol"]): TaskGateRunnerResult {
  const row = exact(
    value,
    "gate runner result",
    [
      "exitCode",
      "timedOut",
      "outputLimitExceeded",
      "stdoutDigest",
      "stderrDigest",
      "stdoutBytes",
      "stderrBytes",
      "outputRef",
      "tests"
    ],
    "VES_GATE_RUNNER_INVALID"
  );
  if (typeof row["timedOut"] !== "boolean" || typeof row["outputLimitExceeded"] !== "boolean")
    fail("VES_GATE_RUNNER_INVALID", "gate runner flags are invalid");
  const base = {
    exitCode: integer(row["exitCode"], "exitCode", -1, 255, "VES_GATE_RUNNER_INVALID"),
    timedOut: row["timedOut"],
    outputLimitExceeded: row["outputLimitExceeded"],
    stdoutDigest: digest(row["stdoutDigest"], "stdoutDigest", "VES_GATE_RUNNER_INVALID"),
    stderrDigest: digest(row["stderrDigest"], "stderrDigest", "VES_GATE_RUNNER_INVALID"),
    stdoutBytes: integer(row["stdoutBytes"], "stdoutBytes", 0, 16_000_000, "VES_GATE_RUNNER_INVALID"),
    stderrBytes: integer(row["stderrBytes"], "stderrBytes", 0, 16_000_000, "VES_GATE_RUNNER_INVALID"),
    outputRef: token(row["outputRef"], "outputRef", "VES_GATE_RUNNER_INVALID")
  };
  if (protocol === "exit-code") {
    if (row["tests"] !== undefined) fail("VES_GATE_RUNNER_INVALID", "exit-code gate returned test authority");
    return freeze(base);
  }
  const tests = exact(
    row["tests"],
    "test summary",
    ["total", "passed", "failed", "skipped", "cancelled", "todo"],
    "VES_GATE_RUNNER_INVALID"
  );
  return freeze({
    ...base,
    tests: {
      total: integer(tests["total"], "tests.total", 0, 1_000_000, "VES_GATE_RUNNER_INVALID"),
      passed: integer(tests["passed"], "tests.passed", 0, 1_000_000, "VES_GATE_RUNNER_INVALID"),
      failed: integer(tests["failed"], "tests.failed", 0, 1_000_000, "VES_GATE_RUNNER_INVALID"),
      skipped: integer(tests["skipped"], "tests.skipped", 0, 1_000_000, "VES_GATE_RUNNER_INVALID"),
      cancelled: integer(tests["cancelled"], "tests.cancelled", 0, 1_000_000, "VES_GATE_RUNNER_INVALID"),
      todo: integer(tests["todo"], "tests.todo", 0, 1_000_000, "VES_GATE_RUNNER_INVALID")
    }
  });
}

function gatePassed(command: TaskGateCommand, result: TaskGateRunnerResult): boolean {
  if (result.exitCode !== 0 || result.timedOut || result.outputLimitExceeded) return false;
  if (command.resultProtocol === "exit-code") return true;
  const tests = result.tests!;
  return (
    tests.total === tests.passed + tests.failed + tests.skipped + tests.cancelled + tests.todo &&
    tests.passed >= command.minimumTests &&
    tests.failed === 0 &&
    tests.skipped === 0 &&
    tests.cancelled === 0 &&
    tests.todo === 0
  );
}

export class TaskGateCommitCoordinator {
  readonly #ports: GatePorts;

  constructor(ports: GatePorts) {
    this.#ports = ports;
  }

  async execute(value: unknown) {
    const input = normalizeInput(value, (material) => this.#ports.digest.sha256(material));
    await this.#assertAuthority(input);
    await this.#assertCoordination(input.execution.coordinationRef);

    const prior = await this.#ports.checkpoints.load(input.workspaceId, input.runId, input.task.taskId);
    const resumed = this.#normalizePrior(prior, input);
    if (resumed !== undefined) {
      const request = this.#commitRequest(input, resumed.gateEvidenceDigest, resumed.gateEvidenceRefs);
      const reconciled = await this.#ports.git.reconcile(request);
      if (reconciled !== undefined) return await this.#finalize(input, request, reconciled, resumed.gateEvidenceRefs);
    }

    const handle = { worktreeRef: input.execution.worktreeRef, baseCommit: input.execution.baseCommit };
    const before = normalizeInspection(await this.#ports.worktrees.inspect(handle));
    this.#assertInspection(input, before, true);
    if (before.changedPaths.length === 0) fail("VES_GATE_NO_CHANGES", "task has no changes to commit");

    const evidenceRefs: string[] = [];
    const evidenceDigests: string[] = [];
    for (const command of input.gatePlan.commands) {
      await this.#assertAuthority(input);
      await this.#assertCoordination(input.execution.coordinationRef);
      const result = normalizeRunner(
        await this.#ports.gates.run({ ...command, worktreeRef: input.execution.worktreeRef }),
        command.resultProtocol
      );
      const passed = gatePassed(command, result);
      const entry = freeze({
        schemaVersion: 1,
        workspaceId: input.workspaceId,
        runId: input.runId,
        taskId: input.task.taskId,
        gatePlanDigest: input.gatePlan.planDigest,
        gateId: command.gateId,
        requirementIds: command.requirementIds,
        declaredCommand: command.declaredCommand,
        commandRef: command.commandRef,
        argsDigest: this.#digest(canonicalJson(command.args)),
        timeoutMs: command.timeoutMs,
        outputLimitBytes: command.outputLimitBytes,
        resultProtocol: command.resultProtocol,
        minimumTests: command.minimumTests,
        verdict: passed ? "PASS" : "FAIL",
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        outputLimitExceeded: result.outputLimitExceeded,
        stdoutDigest: result.stdoutDigest,
        stderrDigest: result.stderrDigest,
        stdoutBytes: result.stdoutBytes,
        stderrBytes: result.stderrBytes,
        outputRef: result.outputRef,
        ...(result.tests === undefined ? {} : { tests: result.tests })
      });
      const recorded = await this.#ports.evidence.record(entry);
      const evidenceRef = token(recorded.evidenceRef, "gate evidenceRef", "VES_GATE_EVIDENCE_INVALID");
      const evidenceDigest = digest(recorded.evidenceDigest, "gate evidenceDigest", "VES_GATE_EVIDENCE_INVALID");
      evidenceRefs.push(evidenceRef);
      evidenceDigests.push(evidenceDigest);
      if (!passed) {
        await this.#save(input, "gate-failed", {
          gateId: command.gateId,
          requirementIds: command.requirementIds,
          evidenceRef,
          evidenceDigest
        });
        return freeze({
          status: "GATE_FAILED" as const,
          taskId: input.task.taskId,
          failedGateId: command.gateId,
          requirementIds: command.requirementIds,
          evidenceRef
        });
      }
    }

    const after = normalizeInspection(await this.#ports.worktrees.inspect(handle));
    this.#assertInspection(input, after, false);
    const gateEvidenceDigest = this.#digest(canonicalJson({ evidenceDigests, evidenceRefs }));
    await this.#save(input, "gates-passed", { gateEvidenceDigest, gateEvidenceRefs: evidenceRefs });
    const request = this.#commitRequest(input, gateEvidenceDigest, evidenceRefs);
    let receipt: unknown;
    try {
      await this.#assertAuthority(input);
      await this.#assertCoordination(input.execution.coordinationRef);
      receipt = await this.#ports.git.commitAtomic(request);
    } catch (error) {
      await this.#save(input, "commit-uncertain", { gateEvidenceDigest, gateEvidenceRefs: evidenceRefs });
      throw error;
    }
    return await this.#finalize(input, request, receipt, evidenceRefs);
  }

  #assertInspection(input: TaskGateCommitInput, inspection: ReturnType<typeof normalizeInspection>, initial: boolean) {
    if (inspection.commitCountSinceBase !== 0)
      fail("VES_GATE_COMMIT_CONFLICT", "worktree already contains a task commit");
    for (const path of inspection.changedPaths) {
      if (within(path, input.task.protectedPaths)) fail("VES_GATE_PROTECTED_PATH", "protected path changed");
      if (!within(path, input.task.changeScope)) fail("VES_GATE_SCOPE_DENIED", "changed path is outside task scope");
    }
    if (
      inspection.changeDigest !== input.execution.changeDigest ||
      canonicalJson(inspection.changedPaths) !== canonicalJson(input.execution.changedPaths)
    )
      fail("VES_GATE_DIFF_DRIFT", initial ? "pre-gate diff drifted" : "gate changed the implementation diff");
  }

  async #assertAuthority(input: TaskGateCommitInput): Promise<void> {
    const authority = await this.#ports.authority.verify(input);
    if (
      !authority.authorized ||
      authority.bindingDigest !== input.authority.approvalBindingDigest ||
      authority.gatePlanDigest !== input.gatePlan.planDigest
    )
      fail("VES_GATE_APPROVAL_INVALID", "gate authority is missing or stale");
  }

  async #assertCoordination(coordinationRef: string): Promise<void> {
    const coordination = await this.#ports.coordination.verify(coordinationRef);
    if (!coordination.active) fail("VES_GATE_COMMIT_CONFLICT", "writer coordination is missing or expired");
  }

  #normalizePrior(value: unknown, input: TaskGateCommitInput) {
    if (value === undefined) return undefined;
    const row = exact(
      value,
      "gate checkpoint",
      [
        "stage",
        "workspaceId",
        "runId",
        "taskId",
        "gatePlanDigest",
        "changeDigest",
        "gateEvidenceDigest",
        "gateEvidenceRefs"
      ],
      "VES_GATE_CHECKPOINT_INVALID"
    );
    if (
      !(row["stage"] === "gates-passed" || row["stage"] === "commit-uncertain") ||
      row["workspaceId"] !== input.workspaceId ||
      row["runId"] !== input.runId ||
      row["taskId"] !== input.task.taskId ||
      row["gatePlanDigest"] !== input.gatePlan.planDigest ||
      row["changeDigest"] !== input.execution.changeDigest
    )
      fail("VES_GATE_CHECKPOINT_INVALID", "gate checkpoint does not match this task attempt");
    return {
      gateEvidenceDigest: digest(
        row["gateEvidenceDigest"],
        "checkpoint gateEvidenceDigest",
        "VES_GATE_CHECKPOINT_INVALID"
      ),
      gateEvidenceRefs: list(
        row["gateEvidenceRefs"],
        "checkpoint gateEvidenceRefs",
        SAFE,
        "VES_GATE_CHECKPOINT_INVALID"
      )
    };
  }

  #commitRequest(
    input: TaskGateCommitInput,
    gateEvidenceDigest: Digest,
    gateEvidenceRefs: readonly string[]
  ): AtomicCommitRequest {
    const idempotencyKey = this.#digest(
      canonicalJson({
        workspaceId: input.workspaceId,
        runId: input.runId,
        taskId: input.task.taskId,
        baseCommit: input.execution.baseCommit,
        changeDigest: input.execution.changeDigest,
        gateEvidenceDigest
      })
    );
    return freeze({
      workspaceId: input.workspaceId,
      runId: input.runId,
      taskId: input.task.taskId,
      requirementIds: input.task.requirementIds,
      worktreeRef: input.execution.worktreeRef,
      baseCommit: input.execution.baseCommit,
      subject: input.task.expectedCommitBoundary,
      expectedChangedPaths: input.execution.changedPaths,
      expectedChangeDigest: input.execution.changeDigest,
      gatePlanDigest: input.gatePlan.planDigest,
      gateEvidenceDigest,
      gateEvidenceRefs,
      idempotencyKey
    });
  }

  async #finalize(
    input: TaskGateCommitInput,
    request: AtomicCommitRequest,
    value: unknown,
    gateEvidenceRefs: readonly string[]
  ) {
    const receipt = exact(
      value,
      "atomic commit receipt",
      ["status", "commitId", "parentCommit", "changeDigest", "gateEvidenceDigest", "idempotencyKey"],
      "VES_GATE_COMMIT_RECEIPT_INVALID"
    );
    if (
      !(receipt["status"] === "committed" || receipt["status"] === "already-committed") ||
      typeof receipt["commitId"] !== "string" ||
      !OBJECT_ID.test(receipt["commitId"]) ||
      receipt["parentCommit"] !== input.execution.baseCommit ||
      receipt["changeDigest"] !== input.execution.changeDigest ||
      receipt["gateEvidenceDigest"] !== request.gateEvidenceDigest ||
      receipt["idempotencyKey"] !== request.idempotencyKey
    )
      fail("VES_GATE_COMMIT_RECEIPT_INVALID", "atomic commit receipt does not match the authorized task");
    await this.#save(input, "committed", { commitId: receipt["commitId"], idempotencyKey: request.idempotencyKey });
    const handle = { worktreeRef: input.execution.worktreeRef, baseCommit: input.execution.baseCommit };
    await this.#ports.worktrees.cleanup(handle);
    await this.#ports.coordination.release(input.execution.coordinationRef);
    return freeze({
      status: "COMMITTED" as const,
      taskId: input.task.taskId,
      requirementIds: input.task.requirementIds,
      commitId: receipt["commitId"],
      commitStatus: receipt["status"],
      gateEvidenceRefs,
      gateEvidenceDigest: request.gateEvidenceDigest,
      idempotencyKey: request.idempotencyKey
    });
  }

  async #save(input: TaskGateCommitInput, stage: string, data: Readonly<Record<string, unknown>>) {
    const saved = await this.#ports.checkpoints.save({
      workspaceId: input.workspaceId,
      runId: input.runId,
      taskId: input.task.taskId,
      gatePlanDigest: input.gatePlan.planDigest,
      changeDigest: input.execution.changeDigest,
      stage,
      ...data
    });
    token(saved.checkpointRef, "gate checkpointRef", "VES_GATE_CHECKPOINT_INVALID");
  }

  #digest(value: string): Digest {
    return digest(this.#ports.digest.sha256(value), "calculated digest", "VES_GATE_INPUT_INVALID");
  }
}
