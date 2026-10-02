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

import { continuesLedger, storedBudgetLedger } from "./task-budget.ts";
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
import { MARKER_SEAL, type TaskPlanRecord } from "./task-plan-record.ts";
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
  // invariant: the five markers. A run whose plan record names the marker
  // seal writes and reads them sealed; a run planned before that keeps them as
  // plain canonical JSON. A reader returns the record in both forms, never the
  // seal envelope, so the Run Capsule binds the same grant digest for both.
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

function processId(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : undefined;
}

function alive(pid: number | undefined): pid is number {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { readonly code?: unknown }).code === "EPERM";
  }
}

// invariant: what `activeProcess` answers for an active marker of a sealed Run
// that is there and does not verify. It is not `undefined`: whoever asks must
// treat the run as one a process may be driving.
export const UNVERIFIED_DRIVER = "unverified";
export type RunDriver = number | typeof UNVERIFIED_DRIVER | undefined;

// invariant: the marker seal a plan record names, or none for a run planned
// before the markers were sealed. A seal this build does not know is refused,
// never read as either form.
function sealsMarkers(row: Row): boolean {
  const seal = row["markerSeal"];
  if (seal !== undefined && seal !== MARKER_SEAL)
    throw stateInvalid("VES_TASK_STATE_MALFORMED", "plan.markerSeal is not a marker seal this build knows");
  return seal === MARKER_SEAL;
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
  sealsMarkers(row);
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

  // why: a run whose repair loop has saved no state yet still has usage to
  // record. The stage it is filed under is what the gate checkpoint proves:
  // `converged` once the task is committed (the loop was interrupted before it
  // saved that), `repair` while an attempt is still in flight. No attempt is
  // recorded in either case: none has ended that the loop knows of.
  #unrecordedLoop(): Row {
    return {
      stage: this.gate()?.stage === "committed" ? "converged" : "repair",
      attempts: 0,
      attemptCapsuleDigests: [],
      budgetLedger: null
    };
  }

  // invariant: a Run has one account of usage, the ledger its latest repair
  // state carries. Usage is recorded on that state as it is metered, during an
  // attempt and during verification: its stage, attempt count and attempt
  // chain stay as the loop left them and only the ledger moves. `status`, the
  // Run Capsule and the next meter therefore read one ledger, and it only
  // grows: a ledger that does not continue the recorded one is refused, not
  // stored.
  // hazard: synchronous on purpose. A usage event is metered inside a driver's
  // stream handling, where nothing can be awaited, and what it spent must be
  // stored before the next event is read.
  recordBudgetLedger(ledger: BudgetLedger): void {
    const state = this.#store.inspectRepair(...this.#identity) ?? this.#unrecordedLoop();
    const recorded = storedBudgetLedger(state["budgetLedger"]);
    const next = storedBudgetLedger(ledger);
    if (next === undefined || (recorded !== undefined && !continuesLedger(recorded, next)))
      throw stateInvalid("VES_TASK_STATE_MISMATCH", "The ledger does not continue the usage recorded for the run");
    this.#store.recordRepair(...this.#identity, {
      stage: state["stage"],
      attempts: state["attempts"],
      attemptCapsuleDigests: state["attemptCapsuleDigests"],
      budgetLedger: next
    });
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
  #sealedMarkers: boolean | undefined;

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

  async #storedPlan(): Promise<TaskPlanRecord | undefined> {
    const stored = await readSealedRecord(await this.#file(LAYOUT.plan), "plan record");
    if (stored === undefined) return undefined;
    const plan = validatedPlan({ workspaceId: this.#workspaceId, runId: this.runId }, stored);
    this.#sealedMarkers = plan.markerSeal === MARKER_SEAL;
    return plan;
  }

  async loadPlan(): Promise<TaskPlanRecord> {
    const plan = await this.#storedPlan();
    if (plan === undefined)
      throw taskError("VES_TASK_RUN_NOT_FOUND", {}, "No planned run with this ID exists in the Workspace");
    return plan;
  }

  // invariant: the form of a Run's markers is the one its sealed plan record
  // names, read from that record and from nowhere else. A marker cannot say
  // which form it is in, so replacing a sealed marker with a plain one does
  // not turn a sealed Run into a legacy one. A run with no plan record yet has
  // no markers a command would read; it writes the plain form.
  async #sealsMarkers(): Promise<boolean> {
    if (this.#sealedMarkers === undefined) await this.#storedPlan();
    return this.#sealedMarkers ?? false;
  }

  async #writeMarker(segments: readonly string[], record: object): Promise<void> {
    const path = await this.#file(segments);
    if (await this.#sealsMarkers()) await writeSealedRecord(path, record);
    else await writeJsonAtomic(path, record);
  }

  // invariant: a sealed Run's marker is read through its seal: a plain marker
  // in its place is outside the envelope and refused, an edited one does not
  // match its digest and is refused, and the member a reader needs must be
  // text. A legacy Run's marker is the plain object the file holds, as it was
  // before the markers were sealed.
  async #marker(segments: readonly string[], label: string, key: string): Promise<Row | undefined> {
    const path = await this.#file(segments);
    if (!(await this.#sealsMarkers())) return markerRow(path, label);
    const record = await sealedRow(path, label);
    if (record !== undefined) textField(record, key, label);
    return record;
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
    await this.#writeMarker(LAYOUT.grant, { grantId });
  }

  loadGrant(): Promise<Row | undefined> {
    return this.#marker(LAYOUT.grant, "capability grant marker", "grantId");
  }

  // invariant: who drives the run: a live process, nobody, or, for a sealed
  // Run, a marker that is there and does not verify. That last answer fails
  // closed. An edited or replaced marker must not read as "nobody", or a
  // second driver could start and a cancel would abort under a live one. It
  // must not be an error either, or the run could never be cancelled.
  // why: a legacy Run's marker that cannot be read names no live process, as
  // it always did, so a legacy Run in flight still resumes and cancels.
  async activeProcess(): Promise<RunDriver> {
    const path = await this.#file(LAYOUT.active);
    if (!(await this.#sealsMarkers())) {
      const plain = await markerRow(path, "active run marker").catch(() => undefined);
      const pid = processId(plain?.["pid"]);
      return alive(pid) ? pid : undefined;
    }
    let active: Row | undefined;
    try {
      active = await sealedRow(path, "active run marker");
    } catch {
      return UNVERIFIED_DRIVER;
    }
    if (active === undefined) return undefined;
    const pid = processId(active["pid"]);
    if (pid === undefined) return UNVERIFIED_DRIVER;
    return alive(pid) ? pid : undefined;
  }

  // invariant: one process drives a run. Claiming it clears a cancel request
  // left for a previous driver, so the new one is not stopped by stale intent.
  async claimActive(pid: number): Promise<void> {
    if ((await this.activeProcess()) !== undefined)
      throw taskError("VES_TASK_RUN_ACTIVE", {}, "Another process is already driving this run");
    await rm(await this.#file(LAYOUT.cancel), { force: true });
    await this.#writeMarker(LAYOUT.active, { pid, startedAt: new Date().toISOString() });
  }

  async releaseActive(): Promise<void> {
    await rm(await this.#file(LAYOUT.active), { force: true });
  }

  // why: a marker that is already there, in any form, is the request. Writing
  // over it would add nothing, and a write refuses what is not a regular file,
  // which must never be what stops a user from stopping a run.
  async requestCancel(actorId: string): Promise<void> {
    if (await this.cancelRequested()) return;
    await this.#writeMarker(LAYOUT.cancel, { requestedAt: new Date().toISOString(), actorId });
  }

  // invariant: a cancel marker is a request by being there, whatever it holds
  // and in either form. The only thing it can say is "stop", so a marker that
  // would not verify still stops the run: reading it as no request would let an
  // edit keep a run going that its user asked to end.
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
    await this.#writeMarker(LAYOUT.worktree, { worktreeRef });
  }

  async loadWorktreeRef(): Promise<string | undefined> {
    const marker = await this.#marker(LAYOUT.worktree, "worktree marker", "worktreeRef");
    const worktreeRef = marker?.["worktreeRef"];
    return typeof worktreeRef === "string" ? worktreeRef : undefined;
  }

  async saveOutcome(outcome: TaskRunOutcome): Promise<void> {
    await this.#writeMarker(LAYOUT.outcome, { ...outcome, at: new Date().toISOString() });
  }

  loadOutcome(): Promise<Row | undefined> {
    return this.#marker(LAYOUT.outcome, "run outcome", "status");
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
