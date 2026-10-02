import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";

import type { ContextManifest } from "@verchestra/agent-runtime";
import {
  normalizeTaskRequest,
  type BudgetLedger,
  type ExecutionCheckpointPort,
  type GateRepairStatePort,
  type TaskGateCheckpointPort,
  type TaskRunCommit,
  type TaskRunOutcome
} from "@verchestra/application";
import { canonicalizeJsonV2 } from "@verchestra/domain";
import {
  FileExecutionPackageStore,
  FileRunCapsuleStore,
  type SignedExecutionPackage,
  type SignedRunCapsule
} from "@verchestra/evidence";
import { NodeContentDigest, RuntimeCheckpointStore, isGitObjectId, type RuntimeStore } from "@verchestra/platform-node";

import { storedBudgetLedger } from "./task-budget.ts";
import { stateInvalid, taskError } from "./task-errors.ts";
import { TaskEvidenceStore } from "./task-evidence.ts";
import {
  canonicalDigest,
  objectRow,
  readJsonFile,
  readSealedRecord,
  textField,
  writeJsonAtomic,
  writeSealedRecord
} from "./task-files.ts";
import type { TaskPlanRecord } from "./task-plan-record.ts";
import { parseRunId, requireRealDirectories, type TaskWorkspace } from "./task-workspace.ts";

type Digest = `sha256:${string}`;
type Row = Readonly<Record<string, unknown>>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PLAN_DIGESTS = [
  "requestDigest",
  "sourceStateDigest",
  "contextManifestDigest",
  "policyViewDigest",
  "gatePlanDigest",
  "packageDigest"
] as const;

// invariant: the layout of `<workspace>/tasks/<runId>/`, spelled here and
// nowhere else. Runs in flight and sealed Run Capsules depend on these names,
// on the canonical JSON each file holds, and on its seal, so none of them
// changes without a migration.
const LAYOUT = Object.freeze({
  plan: ["plan.json"],
  contextManifest: ["context-manifest.json"],
  packages: ["packages"],
  gateEvidence: ["gate-evidence"],
  commit: ["commit.json"],
  attempts: ["attempts"],
  report: ["verification", "report.json"],
  lessons: ["verification", "lessons"],
  review: ["review.json"],
  capsules: ["capsules"],
  // hazard: these five markers are plain canonical JSON, not sealed. A reader
  // gets what the file holds; the grant marker is digested into the Run
  // Capsule exactly as it is read.
  grant: ["grant.json"],
  active: ["active.json"],
  worktree: ["worktree.json"],
  cancel: ["cancel.json"],
  outcome: ["outcome.json"]
});

async function sealedRow(path: string, label: string): Promise<Row | undefined> {
  const stored = await readSealedRecord(path, label);
  return stored === undefined ? undefined : objectRow(stored, label);
}

async function markerRow(path: string, label: string): Promise<Row | undefined> {
  const stored = await readJsonFile(path, label);
  return stored === undefined ? undefined : objectRow(stored, label);
}

function alive(pid: unknown): boolean {
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) return false;
  try {
    process.kill(pid as number, 0);
    return true;
  } catch (error) {
    return (error as { readonly code?: unknown }).code === "EPERM";
  }
}

function digestField(row: Row, key: string): void {
  const value = row[key];
  if (typeof value !== "string" || !DIGEST.test(value))
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `plan.${key} is not a digest`);
}

// invariant: the request is re-normalized on every load, so a plan record can
// never carry a request the intake contract would refuse.
function validatedPlan(identity: { readonly workspaceId: string; readonly runId: string }, stored: unknown) {
  const row = objectRow(stored, "plan");
  if (row["schemaVersion"] !== 1 || row["runId"] !== identity.runId || row["workspaceId"] !== identity.workspaceId)
    throw stateInvalid("VES_TASK_STATE_MISMATCH", "The plan record belongs to another run or Workspace");
  let request: TaskPlanRecord["request"];
  try {
    request = normalizeTaskRequest(row["request"]);
  } catch (error) {
    throw stateInvalid("VES_TASK_STATE_MALFORMED", "The stored task request no longer validates", { cause: error });
  }
  for (const key of PLAN_DIGESTS) digestField(row, key);
  if (canonicalDigest(request) !== row["requestDigest"])
    throw stateInvalid("VES_TASK_STATE_TAMPERED", "The stored task request does not match its digest");
  textField(row, "packageId", "plan");
  textField(row, "createdAt", "plan");
  const approval = objectRow(row["approvalRequest"], "plan.approvalRequest");
  digestField(approval, "bindingDigest");
  textField(approval, "approvalId", "plan.approvalRequest");
  objectRow(row["approvalIntent"], "plan.approvalIntent");
  return { ...(row as unknown as TaskPlanRecord), request };
}

function validatedCommit(row: Row): TaskRunCommit {
  if (
    typeof row["commitId"] !== "string" ||
    !isGitObjectId(row["commitId"]) ||
    typeof row["baseCommit"] !== "string" ||
    !isGitObjectId(row["baseCommit"]) ||
    typeof row["gateEvidenceDigest"] !== "string" ||
    !DIGEST.test(row["gateEvidenceDigest"]) ||
    !Array.isArray(row["gateEvidenceRefs"])
  )
    throw stateInvalid("VES_TASK_STATE_MALFORMED", "The task commit record is malformed");
  return row as unknown as TaskRunCommit;
}

export interface ExecutorCheckpoint {
  readonly stage: string;
  readonly checkpointRef: string;
  readonly changeDigest: string | undefined;
  readonly toolReceiptRefs: readonly string[];
}

export interface GateCheckpoint {
  readonly stage: string;
  readonly changeDigest: string | undefined;
  readonly commitId: string | undefined;
}

export interface RepairCheckpoint {
  readonly stage: string;
  readonly budgetLedger: BudgetLedger | undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// why: an executor checkpoint carries whatever the executor saved at that
// stage, so its data is read member by member and never assumed to be a row.
function looseRow(value: unknown): Row {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Row) : {};
}

// invariant: the one reader of a Run's checkpoint rows. The runtime store
// keeps them as records of unknown shape; every command gets these typed
// projections instead of reading a row itself. The three ports are the
// store's own, bound to this Run and task, for the coordinators that write.
export class RunCheckpoints {
  readonly #store: RuntimeCheckpointStore;
  readonly #identity: readonly [workspaceId: string, runId: string, taskId: string];

  constructor(
    runtime: RuntimeStore,
    identity: { readonly workspaceId: string; readonly runId: string; readonly taskId: string }
  ) {
    this.#store = new RuntimeCheckpointStore(runtime);
    this.#identity = [identity.workspaceId, identity.runId, identity.taskId];
  }

  executorPort(): ExecutionCheckpointPort {
    return this.#store.executorCheckpoints();
  }

  gatePort(): TaskGateCheckpointPort {
    return this.#store.gateCheckpoints();
  }

  repairPort(): GateRepairStatePort {
    return this.#store.repairState(...this.#identity);
  }

  async executor(): Promise<ExecutorCheckpoint | undefined> {
    const latest = await this.executorPort().load(...this.#identity);
    if (latest === undefined) return undefined;
    const data = looseRow(latest.data);
    const receipts = data["toolReceiptRefs"];
    return {
      stage: latest.stage,
      checkpointRef: latest.checkpointRef ?? `checkpoint:${latest.sequence}`,
      changeDigest: text(data["changeDigest"]),
      toolReceiptRefs: Array.isArray(receipts)
        ? receipts.filter((entry): entry is string => typeof entry === "string")
        : []
    };
  }

  // why: unlike the gate port's load, this also reports a failed or committed
  // gate, which a resume and a crash recovery must see.
  gate(): GateCheckpoint | undefined {
    const inspected = this.#store.inspectGate(...this.#identity);
    if (inspected === undefined) return undefined;
    return {
      stage: inspected.stage,
      changeDigest: text(inspected.record["changeDigest"]),
      commitId: text(inspected.record["commitId"])
    };
  }

  async repair(): Promise<RepairCheckpoint | undefined> {
    const stored = await this.repairPort().loadState();
    if (stored === undefined) return undefined;
    const row = objectRow(stored, "repair state");
    return { stage: textField(row, "stage", "repair state"), budgetLedger: storedBudgetLedger(row["budgetLedger"]) };
  }
}

// invariant: the one owner of a Run's durable record on disk: where each
// artifact lives, whether it is sealed, and what a reader may trust about it.
// Nothing is created until the first write, so a command that only reads (and
// a dry run, which never writes) leaves no `tasks/` directory behind.
export class RunRecord {
  readonly runId: string;
  readonly gateEvidence: TaskEvidenceStore;
  readonly #workspaceId: string;
  readonly #tasksRoot: string;

  constructor(options: { readonly workspaceId: string; readonly runId: string; readonly tasksRoot: string }) {
    this.runId = options.runId;
    this.#workspaceId = options.workspaceId;
    this.#tasksRoot = options.tasksRoot;
    this.gateEvidence = new TaskEvidenceStore(() => this.#directory(LAYOUT.gateEvidence));
  }

  // invariant: every read and write of the Run reaches its path through one of
  // these two, immediately before it acts. The Run directory and each directory
  // between it and the artifact is checked to be a real one, so nothing is
  // read, written, created, or removed through a link planted below `tasks/`.
  async #file(segments: readonly string[], ...rest: readonly string[]): Promise<string> {
    const path = [this.runId, ...segments, ...rest];
    await requireRealDirectories(this.#tasksRoot, path.slice(0, -1));
    return join(this.#tasksRoot, ...path);
  }

  async #directory(segments: readonly string[]): Promise<string> {
    const path = [this.runId, ...segments];
    await requireRealDirectories(this.#tasksRoot, path);
    return join(this.#tasksRoot, ...path);
  }

  // invariant: a plan is filed under its own run and Workspace, so the path
  // it is written to and the identity it carries can never disagree.
  async savePlan(plan: TaskPlanRecord): Promise<void> {
    if (plan.runId !== this.runId || plan.workspaceId !== this.#workspaceId)
      throw stateInvalid("VES_TASK_STATE_MISMATCH", "The plan record belongs to another run or Workspace");
    await writeSealedRecord(await this.#file(LAYOUT.plan), plan);
  }

  async loadPlan(): Promise<TaskPlanRecord> {
    const stored = await readSealedRecord(await this.#file(LAYOUT.plan), "plan record");
    if (stored === undefined)
      throw taskError("VES_TASK_RUN_NOT_FOUND", {}, "No planned run with this ID exists in the Workspace");
    return validatedPlan({ workspaceId: this.#workspaceId, runId: this.runId }, stored);
  }

  async saveContextManifest(manifest: ContextManifest): Promise<void> {
    await writeJsonAtomic(await this.#file(LAYOUT.contextManifest), manifest);
  }

  // invariant: the executor only accepts the manifest the approval bound; the
  // identity is recomputed from the stored content, so an edited file fails.
  async loadContextManifest(expected: string): Promise<ContextManifest> {
    const stored = (await readJsonFile(await this.#file(LAYOUT.contextManifest), "context manifest")) as
      ContextManifest | undefined;
    if (stored === undefined || typeof stored !== "object" || stored === null)
      throw stateInvalid("VES_TASK_CONTEXT_MISSING", "The approved context manifest is missing");
    const { manifestId, keyId, signature, ...unsigned } = stored;
    void keyId;
    void signature;
    if (manifestId !== expected || new NodeContentDigest().sha256(canonicalizeJsonV2(unsigned)) !== expected)
      throw stateInvalid("VES_TASK_CONTEXT_TAMPERED", "The context manifest does not match the approved digest");
    return stored;
  }

  async #packages(): Promise<FileExecutionPackageStore> {
    return new FileExecutionPackageStore({ root: await this.#directory(LAYOUT.packages) });
  }

  async savePackage(pkg: SignedExecutionPackage): Promise<void> {
    await (await this.#packages()).put(pkg);
  }

  // hazard: the package store creates its root when it reads, so this is the
  // one reader that is not free of effects. Every caller has read the plan
  // record first, so the Run directory already exists by then.
  // hazard: this reader does not compare the package with the plan. A command
  // reads the package through `approvedPackage`, never through this.
  async loadPackage(packageId: string): Promise<SignedExecutionPackage> {
    return (await this.#packages()).get(packageId);
  }

  // invariant: the package a human approves, and the one a review seals into
  // the Run Capsule, is the one on disk, byte for byte the payload the plan
  // bound; a swapped package fails before any approval or review is recorded.
  async approvedPackage(plan: Pick<TaskPlanRecord, "packageId" | "packageDigest">): Promise<SignedExecutionPackage> {
    // why: a linked directory is refused with its own code, not reported as a
    // damaged package.
    const packages = await this.#packages();
    let pkg: SignedExecutionPackage;
    try {
      pkg = await packages.get(plan.packageId);
    } catch (error) {
      throw stateInvalid("VES_TASK_PACKAGE_INVALID", "The sealed Execution Package is missing or damaged", {
        cause: error
      });
    }
    if (`sha256:${pkg.payloadDigest}` !== plan.packageDigest)
      throw stateInvalid("VES_TASK_PACKAGE_INVALID", "The Execution Package does not match the plan");
    return pkg;
  }

  async saveGrant(grantId: string): Promise<void> {
    await writeJsonAtomic(await this.#file(LAYOUT.grant), { grantId });
  }

  async loadGrant(): Promise<Row | undefined> {
    return markerRow(await this.#file(LAYOUT.grant), "capability grant marker");
  }

  // why: a marker that cannot be read names no live process, so a run whose
  // driver died while writing it can still be resumed or cancelled.
  async activeProcess(): Promise<number | undefined> {
    const path = await this.#file(LAYOUT.active);
    const active = await markerRow(path, "active run marker").catch(() => undefined);
    const pid = active?.["pid"];
    return alive(pid) ? (pid as number) : undefined;
  }

  // invariant: one process drives a run. Claiming it clears a cancel request
  // left for a previous driver, so the new one is not stopped by stale intent.
  async claimActive(pid: number): Promise<void> {
    if ((await this.activeProcess()) !== undefined)
      throw taskError("VES_TASK_RUN_ACTIVE", {}, "Another process is already driving this run");
    await rm(await this.#file(LAYOUT.cancel), { force: true });
    await writeJsonAtomic(await this.#file(LAYOUT.active), { pid, startedAt: new Date().toISOString() });
  }

  async releaseActive(): Promise<void> {
    await rm(await this.#file(LAYOUT.active), { force: true });
  }

  // why: a marker that is already there, in any form, is the request. Writing
  // over it would add nothing, and a write refuses what is not a regular file,
  // which must never be what stops a user from stopping a run.
  async requestCancel(actorId: string): Promise<void> {
    if (await this.cancelRequested()) return;
    await writeJsonAtomic(await this.#file(LAYOUT.cancel), { requestedAt: new Date().toISOString(), actorId });
  }

  // invariant: a cancel marker is a request by being there, whatever it holds.
  // hazard: this rejects when it cannot tell whether one is there (the Run
  // directory is a link, or cannot be read). The process driving the run
  // treats that as a request to stop.
  async cancelRequested(): Promise<boolean> {
    const path = await this.#file(LAYOUT.cancel);
    try {
      await lstat(path);
      return true;
    } catch (error) {
      const code = (error as { readonly code?: unknown }).code;
      if (code === "ENOENT" || code === "ENOTDIR") return false;
      throw error;
    }
  }

  // why: `cancel` of a run no process is driving removes its uncommitted
  // worktree, and only this marker names it without recreating it.
  async saveWorktreeRef(worktreeRef: string): Promise<void> {
    await writeJsonAtomic(await this.#file(LAYOUT.worktree), { worktreeRef });
  }

  async loadWorktreeRef(): Promise<string | undefined> {
    const marker = await markerRow(await this.#file(LAYOUT.worktree), "worktree marker");
    const worktreeRef = marker?.["worktreeRef"];
    return typeof worktreeRef === "string" ? worktreeRef : undefined;
  }

  async saveOutcome(outcome: TaskRunOutcome): Promise<void> {
    await writeJsonAtomic(await this.#file(LAYOUT.outcome), { ...outcome, at: new Date().toISOString() });
  }

  async loadOutcome(): Promise<Row | undefined> {
    return markerRow(await this.#file(LAYOUT.outcome), "run outcome");
  }

  async saveCommit(commit: TaskRunCommit): Promise<void> {
    await writeSealedRecord(await this.#file(LAYOUT.commit), commit);
  }

  async loadCommit(): Promise<TaskRunCommit | undefined> {
    const row = await sealedRow(await this.#file(LAYOUT.commit), "task commit record");
    return row === undefined ? undefined : validatedCommit(row);
  }

  // invariant: an attempt is sealed as JSON carries it, so a member that is
  // undefined is absent from the record and from the digest that chains it.
  async sealAttempt(
    taskId: string,
    attempt: { readonly attempt: number; readonly passed: boolean; readonly failure: unknown }
  ): Promise<{ readonly capsuleDigest: Digest }> {
    const record = JSON.parse(JSON.stringify({ runId: this.runId, taskId, ...attempt })) as object;
    return {
      capsuleDigest: await writeSealedRecord(await this.#file(LAYOUT.attempts, `${attempt.attempt}.json`), record)
    };
  }

  async saveReport(report: unknown): Promise<Digest> {
    return writeSealedRecord(await this.#file(LAYOUT.report), report);
  }

  async loadReport(): Promise<Row | undefined> {
    return sealedRow(await this.#file(LAYOUT.report), "verification report");
  }

  async saveLesson(lesson: unknown): Promise<Digest> {
    const digest = canonicalDigest(lesson);
    return writeSealedRecord(await this.#file(LAYOUT.lessons, `${digest.slice(7, 39)}.json`), lesson);
  }

  // invariant: a run is reviewable only with both its task commit record and
  // the verification report that judged that commit.
  async verifiedCommit(): Promise<{ readonly commit: TaskRunCommit; readonly report: Row }> {
    const commit = await this.loadCommit();
    const report = await this.loadReport();
    if (commit === undefined || report === undefined)
      throw stateInvalid("VES_TASK_REVIEW_UNAVAILABLE", "The run has no verified task commit to review");
    return { commit, report };
  }

  async saveReview(review: unknown): Promise<Digest> {
    return writeSealedRecord(await this.#file(LAYOUT.review), review);
  }

  async loadReview(): Promise<Row | undefined> {
    return sealedRow(await this.#file(LAYOUT.review), "review record");
  }

  async saveCapsule(capsule: SignedRunCapsule): Promise<void> {
    await new FileRunCapsuleStore({ root: await this.#directory(LAYOUT.capsules) }).put(capsule);
  }

  // why: the checkpoints of a Run live in the runtime store, not in the Run
  // directory, so they are reached only with an open store and the task ID.
  checkpoints(runtime: RuntimeStore, taskId: string): RunCheckpoints {
    return new RunCheckpoints(runtime, { workspaceId: this.#workspaceId, runId: this.runId, taskId });
  }
}

// invariant: the run ID is parsed before it names a directory, so nothing a
// caller passes can leave the Workspace's `tasks/` root.
export function openRunRecord(workspace: Pick<TaskWorkspace, "workspaceId" | "tasksRoot">, runId: string): RunRecord {
  const id = parseRunId(runId);
  return new RunRecord({ workspaceId: workspace.workspaceId, runId: id, tasksRoot: workspace.tasksRoot });
}
