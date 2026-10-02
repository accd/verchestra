import { randomUUID } from "node:crypto";
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";

import { InMemoryExecutionPayloadStore, type ContextManifest } from "@verchestra/agent-runtime";
import {
  TaskExecutionCoordinator,
  TaskGateCommitCoordinator,
  TaskRunCoordinator,
  createBudgetMeter,
  modelPriceTable,
  type BudgetLedger,
  type GateAttemptFeedback,
  type TaskExecutionInput,
  type TaskRunCommit,
  type TaskRunExecution,
  type TaskRunOutcome,
  type TaskRunPorts
} from "@verchestra/application";
import type { RunSnapshot } from "@verchestra/domain";
import {
  NodeAtomicGitCommitAdapter,
  NodeGateProcessRunner,
  NodeGitWorktreeAdapter,
  NodeWorktreeToolAdapter,
  RuntimeCheckpointStore,
  RuntimeLocalLease,
  parseTaskCommitTrailers,
  type GateCommandProfile,
  type RuntimeStore
} from "@verchestra/platform-node";

import { loadProviderAuth, type ProviderAuth, type ProviderAuthMode } from "../task-provider-auth.ts";
import { TaskAuthority } from "./task-authority.ts";
import { requireCodexSubscription } from "./task-codex-identity.ts";
import { loadContextManifest } from "./task-context.ts";
import { IMPLEMENTER_CREDENTIALS, VERIFIER_CREDENTIAL, readCredentials } from "./task-credentials.ts";
import { stateInvalid, taskError } from "./task-errors.ts";
import { TaskEvidenceStore, readPlainJson } from "./task-evidence.ts";
import { canonicalDigest, sha256, writeJsonAtomic, writeSealedRecord } from "./task-files.ts";
import { loadGateAllowlist } from "./task-gates.ts";
import { git } from "./task-git.ts";
import { findExecutable, implementerAdapter } from "./task-implementer.ts";
import type { TaskCommandIo } from "./task-io.ts";
import { HUMAN_ACTOR, IMPLEMENTER_ACTOR, loadPlanRecord, type TaskPlanRecord } from "./task-plan-record.ts";
import { loadTaskPolicy } from "./task-policy.ts";
import { workspaceTrustRoot } from "./task-signing.ts";
import { branchName, loadCommit, reviewSurface, saveCommit } from "./task-surface.ts";
import { verifyTask } from "./task-verifier.ts";
import { applyWorkflow, currentRun } from "./task-workflow.ts";
import { openRuntime, openTaskWorkspace, parseRunId, runDirectory, type TaskWorkspace } from "./task-workspace.ts";

const LEASE_MARGIN_MS = 60 * 60 * 1000;
const CANCEL_POLL_MS = 200;

// invariant: a verifier has exactly one credential source, an API key or the
// Codex identity directory of a subscription.
type VerifierAccess =
  | { readonly executable: string; readonly credential: string }
  | { readonly executable: string; readonly identityDirectory: string };

interface Prepared {
  readonly implementer: { readonly executable: string; readonly auth: ProviderAuthMode; readonly credential: string };
  readonly verifier: VerifierAccess;
  readonly unbilledModels: readonly string[];
  readonly gates: Readonly<Record<string, GateCommandProfile>>;
  readonly authority: TaskAuthority;
  readonly manifest: ContextManifest;
}

export function activePath(directory: string): string {
  return join(directory, "active.json");
}

// why: `cancel` of a run no process is driving removes its uncommitted
// worktree, and only this marker names it without recreating it.
export function worktreePath(directory: string): string {
  return join(directory, "worktree.json");
}

export function cancelPath(directory: string): string {
  return join(directory, "cancel.json");
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

export async function activeProcess(directory: string): Promise<number | undefined> {
  const active = await readPlainJson(activePath(directory), "active run marker").catch(() => undefined);
  const pid = active?.["pid"];
  return alive(pid) ? (pid as number) : undefined;
}

export interface CommittedTaskRecovery {
  readonly repositoryRoot: string;
  readonly directory: string;
  readonly worktrees: Pick<NodeGitWorktreeAdapter, "cleanupAtCommit">;
  readonly evidence: Pick<TaskEvidenceStore, "recover">;
  readonly gateIds: readonly string[];
  readonly inspectGate: () =>
    { readonly stage: string; readonly record: Readonly<Record<string, unknown>> } | undefined;
  readonly release: () => Promise<void>;
}

// why: a crash between the committed checkpoint and the commit record (or
// before the worktree was anchored) is finished here from durable facts:
// the committed checkpoint, the commit's own trailers, and the recorded
// gate evidence, never by re-running a gate.
export async function recoverCommittedTask(recovery: CommittedTaskRecovery): Promise<TaskRunCommit | undefined> {
  const recorded = await loadCommit(recovery.directory);
  if (recorded !== undefined) return recorded;
  const gate = recovery.inspectGate();
  if (gate?.stage !== "committed") return undefined;
  const commitId = String(gate.record["commitId"]);
  const baseCommit = (await git(recovery.repositoryRoot, ["rev-parse", `${commitId}^`])).trim();
  await recovery.worktrees.cleanupAtCommit({ commitId, baseCommit });
  await recovery.release();
  const { gateEvidenceDigest } = parseTaskCommitTrailers(
    await git(recovery.repositoryRoot, ["show", "-s", "--format=%B", commitId])
  );
  if (gateEvidenceDigest === undefined)
    throw stateInvalid("VES_TASK_EVIDENCE_MISSING", "The task commit carries no gate evidence digest");
  const gateEvidenceRefs = await recovery.evidence.recover(
    String(gate.record["changeDigest"]),
    recovery.gateIds,
    gateEvidenceDigest
  );
  const commit: TaskRunCommit = {
    commitId,
    baseCommit,
    gateEvidenceDigest: gateEvidenceDigest as `sha256:${string}`,
    gateEvidenceRefs
  };
  await saveCommit(recovery.directory, commit);
  return commit;
}

// why: a model reached through a subscription is not billed per token, so the
// run's meter counts its tokens and duration and never prices it.
function unbilledModels(auth: ProviderAuth, request: TaskPlanRecord["request"]): readonly string[] {
  return [
    ...(auth.implementer === "subscription" ? [request.driver.model] : []),
    ...(auth.verifier === "subscription" ? [request.verifier.model] : [])
  ];
}

async function verifierAccess(
  io: TaskCommandIo,
  workspace: TaskWorkspace,
  executable: string,
  credential: string | undefined
): Promise<VerifierAccess> {
  if (credential !== undefined) return { executable, credential };
  const identityDirectory = await requireCodexSubscription({
    workspaceRoot: workspace.layout.workspaceRoot,
    sessionsRoot: workspace.layout.sessionsRoot,
    command: [executable],
    env: io.env,
    stderr: io.stderr
  });
  return { executable, identityDirectory };
}

// why: every requirement a run needs is proven before its first transition,
// so a missing credential, executable, or allowlist entry is `not
// configured` with no workflow change, worktree, or provider call behind it.
async function prepare(io: TaskCommandIo, workspace: TaskWorkspace, plan: TaskPlanRecord, runtime: RuntimeStore) {
  const auth = await loadProviderAuth(workspace.layout.workspaceRoot);
  const implementerCredential = IMPLEMENTER_CREDENTIALS[auth.implementer];
  // invariant: a run reads exactly the credentials its modes name. A verifier
  // on a subscription reads none here; its login is proven below instead.
  const credentials = await readCredentials(
    {
      workspaceId: workspace.workspaceId,
      platform: io.platform,
      ...(io.keychainPath === undefined ? {} : { keychainPath: io.keychainPath })
    },
    auth.verifier === "api-key" ? [implementerCredential, VERIFIER_CREDENTIAL] : [implementerCredential]
  );
  const [claude, codex] = await Promise.all([findExecutable("claude", io.env), findExecutable("codex", io.env)]);
  const verifier = await verifierAccess(io, workspace, codex, credentials.get(VERIFIER_CREDENTIAL));
  const gates = await loadGateAllowlist(workspace, plan.request);
  const policy = await loadTaskPolicy(io.controlRoot);
  const authority = new TaskAuthority({ runtime, plan, policy, trust: await workspaceTrustRoot(workspace) });
  const manifest = await loadContextManifest(runDirectory(workspace, plan.runId), plan.contextManifestDigest);
  return {
    implementer: {
      executable: claude,
      auth: auth.implementer,
      credential: credentials.get(implementerCredential) as string
    },
    verifier,
    unbilledModels: unbilledModels(auth, plan.request),
    gates,
    authority,
    manifest
  } satisfies Prepared;
}

class TaskRunComposition {
  readonly #io: TaskCommandIo;
  readonly #workspace: TaskWorkspace;
  readonly #plan: TaskPlanRecord;
  readonly #runtime: RuntimeStore;
  readonly #prepared: Prepared;
  readonly #directory: string;
  readonly #checkpoints: RuntimeCheckpointStore;
  readonly #worktrees: NodeGitWorktreeAdapter;
  readonly #evidence: TaskEvidenceStore;
  readonly #lease: RuntimeLocalLease;
  readonly #payloads = new InMemoryExecutionPayloadStore();
  readonly #feedback = new Map<string, string>();
  #currentFeedback: string | undefined;
  #lastHandle: { readonly worktreeRef: string; readonly baseCommit: string } | undefined;

  constructor(
    io: TaskCommandIo,
    workspace: TaskWorkspace,
    plan: TaskPlanRecord,
    runtime: RuntimeStore,
    prepared: Prepared
  ) {
    this.#io = io;
    this.#workspace = workspace;
    this.#plan = plan;
    this.#runtime = runtime;
    this.#prepared = prepared;
    this.#directory = runDirectory(workspace, plan.runId);
    this.#checkpoints = new RuntimeCheckpointStore(runtime);
    this.#worktrees = new NodeGitWorktreeAdapter({
      repositoryRoot: workspace.repositoryRoot,
      worktreesRoot: workspace.layout.worktreesRoot,
      anchorTaskCommits: true
    });
    this.#evidence = new TaskEvidenceStore(this.#directory);
    this.#lease = new RuntimeLocalLease(runtime);
  }

  get #task() {
    return this.#plan.request.task;
  }

  #coordination() {
    const workspaceId = this.#workspace.workspaceId;
    const ownerId = this.#plan.runId;
    const expiresAt = () =>
      new Date(Date.now() + this.#plan.request.budgets.maximumDurationMs + LEASE_MARGIN_MS).toISOString();
    return {
      acquire: async () => {
        const at = expiresAt();
        const lease = this.#lease.acquire({
          leaseId: `lease_${randomUUID()}`,
          workspaceId,
          ownerId,
          now: new Date().toISOString(),
          expiresAt: at
        });
        return { coordinationRef: `lease:${lease.fencingToken}`, expiresAt: at };
      },
      release: async () => {
        try {
          this.#lease.release(workspaceId, ownerId);
        } catch {
          // why: a lease another owner holds is not ours to release.
        }
      },
      verify: async (coordinationRef: string) => {
        try {
          this.#lease.acquire({
            leaseId: `lease_${randomUUID()}`,
            workspaceId,
            ownerId,
            now: new Date().toISOString(),
            expiresAt: expiresAt(),
            expectedFencingToken: Number(coordinationRef.slice("lease:".length))
          });
          return { active: true };
        } catch {
          return { active: false };
        }
      }
    };
  }

  #executorInput(grantId: string): TaskExecutionInput {
    return {
      schemaVersion: 1,
      workspaceId: this.#workspace.workspaceId,
      runId: this.#plan.runId,
      executionPackageDigest: this.#plan.packageDigest,
      sourceStateDigest: this.#plan.sourceStateDigest,
      sourceRevision: this.#plan.request.sourceRevision,
      contextManifestDigest: this.#plan.contextManifestDigest,
      mode: "personal",
      task: this.#task,
      authority: {
        approvalRef: this.#plan.approvalRequest.approvalId,
        approvalBindingDigest: this.#plan.approvalRequest.bindingDigest as `sha256:${string}`,
        capabilityGrantRefs: [grantId]
      },
      budgets: this.#plan.request.budgets
    };
  }

  // invariant: one writer capability per run, created against the approval
  // in force and reused on resume; a revoked or expired grant fails the next
  // tool effect instead of being silently re-issued.
  async #grant(): Promise<string> {
    const path = join(this.#directory, "grant.json");
    const stored = await readPlainJson(path, "capability grant marker");
    if (typeof stored?.["grantId"] === "string") return stored["grantId"];
    const approvalExpiry = Date.parse(this.#plan.approvalRequest.expiresAt);
    const wanted = Date.now() + this.#plan.request.budgets.maximumDurationMs + LEASE_MARGIN_MS;
    const grant = await this.#prepared.authority.grant(new Date(Math.min(approvalExpiry, wanted)).toISOString());
    await writeJsonAtomic(path, { grantId: grant.grantId });
    return grant.grantId;
  }

  #executor(grantId: string): TaskExecutionCoordinator {
    const coordination = this.#coordination();
    const driver = implementerAdapter({
      workspaceId: this.#workspace.workspaceId,
      runId: this.#plan.runId,
      request: this.#plan.request,
      manifest: this.#prepared.manifest,
      executable: this.#prepared.implementer.executable,
      auth: this.#prepared.implementer.auth,
      credential: this.#prepared.implementer.credential,
      env: this.#io.env,
      isolationRoot: this.#workspace.layout.sessionsRoot,
      worktrees: this.#worktrees,
      payloads: this.#payloads,
      feedback: () => this.#currentFeedback,
      onWorktree: (worktreeRef) => writeJsonAtomic(worktreePath(this.#directory), { worktreeRef })
    });
    return new TaskExecutionCoordinator({
      authority: this.#prepared.authority.executor(grantId),
      coordination: { acquire: coordination.acquire, release: coordination.release },
      worktrees: this.#worktrees,
      checkpoints: this.#checkpoints.executorCheckpoints(),
      context: {
        compile: async () => ({
          contextRef: `context:${this.#plan.contextManifestDigest.slice(7, 39)}`,
          contextDigest: this.#prepared.manifest.manifestId
        })
      },
      tools: new NodeWorktreeToolAdapter({
        workspaceId: this.#workspace.workspaceId,
        worktrees: this.#worktrees,
        receipts: this.#runtime.createEffectRepository(),
        payloads: this.#payloads,
        protectedRoots: [".verchestra"]
      }),
      driver
    });
  }

  async #worktreeHandle() {
    return this.#worktrees.create({
      workspaceId: this.#workspace.workspaceId,
      runId: this.#plan.runId,
      taskId: this.#task.taskId,
      sourceStateDigest: this.#plan.sourceStateDigest,
      sourceRevision: this.#plan.request.sourceRevision,
      changeScope: this.#task.changeScope,
      protectedPaths: this.#task.protectedPaths
    });
  }

  // why: a run interrupted after its implementer finished resumes at the gate
  // with the same worktree, instead of starting the implementer again and
  // repeating its effects; any drift in the worktree voids the shortcut.
  async resumable(): Promise<TaskRunExecution | undefined> {
    const ids = [this.#workspace.workspaceId, this.#plan.runId, this.#task.taskId] as const;
    const latest = await this.#checkpoints.executorCheckpoints().load(...ids);
    if (latest?.stage !== "awaiting-gate") return undefined;
    const data = latest.data as { readonly changeDigest?: unknown; readonly changedPaths?: unknown };
    const gate = this.#checkpoints.inspectGate(...ids);
    if (gate?.stage === "gate-failed" && gate.record["changeDigest"] === data.changeDigest) return undefined;
    const handle = await this.#worktreeHandle();
    this.#lastHandle = handle;
    const inspection = await this.#worktrees.inspect(handle);
    if (inspection.changeDigest !== data.changeDigest || inspection.commitCountSinceBase !== 0) return undefined;
    const coordination = await this.#coordination().acquire();
    return {
      worktreeRef: handle.worktreeRef,
      baseCommit: handle.baseCommit,
      coordinationRef: coordination.coordinationRef,
      changeDigest: inspection.changeDigest as `sha256:${string}`,
      changedPaths: inspection.changedPaths,
      checkpointRef: latest.checkpointRef ?? `checkpoint:${latest.sequence}`
    };
  }

  async execute(options: {
    readonly signal: AbortSignal;
    readonly budgetMeter: ReturnType<typeof createBudgetMeter> | undefined;
    readonly feedback: GateAttemptFeedback | undefined;
  }): Promise<TaskRunExecution> {
    this.#currentFeedback =
      options.feedback === undefined ? undefined : this.#feedback.get(options.feedback.feedbackRef);
    const grantId = await this.#grant();
    const result = await this.#executor(grantId).execute(this.#executorInput(grantId), {
      signal: options.signal,
      ...(options.budgetMeter === undefined ? {} : { budgetMeter: options.budgetMeter })
    });
    this.#lastHandle = { worktreeRef: result.worktreeRef, baseCommit: result.baseCommit };
    return {
      worktreeRef: result.worktreeRef,
      baseCommit: result.baseCommit,
      coordinationRef: result.coordinationRef,
      changeDigest: result.changeDigest as `sha256:${string}`,
      changedPaths: result.changedPaths,
      checkpointRef: result.checkpointRef
    };
  }

  async commit(execution: TaskRunExecution) {
    this.#evidence.judging(execution.changeDigest);
    const coordination = this.#coordination();
    const result = await new TaskGateCommitCoordinator({
      digest: { sha256: (value) => sha256(value) },
      authority: this.#prepared.authority.gates(),
      worktrees: this.#worktrees,
      gates: new NodeGateProcessRunner({
        repositoryRoot: this.#workspace.repositoryRoot,
        worktreesRoot: this.#workspace.layout.worktreesRoot,
        commands: this.#prepared.gates
      }),
      evidence: { record: (entry) => this.#evidence.record(entry) },
      checkpoints: this.#checkpoints.gateCheckpoints(),
      git: new NodeAtomicGitCommitAdapter({
        repositoryRoot: this.#workspace.repositoryRoot,
        worktreesRoot: this.#workspace.layout.worktreesRoot
      }),
      coordination: { verify: coordination.verify, release: coordination.release }
    }).execute({
      schemaVersion: 1,
      workspaceId: this.#workspace.workspaceId,
      runId: this.#plan.runId,
      task: {
        taskId: this.#task.taskId,
        requirementIds: this.#task.requirementIds,
        verificationCommands: this.#task.verificationCommands,
        changeScope: this.#task.changeScope,
        protectedPaths: this.#task.protectedPaths,
        expectedCommitBoundary: this.#task.expectedCommitBoundary
      },
      execution,
      authority: { approvalBindingDigest: this.#plan.approvalRequest.bindingDigest },
      gatePlan: { schemaVersion: 1, commands: this.#plan.request.gates, planDigest: this.#plan.gatePlanDigest }
    });
    if (result.status !== "COMMITTED")
      return {
        passed: false as const,
        failure: { failedGateId: result.failedGateId, evidenceRef: result.evidenceRef }
      };
    const commit: TaskRunCommit = {
      commitId: result.commitId as string,
      baseCommit: execution.baseCommit,
      gateEvidenceDigest: result.gateEvidenceDigest,
      gateEvidenceRefs: result.gateEvidenceRefs
    };
    await saveCommit(this.#directory, commit);
    return { passed: true as const, commit };
  }

  committed(): Promise<TaskRunCommit | undefined> {
    return recoverCommittedTask({
      repositoryRoot: this.#workspace.repositoryRoot,
      directory: this.#directory,
      worktrees: this.#worktrees,
      evidence: this.#evidence,
      gateIds: this.#plan.request.gates.map((entry) => entry.gateId),
      inspectGate: () =>
        this.#checkpoints.inspectGate(this.#workspace.workspaceId, this.#plan.runId, this.#task.taskId),
      release: () => this.#coordination().release()
    });
  }

  async release(): Promise<void> {
    if (this.#lastHandle !== undefined && (await loadCommit(this.#directory)) === undefined)
      await this.#worktrees.cleanup(this.#lastHandle).catch(() => undefined);
    await this.#coordination().release();
  }

  async attempt(input: { readonly attempt: number; readonly passed: boolean; readonly failure: unknown }) {
    const record = JSON.parse(
      JSON.stringify({ runId: this.#plan.runId, taskId: this.#task.taskId, ...input })
    ) as object;
    await writeSealedRecord(join(this.#directory, "attempts", `${input.attempt}.json`), record);
    return { capsuleDigest: canonicalDigest(record) };
  }

  repair(): TaskRunPorts["repair"] {
    const state = this.#checkpoints.repairState(this.#workspace.workspaceId, this.#plan.runId, this.#task.taskId);
    return {
      budget: { create: (resume) => this.#meter(resume) },
      buildFeedback: async (failure) => {
        const built = await this.#evidence.feedback(failure);
        this.#feedback.set(built.feedback.feedbackRef, built.text);
        return built.feedback;
      },
      sealAttempt: (input) => this.attempt(input),
      loadState: state.loadState,
      saveState: state.saveState
    };
  }

  #meter(resume: BudgetLedger | undefined) {
    return createBudgetMeter({
      budgets: this.#plan.request.budgets,
      priceTable: modelPriceTable,
      unbilledModels: this.#prepared.unbilledModels,
      ...(resume === undefined ? {} : { resume })
    });
  }

  async verify(commit: TaskRunCommit, run: RunSnapshot, signal: AbortSignal) {
    const state = await this.#checkpoints
      .repairState(this.#workspace.workspaceId, this.#plan.runId, this.#task.taskId)
      .loadState();
    const ledger = (state as { readonly budgetLedger?: BudgetLedger | null } | undefined)?.budgetLedger ?? undefined;
    return verifyTask(
      {
        workspace: this.#workspace,
        plan: this.#plan,
        runtime: this.#runtime,
        runDirectory: this.#directory,
        gates: this.#prepared.gates,
        verifier: this.#prepared.verifier,
        env: this.#io.env,
        meter: this.#meter(ledger)
      },
      commit,
      run,
      signal
    );
  }

  // why: a second run in the same Workspace is refused before its first
  // transition, instead of failing inside the executor and spending its
  // approval; the lease taken here is the one the executor then renews.
  async claimWriterLease(): Promise<void> {
    try {
      await this.#coordination().acquire();
    } catch (error) {
      throw taskError("VES_TASK_RUN_ACTIVE", {}, "Another task run holds the Workspace writer lease", {
        cause: error
      });
    }
  }

  ports(): TaskRunPorts {
    return {
      workflow: {
        current: async () => currentRun(this.#runtime, this.#plan.runId),
        apply: async (command) => applyWorkflow(this.#runtime, this.#plan.runId, command)
      },
      execution: { resumable: () => this.resumable(), execute: (options) => this.execute(options) },
      gates: { committed: () => this.committed(), commit: (execution) => this.commit(execution) },
      repair: this.repair(),
      verification: { verify: (commit, run, signal) => this.verify(commit, run, signal) },
      release: () => this.release()
    };
  }
}

function watchCancellation(directory: string, controller: AbortController): () => void {
  const interrupt = () => controller.abort("interrupted");
  const timer = setInterval(() => {
    void lstat(cancelPath(directory)).then(
      () => controller.abort("cancel requested"),
      () => undefined
    );
  }, CANCEL_POLL_MS);
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  return () => {
    clearInterval(timer);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  };
}

async function present(workspace: TaskWorkspace, plan: TaskPlanRecord, outcome: TaskRunOutcome, state: string) {
  const base = { runId: plan.runId, status: outcome.status, state };
  if (outcome.status === "HUMAN_REVIEW") {
    const review = await reviewSurface(workspace.repositoryRoot, plan, runDirectory(workspace, plan.runId));
    return {
      ...base,
      commitId: outcome.commit.commitId,
      branch: branchName(plan),
      verificationReport: outcome.reportRef,
      surfaceDigest: review.digest,
      next: `vestra task review --run-id ${plan.runId} --outcome accepted|rejected --surface-digest ${review.digest}`
    };
  }
  if (outcome.status === "FAILED" || outcome.status === "ABORTED") return { ...base, reason: outcome.reason };
  if (outcome.status === "VERIFICATION_FAILED")
    return { ...base, verificationReport: outcome.reportRef, next: `vestra task cancel --run-id ${plan.runId}` };
  if (outcome.status === "ESCALATED")
    return { ...base, failedGate: outcome.failure.failedGateId, next: `vestra task cancel --run-id ${plan.runId}` };
  return { ...base, next: "The approval no longer matches the Workspace policy; plan the task again." };
}

function assertStartable(state: string, resume: boolean): void {
  const allowed = resume ? ["IMPLEMENTING", "VERIFYING"] : ["EXECUTION_AUTHORIZED"];
  if (!allowed.includes(state))
    throw taskError(
      "VES_TASK_TRANSITION_REFUSED",
      { state, command: resume ? "resume" : "start" },
      `A run in ${state} cannot be ${resume ? "resumed" : "started"}`
    );
}

async function claimActive(directory: string, pid: number): Promise<void> {
  if ((await activeProcess(directory)) !== undefined)
    throw taskError("VES_TASK_RUN_ACTIVE", {}, "Another process is already driving this run");
  await rm(cancelPath(directory), { force: true });
  await writeJsonAtomic(activePath(directory), { pid, startedAt: new Date().toISOString() });
}

export async function runTask(io: TaskCommandIo, options: { readonly runId: unknown; readonly resume: boolean }) {
  const runId = parseRunId(options.runId);
  const workspace = await openTaskWorkspace(io);
  const plan = await loadPlanRecord(workspace, runId);
  const directory = runDirectory(workspace, runId);
  const runtime = openRuntime(workspace);
  try {
    assertStartable(currentRun(runtime, runId).state, options.resume);
    const prepared = await prepare(io, workspace, plan, runtime);
    await claimActive(directory, io.pid);
    const composition = new TaskRunComposition(io, workspace, plan, runtime, prepared);
    const controller = new AbortController();
    const stop = watchCancellation(directory, controller);
    try {
      await composition.claimWriterLease();
      const outcome = await new TaskRunCoordinator(composition.ports()).run({
        bindingDigest: prepared.authority.currentBindingDigest(),
        implementerActorId: IMPLEMENTER_ACTOR,
        cancelActorId: HUMAN_ACTOR,
        ...(plan.request.onGateFailure === undefined ? {} : { onGateFailure: plan.request.onGateFailure }),
        signal: controller.signal
      });
      await writeJsonAtomic(join(directory, "outcome.json"), { ...outcome, at: new Date().toISOString() });
      const data = await present(workspace, plan, outcome, currentRun(runtime, runId).state);
      return { data, exitCode: outcome.status === "HUMAN_REVIEW" ? 0 : 1 };
    } finally {
      stop();
      await rm(activePath(directory), { force: true });
    }
  } finally {
    runtime.close();
  }
}
