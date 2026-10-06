import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { InMemoryExecutionPayloadStore, type ContextManifest } from "@verchestra/agent-runtime";
import {
  TaskExecutionCoordinator,
  TaskGateCommitCoordinator,
  TaskRunCoordinator,
  createBudgetMeter,
  isPricedModel,
  modelPriceTable,
  type BudgetLedger,
  type BudgetMeter,
  type ExecutionDriverPort,
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
  parseTaskCommitTrailers,
  refTarget,
  taskBranchRef,
  type GateCommandProfile,
  type RuntimeStore
} from "@verchestra/platform-node";

import { loadProviderAuth, type ProviderAuth, type ProviderAuthMode } from "../task-provider-auth.ts";
import { TaskAuthority } from "./task-authority.ts";
import {
  requireStatedPlanType,
  requireSubscriptionPreflight,
  statedCodexPlanType,
  type ExtraUsageConfirmation
} from "./task-billing.ts";
import { meterOnRunLedger, recordingMeter } from "./task-budget.ts";
import { codexAccountFacts, codexUnavailableModels } from "./task-codex.ts";
import { requireCodexSubscription } from "./task-codex-identity.ts";
import { continuation, coordinationStatus, type CoordinationStatus } from "./task-coordination-surface.ts";
import { CODEX_CREDITS_PRESENT, coordinatedDriver } from "./task-coordination.ts";
import { IMPLEMENTER_CREDENTIALS, VERIFIER_CREDENTIAL, readCredentials } from "./task-credentials.ts";
import { notConfigured, stateInvalid, taskError } from "./task-errors.ts";
import { sha256 } from "./task-files.ts";
import { loadGateAllowlist } from "./task-gates.ts";
import { git } from "./task-git.ts";
import { findExecutable, implementerAdapter } from "./task-implementer.ts";
import type { TaskCommandIo } from "./task-io.ts";
import {
  HUMAN_ACTOR,
  IMPLEMENTER_ACTOR,
  isCoordinatedPlan,
  type PlannedTaskRequest,
  type TaskPlanRecord
} from "./task-plan-record.ts";
import { loadTaskPolicy } from "./task-policy.ts";
import { ProviderProcesses } from "./task-process-tree.ts";
import { inspectMarkedWorktree, parseReconcile, revalidateResume } from "./task-resumption.ts";
import { openRunRecord, type GateCheckpoint, type RunCheckpoints, type RunRecord } from "./task-run-record.ts";
import { workspaceTrustRoot } from "./task-signing.ts";
import { branchName, reviewSurface } from "./task-surface.ts";
import { verifyTask } from "./task-verifier.ts";
import { requireWindowsPrerequisites, type WindowsTaskHost } from "./task-windows.ts";
import { applyWorkflow, currentRun } from "./task-workflow.ts";
import {
  openRuntime,
  openTaskWorkspace,
  parseRunId,
  requireWorktreePathBudget,
  type TaskWorkspace
} from "./task-workspace.ts";

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

export interface CommittedTaskRecovery {
  readonly repositoryRoot: string;
  readonly runRecord: Pick<RunRecord, "loadCommit" | "saveCommit" | "gateEvidence">;
  readonly worktrees: Pick<NodeGitWorktreeAdapter, "cleanupAtCommit">;
  readonly gateIds: readonly string[];
  readonly gate: () => GateCheckpoint | undefined;
  readonly release: () => Promise<void>;
}

// why: a crash between the committed checkpoint and the commit record (or
// before the worktree was anchored) is finished here from durable facts:
// the committed checkpoint, the commit's own trailers, and the recorded
// gate evidence, never by re-running a gate.
export async function recoverCommittedTask(recovery: CommittedTaskRecovery): Promise<TaskRunCommit | undefined> {
  const recorded = await recovery.runRecord.loadCommit();
  if (recorded !== undefined) return recorded;
  const gate = recovery.gate();
  if (gate?.stage !== "committed") return undefined;
  const { commitId, changeDigest } = gate;
  if (commitId === undefined || changeDigest === undefined)
    throw stateInvalid("VES_TASK_STATE_MALFORMED", "The committed gate checkpoint names no commit or no change");
  const baseCommit = (await git(recovery.repositoryRoot, ["rev-parse", `${commitId}^`])).trim();
  await recovery.worktrees.cleanupAtCommit({ commitId, baseCommit });
  await recovery.release();
  const { gateEvidenceDigest } = parseTaskCommitTrailers(
    await git(recovery.repositoryRoot, ["show", "-s", "--format=%B", commitId])
  );
  if (gateEvidenceDigest === undefined)
    throw stateInvalid("VES_TASK_EVIDENCE_MISSING", "The task commit carries no gate evidence digest");
  const gateEvidenceRefs = await recovery.runRecord.gateEvidence.recover(
    changeDigest,
    recovery.gateIds,
    gateEvidenceDigest
  );
  const commit: TaskRunCommit = {
    commitId,
    baseCommit,
    gateEvidenceDigest: gateEvidenceDigest as `sha256:${string}`,
    gateEvidenceRefs
  };
  await recovery.runRecord.saveCommit(commit);
  return commit;
}

// invariant: the models each provider runs: Claude Code the implementer, or
// every Claude Code node; Codex the verifier and every Codex node.
function providerModels(request: PlannedTaskRequest) {
  if (request.schemaVersion === 1) return { claude: [request.driver.model], codex: [request.verifier.model] };
  const models = (driverId: string) =>
    request.execution.nodes.filter((node) => node.driver.driverId === driverId).map((node) => node.driver.model);
  return { claude: models("claude-code"), codex: [...models("codex"), request.verifier.model] };
}

// invariant: AD-084. A model with no price is reachable only on a subscription,
// where nothing is billed per token. On an API key it would stop the run at its
// first usage event with `VES_BUDGET_MODEL_UNKNOWN`, after the implementer's
// allowance was spent, so it is refused before any effect.
function requireModelsPricedForApiKey(auth: ProviderAuth, request: PlannedTaskRequest): void {
  const { claude, codex } = providerModels(request);
  const unpriced = [
    ...(auth.implementer === "api-key" ? claude : []),
    ...(auth.verifier === "api-key" ? codex : [])
  ].filter((model) => !isPricedModel(model));
  if (unpriced.length > 0)
    throw notConfigured(
      "model-unpriced-for-api-key",
      `${[...new Set(unpriced)].join(", ")} has no price, so it runs on a subscription only`
    );
}

// why: a model reached through a subscription is not billed per token, so the
// run's meter counts its tokens and duration and never prices it.
function unbilledModels(auth: ProviderAuth, request: PlannedTaskRequest): readonly string[] {
  const { claude, codex } = providerModels(request);
  return [
    ...new Set([
      ...(auth.implementer === "subscription" ? claude : []),
      ...(auth.verifier === "subscription" ? codex : [])
    ])
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

// why: a model the account lacks must be found before the implementer spends its
// allowance, so the check runs here, beside the plan type a coordinated run
// already reads; a v1 run keeps the T04 floor and only lists models (SSI-83).
async function requireCodexAccount(
  io: TaskCommandIo,
  workspace: TaskWorkspace,
  plan: TaskPlanRecord,
  verifier: VerifierAccess,
  confirmations: readonly ExtraUsageConfirmation[]
): Promise<void> {
  if (!("identityDirectory" in verifier)) return;
  const stated = statedCodexPlanType(confirmations);
  const models = [...new Set(providerModels(plan.request).codex)];
  const options = {
    workspaceId: workspace.workspaceId,
    runId: plan.runId,
    manifestId: plan.contextManifestDigest,
    model: plan.request.verifier.model,
    executable: verifier.executable,
    identityDirectory: verifier.identityDirectory,
    env: io.env,
    sessionRoot: join(workspace.layout.sessionsRoot, `codex-account-${plan.runId}`),
    stderr: io.stderr
  };
  if (plan.request.schemaVersion === 1) {
    requireModelsOffered(await codexUnavailableModels(options, models), io.stderr);
    return;
  }
  const facts = await codexAccountFacts(options, models);
  if (stated !== undefined && facts.planType !== undefined) requireStatedPlanType(stated, facts.planType, io.stderr);
  requireModelsOffered(facts.unavailableModels, io.stderr);
}

// invariant: the owner is told which models the account does not offer, by name,
// on the terminal, and the public error carries the requirement alone, as it
// does for the plan type: a name is a bounded request value, never account text.
function requireModelsOffered(unavailable: readonly string[], stderr: (value: string) => void): void {
  if (unavailable.length === 0) return;
  stderr(
    `This Workspace's Codex login does not offer: ${unavailable.join(", ")}.\n` +
      "Name a model your account offers in the task request (the list is in docs/quick-start.md), then plan again.\n"
  );
  throw notConfigured("codex-model-unavailable", "The Codex account does not offer a model the run asks for");
}

// why: the machine the Windows prerequisites are proven on. A command proves
// its own platform on the node host; a test hands another platform and a fake
// host, so the place of the proof in a run is observed on every platform.
export interface WindowsMachine {
  readonly platform: string;
  readonly host?: WindowsTaskHost;
}

// why: every requirement a run needs is proven before its first transition,
// so a missing credential, executable, or allowlist entry is `not
// configured` with no workflow change, worktree, or provider call behind it.
// invariant: SSI-73. The machine's prerequisites come after the run's own
// settings and before any credential is read, so a machine that cannot run
// the task is told so without a secret being touched.
async function prepare(
  io: TaskCommandIo,
  workspace: TaskWorkspace,
  plan: TaskPlanRecord,
  runtime: RuntimeStore,
  runRecord: RunRecord,
  machine: WindowsMachine
) {
  const auth = await loadProviderAuth(workspace.layout.workspaceRoot);
  requireModelsPricedForApiKey(auth, plan.request);
  const confirmations = isCoordinatedPlan(plan)
    ? await requireSubscriptionPreflight({
        workspaceRoot: workspace.layout.workspaceRoot,
        auth,
        request: plan.request,
        stderr: io.stderr
      })
    : [];
  await requireWindowsPrerequisites({
    ...machine,
    sessionsRoot: workspace.layout.sessionsRoot,
    claude: providerModels(plan.request).claude.length === 0 ? "none" : auth.implementer
  });
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
  const [claude, codex] = await Promise.all([
    findExecutable("claude", io.env, io.platform),
    findExecutable("codex", io.env, io.platform)
  ]);
  const verifier = await verifierAccess(io, workspace, codex, credentials.get(VERIFIER_CREDENTIAL));
  await requireCodexAccount(io, workspace, plan, verifier, confirmations);
  const gates = await loadGateAllowlist(workspace, plan.request);
  const policy = await loadTaskPolicy(io.controlRoot);
  const authority = new TaskAuthority({ runtime, plan, policy, trust: await workspaceTrustRoot(workspace) });
  const manifest = await runRecord.loadContextManifest(plan.contextManifestDigest);
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

// invariant: AD-079. A writer grant ends at the earlier of the approval's
// expiry and the run's longest duration plus the lease margin, whether it is
// the run's first grant or a renewal.
export function grantExpiry(lifetime: {
  readonly now: number;
  readonly approvalExpiresAt: string;
  readonly maximumDurationMs: number;
}): number {
  return Math.min(Date.parse(lifetime.approvalExpiresAt), lifetime.now + lifetime.maximumDurationMs + LEASE_MARGIN_MS);
}

export interface GrantRenewalFacts {
  // invariant: armed only by a resume of a suspended run that passed its
  // revalidation, never by a start or by another resume.
  readonly armed: boolean;
  readonly grant: { readonly expiresAt: string; readonly revokedAt?: string } | undefined;
  readonly now: number;
  readonly remainingDurationMs: number;
  readonly approvalExpiresAt: string;
  readonly maximumDurationMs: number;
}

// invariant: AD-079. A grant is renewed only when renewal is armed, only if it
// exists and was never revoked, only when its remaining life is shorter than
// the run's remaining duration, and only when the new grant would outlive it.
export function renewsGrant(facts: GrantRenewalFacts): boolean {
  const { grant } = facts;
  if (!facts.armed || grant === undefined || grant.revokedAt !== undefined) return false;
  const expiresAt = Date.parse(grant.expiresAt);
  return expiresAt - facts.now < facts.remainingDurationMs && grantExpiry(facts) > expiresAt;
}

// invariant: SSI-29. A run executes only the request its human approved: the
// plan record names the package the approval binds, and that package's
// execution contract is the plan's request digest. A plan record rewritten
// consistently after approval, request, digest, and seal alike, runs nothing.
async function requireApprovedRequest(plan: TaskPlanRecord, runRecord: RunRecord): Promise<void> {
  const pkg = await runRecord.approvedPackage(plan);
  // why: the intent is checked as an object only when the record loads, and a
  // record without its review surface binds no package at all.
  const review = (plan.approvalIntent as { readonly review?: { readonly packageDigest?: unknown } }).review;
  if (review?.packageDigest !== plan.packageDigest || pkg.payload.executionContractDigest !== plan.requestDigest)
    throw stateInvalid("VES_TASK_PACKAGE_INVALID", "The sealed request is not the one the approved package binds");
}

class TaskRunComposition {
  readonly #io: TaskCommandIo;
  readonly #workspace: TaskWorkspace;
  readonly #plan: TaskPlanRecord;
  readonly #runtime: RuntimeStore;
  readonly #prepared: Prepared;
  readonly #runRecord: RunRecord;
  readonly #checkpoints: RunCheckpoints;
  readonly #worktrees: NodeGitWorktreeAdapter;
  readonly #payloads = new InMemoryExecutionPayloadStore();
  readonly providers: ProviderProcesses;
  readonly #feedback = new Map<string, string>();
  readonly #reconcile: `sha256:${string}` | undefined;
  #currentFeedback: string | undefined;
  #lastHandle: { readonly worktreeRef: string; readonly baseCommit: string } | undefined;
  #renewalArmed = false;

  constructor(
    io: TaskCommandIo,
    workspace: TaskWorkspace,
    plan: TaskPlanRecord,
    runtime: RuntimeStore,
    prepared: Prepared,
    runRecord: RunRecord,
    reconcile: `sha256:${string}` | undefined
  ) {
    this.#io = io;
    this.#reconcile = reconcile;
    this.#workspace = workspace;
    this.#plan = plan;
    this.#runtime = runtime;
    this.#prepared = prepared;
    this.#runRecord = runRecord;
    this.#checkpoints = runRecord.checkpoints(runtime, plan.request.task.taskId);
    this.#worktrees = new NodeGitWorktreeAdapter({
      repositoryRoot: workspace.repositoryRoot,
      worktreesRoot: workspace.layout.worktreesRoot,
      anchorTaskCommits: true
    });
    this.providers = new ProviderProcesses({ stderr: io.stderr });
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
        const lease = this.#runtime.acquireLease({
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
          this.#runtime.releaseLease(workspaceId, ownerId);
        } catch {
          // why: a lease another owner holds is not ours to release.
        }
      },
      verify: async (coordinationRef: string) => {
        try {
          this.#runtime.acquireLease({
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
  // tool effect instead of being silently re-issued. The one exception is a
  // suspension, which can outlast the grant: a resume of a suspended run that
  // passed its revalidation renews a grant that would lapse before the run's
  // remaining duration is spent, against the approval it just proved valid,
  // and the grant marker records the grant it replaced (AD-079).
  async #grant(remainingDurationMs: number): Promise<string> {
    const stored = await this.#runRecord.loadGrant();
    const lifetime = {
      now: Date.now(),
      approvalExpiresAt: this.#plan.approvalRequest.expiresAt,
      maximumDurationMs: this.#plan.request.budgets.maximumDurationMs
    };
    if (stored !== undefined) {
      const grant = this.#renewalArmed ? await this.#prepared.authority.loadGrant(stored.grantId) : undefined;
      if (!renewsGrant({ ...lifetime, armed: this.#renewalArmed, grant, remainingDurationMs })) return stored.grantId;
    }
    const grant = await this.#prepared.authority.grant(new Date(grantExpiry(lifetime)).toISOString());
    const replaced = stored === undefined ? [] : [...(stored.replaced ?? []), stored.grantId];
    await this.#runRecord.saveGrant(grant.grantId, replaced);
    return grant.grantId;
  }

  // invariant: the task commit a run suspended at its verifier left: the one
  // recorded, whose only parent is the plan's source revision, and the one its
  // task branch anchors. A commit or branch that cannot be read does not hold.
  async #taskCommitHolds(): Promise<boolean> {
    const commit = await this.#runRecord.loadCommit();
    if (commit === undefined || commit.baseCommit !== this.#plan.request.sourceRevision) return false;
    const root = this.#workspace.repositoryRoot;
    const ref = taskBranchRef(this.#plan.runId, this.#task.taskId);
    if ((await refTarget(root, ref).catch(() => undefined)) !== commit.commitId) return false;
    const lineage = await git(root, ["rev-list", "--parents", "-n", "1", commit.commitId]).catch(() => "");
    return lineage.trim() === `${commit.commitId} ${commit.baseCommit}`;
  }

  // why: a run that its verifier's provider suspended waits in VERIFYING with
  // its suspension as its last outcome; any other VERIFYING run was
  // interrupted, not suspended.
  async #suspendedAtVerification(): Promise<boolean> {
    if (currentRun(this.#runtime, this.#plan.runId).state !== "VERIFYING") return false;
    return (await this.#runRecord.loadOutcome())?.status === "SUSPENDED";
  }

  // invariant: SSI-33. What a resume proves before any node or verifier
  // starts; a refusal leaves the run exactly as it was.
  async revalidate(): Promise<void> {
    const executor = await this.#checkpoints.executor();
    const coordinated = isCoordinatedPlan(this.#plan);
    const atVerifier = await this.#suspendedAtVerification();
    const { fromSuspension } = await revalidateResume({
      runId: this.#plan.runId,
      coordinated,
      suspended: executor?.stage === "suspended" ? { changeDigest: executor.changeDigest } : undefined,
      ledger: coordinated ? await this.#runRecord.loadCoordinationLedger() : undefined,
      approval: () => this.#prepared.authority.approval(),
      worktree: () => inspectMarkedWorktree(this.#runRecord, this.#worktrees, this.#plan.request.sourceRevision),
      reconcile: this.#reconcile,
      stderr: this.#io.stderr,
      ...(atVerifier ? { suspendedAtVerification: { taskCommitHolds: () => this.#taskCommitHolds() } } : {})
    });
    this.#renewalArmed = fromSuspension;
  }

  // invariant: SSI-32. The result of a coordinated run shows its nodes as
  // `status` does, from the same records, once the run has stopped.
  async coordinationStatus(): Promise<CoordinationStatus | undefined> {
    if (!isCoordinatedPlan(this.#plan)) return undefined;
    return coordinationStatus(this.#plan, this.#runRecord, await this.#checkpoints.executor(), this.#worktrees);
  }

  // invariant: a single-session run drives its implementer; a coordinated run
  // drives its plan's nodes through the coordinated driver. Either is the one
  // driver port of the run's one executor.
  #driver(budgetMeter: BudgetMeter | undefined): ExecutionDriverPort {
    const plan = this.#plan;
    const onWorktree = (worktreeRef: string) => this.#runRecord.saveWorktreeRef(worktreeRef);
    const shared = {
      workspaceId: this.#workspace.workspaceId,
      runId: plan.runId,
      manifest: this.#prepared.manifest,
      env: this.#io.env,
      providers: this.providers,
      worktrees: this.#worktrees,
      payloads: this.#payloads,
      onWorktree
    };
    const implementer = this.#prepared.implementer;
    const request = plan.request;
    if (request.schemaVersion === 1)
      return implementerAdapter({
        ...shared,
        request,
        executable: implementer.executable,
        auth: implementer.auth,
        credential: implementer.credential,
        isolationRoot: this.#workspace.layout.sessionsRoot,
        feedback: () => this.#currentFeedback
      });
    return coordinatedDriver({
      ...shared,
      request,
      claude: implementer,
      codex: this.#prepared.verifier,
      sessionsRoot: this.#workspace.layout.sessionsRoot,
      records: this.#runRecord.coordination(),
      feedback: this.#currentFeedback,
      remainingDurationMs: () => budgetMeter?.remainingDurationMs() ?? request.budgets.maximumDurationMs,
      reconcile: this.#reconcile
    });
  }

  #executor(grantId: string, budgetMeter: BudgetMeter | undefined): TaskExecutionCoordinator {
    const coordination = this.#coordination();
    const driver = this.#driver(budgetMeter);
    return new TaskExecutionCoordinator({
      authority: this.#prepared.authority.executor(grantId),
      coordination: { acquire: coordination.acquire, release: coordination.release },
      worktrees: this.#worktrees,
      checkpoints: this.#checkpoints.executorPort(),
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
    const latest = await this.#checkpoints.executor();
    if (latest?.stage !== "awaiting-gate") return undefined;
    const gate = this.#checkpoints.gate();
    if (gate?.stage === "gate-failed" && gate.changeDigest === latest.changeDigest) return undefined;
    const handle = await this.#worktreeHandle();
    this.#lastHandle = handle;
    const inspection = await this.#worktrees.inspect(handle);
    if (inspection.changeDigest !== latest.changeDigest || inspection.commitCountSinceBase !== 0) return undefined;
    const coordination = await this.#coordination().acquire();
    return {
      worktreeRef: handle.worktreeRef,
      baseCommit: handle.baseCommit,
      coordinationRef: coordination.coordinationRef,
      changeDigest: inspection.changeDigest as `sha256:${string}`,
      changedPaths: inspection.changedPaths,
      checkpointRef: latest.checkpointRef
    };
  }

  async execute(options: {
    readonly signal: AbortSignal;
    readonly budgetMeter: ReturnType<typeof createBudgetMeter> | undefined;
    readonly feedback: GateAttemptFeedback | undefined;
  }): Promise<TaskRunExecution> {
    this.#currentFeedback =
      options.feedback === undefined ? undefined : this.#feedback.get(options.feedback.feedbackRef);
    const grantId = await this.#grant(
      options.budgetMeter?.remainingDurationMs() ?? this.#plan.request.budgets.maximumDurationMs
    );
    const result = await this.#executor(grantId, options.budgetMeter).execute(this.#executorInput(grantId), {
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
    this.#runRecord.gateEvidence.judging(execution.changeDigest);
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
      evidence: { record: (entry) => this.#runRecord.gateEvidence.record(entry) },
      checkpoints: this.#checkpoints.gatePort(),
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
    await this.#runRecord.saveCommit(commit);
    return { passed: true as const, commit };
  }

  committed(): Promise<TaskRunCommit | undefined> {
    return recoverCommittedTask({
      repositoryRoot: this.#workspace.repositoryRoot,
      runRecord: this.#runRecord,
      worktrees: this.#worktrees,
      gateIds: this.#plan.request.gates.map((entry) => entry.gateId),
      gate: () => this.#checkpoints.gate(),
      release: () => this.#coordination().release()
    });
  }

  async release(): Promise<void> {
    if (this.#lastHandle !== undefined && (await this.#runRecord.loadCommit()) === undefined)
      await this.#worktrees.cleanup(this.#lastHandle).catch(() => undefined);
    await this.#coordination().release();
  }

  repair(): TaskRunPorts["repair"] {
    const state = this.#checkpoints.repairPort();
    return {
      budget: { create: (resume) => recordingMeter(this.#checkpoints, this.#meter(resume)) },
      buildFeedback: async (failure) => {
        const built = await this.#runRecord.gateEvidence.feedback(failure);
        this.#feedback.set(built.feedback.feedbackRef, built.text);
        return built.feedback;
      },
      sealAttempt: (input) => this.#runRecord.sealAttempt(this.#task.taskId, input),
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

  // invariant: the implementer and the verifier spend from the run's one
  // ledger, and what either spends is recorded there as it is metered, so
  // `status`, the Run Capsule and a resumed run all count it, once.
  verify(commit: TaskRunCommit, run: RunSnapshot, signal: AbortSignal) {
    return meterOnRunLedger(
      this.#checkpoints,
      (resume) => this.#meter(resume),
      (meter) =>
        verifyTask(
          {
            workspace: this.#workspace,
            plan: this.#plan,
            runtime: this.#runtime,
            runRecord: this.#runRecord,
            gates: this.#prepared.gates,
            verifier: this.#prepared.verifier,
            env: this.#io.env,
            meter,
            providers: this.providers
          },
          commit,
          run,
          signal
        )
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

export function watchCancellation(
  runRecord: Pick<RunRecord, "cancelRequested">,
  controller: AbortController,
  providers: Pick<ProviderProcesses, "running">
): () => void {
  const interrupt = () => controller.abort("interrupted");
  // invariant: while a provider is running, a termination request belongs to
  // the provider processes: they are stopped and the command ends with the run
  // left resumable. At any other moment it cancels the run, as SIGINT always does.
  const terminate = () => {
    if (!providers.running()) interrupt();
  };
  // invariant: a run whose driver cannot tell whether a cancel was requested
  // is stopped as if one was. Running on would make it a run nobody can stop.
  const timer = setInterval(() => {
    void runRecord.cancelRequested().then(
      (requested) => {
        if (requested) controller.abort("cancel requested");
      },
      () => controller.abort("cancel request unreadable")
    );
  }, CANCEL_POLL_MS);
  process.once("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  return () => {
    clearInterval(timer);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  };
}

// why: SSI-63 and D4. A suspended run continues only when its owner resumes
// it, by the same next action `status` offers: the reconcile command when a
// node may have landed effects, and `vestra task cancel` when no resume can.
function resumeAction(runId: string, coordination: CoordinationStatus | undefined): string {
  return continuation(runId, coordination?.uncertain ?? [])[0] ?? `vestra task cancel --run-id ${runId}`;
}

async function present(
  repositoryRoot: string,
  plan: TaskPlanRecord,
  runRecord: RunRecord,
  outcome: TaskRunOutcome,
  state: string,
  coordination: CoordinationStatus | undefined
) {
  const base = {
    runId: plan.runId,
    status: outcome.status,
    state,
    ...(coordination === undefined ? {} : { coordination })
  };
  if (outcome.status === "HUMAN_REVIEW") {
    const review = await reviewSurface(repositoryRoot, plan, runRecord);
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
  if (outcome.status === "SUSPENDED")
    return { ...base, suspension: outcome.suspension, next: resumeAction(plan.runId, coordination) };
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

export async function runTask(
  io: TaskCommandIo,
  options: { readonly runId: unknown; readonly resume: boolean; readonly reconcile?: unknown },
  machine: WindowsMachine = { platform: io.platform }
) {
  const runId = parseRunId(options.runId);
  const reconcile = parseReconcile(options.reconcile);
  const workspace = await openTaskWorkspace(io);
  // why: the state root's location is the first thing an owner fixes, since
  // every Workspace file (provider settings, the billing statement, the gate
  // allowlist, the Codex login, the runs) lives below it and moves with it;
  // the check reads only the real path, so it comes before the run is read.
  await requireWorktreePathBudget(workspace, runId, io.platform);
  const runRecord = openRunRecord(workspace, runId);
  const plan = await runRecord.loadPlan();
  const runtime = openRuntime(workspace);
  try {
    assertStartable(currentRun(runtime, runId).state, options.resume);
    await requireApprovedRequest(plan, runRecord);
    const prepared = await prepare(io, workspace, plan, runtime, runRecord, machine);
    await runRecord.claimActive(io.pid);
    const composition = new TaskRunComposition(io, workspace, plan, runtime, prepared, runRecord, reconcile);
    const controller = new AbortController();
    const stop = watchCancellation(runRecord, controller, composition.providers);
    try {
      if (options.resume) await composition.revalidate();
      await composition.claimWriterLease();
      const outcome = await new TaskRunCoordinator(composition.ports()).run({
        bindingDigest: prepared.authority.currentBindingDigest(),
        implementerActorId: IMPLEMENTER_ACTOR,
        cancelActorId: HUMAN_ACTOR,
        ...(plan.request.onGateFailure === undefined ? {} : { onGateFailure: plan.request.onGateFailure }),
        signal: controller.signal
      });
      await runRecord.saveOutcome(outcome);
      // why: D3b. Credits on the Codex account are a configuration the owner
      // must change before the run may continue, so the stop is reported as
      // `not configured`; the run itself is suspended and nothing is lost.
      if (outcome.status === "SUSPENDED" && outcome.suspension.reason === CODEX_CREDITS_PRESENT)
        throw notConfigured("codex-credits", "Codex reports credits on its account; the run is suspended");
      const data = await present(
        workspace.repositoryRoot,
        plan,
        runRecord,
        outcome,
        currentRun(runtime, runId).state,
        await composition.coordinationStatus()
      );
      return { data, exitCode: outcome.status === "HUMAN_REVIEW" ? 0 : 1 };
    } finally {
      stop();
      await runRecord.releaseActive();
    }
  } finally {
    runtime.close();
  }
}
