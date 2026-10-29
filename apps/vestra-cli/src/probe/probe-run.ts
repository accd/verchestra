// invariant: AD-086 and door 3 of .specs/features/probe-run/plan.md. This is
// the one CLI module that starts a probe worker: it composes the probe host's
// admission, supervisor, framed protocol and spawned transport, and no other
// CLI module imports them (tests/architecture/extension-host-composition.test.mjs).
import { randomUUID } from "node:crypto";

import type { SkillLock } from "@verchestra/agent-runtime";
import type { ApprovalRequest, CapabilityGrant } from "@verchestra/application";
import { DatabaseRegistry, ProbePlanner, type ProbePlan } from "@verchestra/data-probe";
import { canonicalizeJsonV2 } from "@verchestra/domain";
import type { EvidenceSigner, TrustRoot } from "@verchestra/evidence";
import {
  FramedProbeWorker,
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "@verchestra/extension-host";
import {
  WorkspaceProbeAdmission,
  type WorkspaceProbeWorkerExtension,
  type WorkspaceProbeWorkerGrant,
  type WorkspaceProbeWorkerRequest
} from "@verchestra/extension-host/admission";
import { SpawnedProbeWorker, type RuntimeStore } from "@verchestra/platform-node";

import { registrationOptions } from "../database/database-command.ts";
import { databaseError } from "../database/database-errors.ts";
import {
  DatabaseRegistrationFiles,
  WorkspaceDatabaseRegistrationStore
} from "../database/database-registration-file.ts";
import type { ExtensionApproval } from "../extension/extension-approval-store.ts";
import { inspectExtension } from "../extension/extension-check.ts";
import { approvalStore, refuseUnsupportedPlatform, resolveEntry } from "../extension/extension-workspace.ts";
import { extensionRegistry, workspaceLockVerifier } from "../extension/skill-lock-file.ts";
import { confirmDigest } from "../task/task-confirm.ts";
import type { TaskCommandIo } from "../task/task-io.ts";
import { HUMAN_ACTOR } from "../task/task-plan-record.ts";
import { unlockedSigner, workspaceTrustRoot } from "../task/task-signing.ts";
import { applyWorkflow } from "../task/task-workflow.ts";
import {
  openRuntime,
  openTaskWorkspace,
  requireWorkspaceStateContained,
  type TaskWorkspace
} from "../task/task-workspace.ts";
import {
  PROBE_GRANT_LIFETIME_MS,
  ProbeAuthority,
  loadProbePolicy,
  type ProbeApprovalSubject
} from "./probe-authority.ts";
import { ProbeRefusal, probeError } from "./probe-errors.ts";
import { readProbeRequest, type ProbeRequestFile } from "./probe-request.ts";
import { renderProbeReview } from "./probe-review.ts";
import { sqliteStatement, type SqliteStatement } from "./probe-statement.ts";

const CONTROLLER = "controller:vestra-probe-run";
const MAXIMUM_MESSAGE_BYTES = 65_536;
// why: the first plan validates the request before any run or grant exists, so
// its grant reference is a placeholder; the plan the worker runs is made again
// under the grant's own id (its digest covers the grant reference).
const PENDING_GRANT_REF = "pending-grant";
// invariant: AC 7. A run whose digest is not typed back is aborted by its
// owner; once it was, a refusal fails it (AC 6).
const ABORT = Object.freeze({ type: "ABORT", actorRole: "human", actorId: HUMAN_ACTOR, evidence: [] } as const);
const FAIL = Object.freeze({
  type: "FAIL",
  actorRole: "controller",
  actorId: CONTROLLER,
  evidence: ["terminal-error-evidence"]
} as const);

export interface ProbeRunOptions {
  readonly databaseId: string;
  readonly approvalRef: string;
  readonly requestPath: string;
  readonly confirmStdin: boolean;
}

type ProbeResult = Awaited<ReturnType<ProbeWorkerSupervisor["execute"]>>;

export interface ProbeRunOutput {
  readonly runId: string;
  readonly approvalId: string;
  readonly grantId: string;
  readonly result: ProbeResult;
}

interface ProbeTarget {
  readonly statement: SqliteStatement;
  readonly draft: ProbePlan;
  plan(grantRef: string): Promise<ProbePlan>;
}

export interface AdmissibleWorker {
  readonly lock: SkillLock;
  readonly request: WorkspaceProbeWorkerRequest;
  readonly extension: WorkspaceProbeWorkerExtension;
  readonly approval: ExtensionApproval;
}

interface ProbeRunContext {
  readonly io: TaskCommandIo;
  readonly workspace: TaskWorkspace;
  readonly runtime: RuntimeStore;
  readonly authority: ProbeAuthority;
  readonly trust: TrustRoot;
  readonly signer: EvidenceSigner;
  readonly target: ProbeTarget;
  readonly worker: AdmissibleWorker;
  readonly runId: string;
}

// invariant: AC 8 to AC 11. The registration is read once, verified, and must
// be SQLite's; the statement is read by SQLite's parser and the request planned
// under the registration's own policy, all before any run exists.
async function probeTarget(workspace: TaskWorkspace, databaseId: string, file: ProbeRequestFile): Promise<ProbeTarget> {
  const options = registrationOptions(workspace);
  const evaluation = await new DatabaseRegistrationFiles(options).evaluate(databaseId);
  if (evaluation.state !== "valid")
    throw evaluation.state === "absent"
      ? databaseError("VES_DATABASE_NOT_FOUND", {}, "No registration is on record for this database")
      : databaseError("VES_DATABASE_REGISTRATION_INVALID", {}, "The database registration no longer verifies");
  const { registration, policy } = evaluation.document;
  if (registration.engine !== "sqlite")
    throw probeError("VES_PROBE_ENGINE_UNAVAILABLE", {}, "Only a SQLite database can be probed");
  const statement = sqliteStatement(file, registration);
  const registry = new DatabaseRegistry({ store: new WorkspaceDatabaseRegistrationStore(options) });
  const planner = new ProbePlanner({ registry, adapters: [statement.adapter] });
  const requestId = `probe-request-${randomUUID()}`;
  const plan = (grantRef: string) =>
    planner.plan(
      {
        schemaVersion: 1,
        workspaceId: workspace.workspaceId,
        requestId,
        databaseId,
        purpose: file.purpose,
        operation: statement.operation,
        bounds: file.bounds,
        grantRef
      },
      policy
    );
  return Object.freeze({ statement, draft: await plan(PENDING_GRANT_REF), plan });
}

// invariant: AC 12. The worker is judged as `vestra extension check` judges it,
// and refused with the code of the first row that check fails. With every row
// passed, the lock, the extension and its approval are the ones it judged.
async function admissibleWorker(workspace: TaskWorkspace, approvalRef: string): Promise<AdmissibleWorker> {
  const inspection = await inspectExtension(workspace, approvalRef);
  const failed = inspection.checks.find((row) => row.status === "fail");
  if (failed !== undefined) throw new ProbeRefusal(String(failed.code), "The worker would not be admitted");
  return Object.freeze({
    lock: inspection.lock as SkillLock,
    request: inspection.request,
    extension: inspection.extension as WorkspaceProbeWorkerExtension,
    approval: inspection.approval as ExtensionApproval
  });
}

// invariant: door 3. The worker is admitted under the broker's grant, bound to
// the locked extension, its approval reference and its approved launch.
export function admissionGrant(
  grant: CapabilityGrant,
  worker: Pick<AdmissibleWorker, "extension" | "approval">
): WorkspaceProbeWorkerGrant {
  return Object.freeze({
    grantRef: grant.grantId,
    workspaceId: grant.workspaceId,
    lockDigest: worker.extension.lockDigest,
    extensionId: worker.extension.extensionRef.id,
    approvalRef: worker.extension.extensionRef.approvalRef,
    componentDigest: worker.extension.entry.digest,
    launchDigest: worker.approval.launchDigest,
    capabilities: Object.freeze([grant.capability]),
    isolationProfile: "process-contained",
    risk: "approved-workspace-executable"
  });
}

// invariant: the plan the worker runs differs from the approved one only in
// its grant, so a registration or policy changed since the review is refused
// before anything starts.
export function assertPlanApproved(plan: ProbePlan, approved: ProbePlan): void {
  const unbound = (value: ProbePlan) =>
    canonicalizeJsonV2(
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== "grantRef" && key !== "planDigest"))
    );
  if (unbound(plan) !== unbound(approved))
    throw probeError("VES_PROBE_PLAN_CHANGED", {}, "The probe plan changed since it was approved");
}

function subject(context: ProbeRunContext): Omit<ProbeApprovalSubject, "expiresAt"> {
  return {
    workspaceId: context.workspace.workspaceId,
    runId: context.runId,
    plan: context.target.draft,
    extensionId: context.worker.extension.extensionRef.id,
    launchDigest: context.worker.approval.launchDigest
  };
}

// invariant: AC 3, AC 6, AC 16 and AC 17. The admitted grant must be the
// plan's before anything starts, because the transport starts its process at
// once; the worker then gets exactly its approved launch, so no credential
// reaches it from Verchestra, and the supervisor keeps no row it returns.
async function supervisedProbe(context: ProbeRunContext, grant: CapabilityGrant): Promise<ProbeResult> {
  const { io, target, workspace, worker } = context;
  const plan = await target.plan(grant.grantId);
  assertPlanApproved(plan, target.draft);
  const admission = new WorkspaceProbeAdmission<SkillLock>({
    extensions: extensionRegistry(workspaceLockVerifier(context.trust)),
    approvals: approvalStore(workspace)
  });
  const trust = await admission.admit({
    workspaceId: workspace.workspaceId,
    lock: worker.lock,
    request: worker.request,
    grant: admissionGrant(grant, worker)
  });
  if (trust.grantRef !== plan.grantRef)
    throw new ProbeRefusal("VES_PROBE_WORKSPACE_TRUST_GRANT", "The admitted grant is not the plan's");
  const entry = await resolveEntry(workspace.repositoryRoot, worker.extension.entry.path);
  const transport = await SpawnedProbeWorker.launch({
    ...worker.approval.launch,
    entry: { path: entry.absolute, digest: worker.extension.entry.digest },
    approvedLaunchDigest: trust.launchDigest,
    workspaceId: workspace.workspaceId,
    platform: io.platform as NodeJS.Platform
  });
  try {
    const parameters = new MemoryProtectedParameterBroker();
    parameters.set(plan.operation.protectedRequestRef, target.statement.protectedRequest);
    target.statement.protectedRequest.fill(0);
    const framed = new FramedProbeWorker({
      transport,
      workspaceId: workspace.workspaceId,
      maximumMessageBytes: MAXIMUM_MESSAGE_BYTES
    });
    return await new ProbeWorkerSupervisor({
      worker: framed,
      parameters,
      results: new MemoryProbeResultSink(),
      plan,
      workspaceTrust: trust,
      maximumMessageBytes: MAXIMUM_MESSAGE_BYTES
    }).execute();
  } finally {
    await transport.terminate().catch(() => undefined);
  }
}

// invariant: AC 3 to AC 5. The approval is recorded and the run authorized
// before the grant is issued; the grant serves this run only, so it is revoked
// when the run ends, completed or failed.
async function authorizedRun(context: ProbeRunContext, request: ApprovalRequest): Promise<ProbeRunOutput> {
  const { authority, runtime, runId } = context;
  const approval = await authority.record(request, context.signer);
  applyWorkflow(runtime, runId, {
    type: "GRANT_EXECUTION_APPROVAL",
    actorRole: "human",
    actorId: HUMAN_ACTOR,
    evidence: ["execution-approval"],
    approvalBindingDigest: approval.bindingDigest,
    currentBindingDigest: request.bindingDigest
  });
  const grant = await authority.grant(approval, subject(context));
  try {
    const result = await supervisedProbe(context, grant);
    applyWorkflow(runtime, runId, {
      type: "COMPLETE_PROBE",
      actorRole: "controller",
      actorId: CONTROLLER,
      evidence: ["probe-result"]
    });
    return Object.freeze({ runId, approvalId: approval.approvalId, grantId: grant.grantId, result });
  } finally {
    await authority.revoke(grant.grantId, "probe-run-ended");
  }
}

// invariant: a refused run ends with the given command and the refusal is what
// the command reports; a run that cannot be ended stays where it was, which
// the runtime store shows.
async function endingOnRefusal<T>(
  runtime: RuntimeStore,
  runId: string,
  ending: typeof ABORT | typeof FAIL,
  work: () => Promise<T>
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    try {
      applyWorkflow(runtime, runId, ending);
    } catch {
      // why: the refusal outranks a failure to record the run's end.
    }
    throw error;
  }
}

// invariant: AC 1 and AC 7. The run exists, awaiting its approval, and the
// review is shown before the binding digest is read; nothing is recorded,
// granted or started unless that digest is typed back.
async function governedRun(context: ProbeRunContext, confirmStdin: boolean): Promise<ProbeRunOutput> {
  const { io, runtime, runId } = context;
  const expiresAt = new Date(Date.now() + PROBE_GRANT_LIFETIME_MS).toISOString();
  const request = context.authority.request({ ...subject(context), expiresAt });
  runtime.createRun({
    runId,
    runKind: "probe",
    state: "EXECUTION_READY",
    version: 0,
    repairCycles: 0,
    approval: undefined,
    terminalCapsuleRequired: false
  });
  applyWorkflow(runtime, runId, {
    type: "REQUEST_EXECUTION_APPROVAL",
    actorRole: "controller",
    actorId: CONTROLLER,
    evidence: ["execution-package"]
  });
  io.stderr(
    renderProbeReview({
      runId,
      plan: context.target.draft,
      extensionId: context.worker.extension.extensionRef.id,
      launchDigest: context.worker.approval.launchDigest,
      bindingDigest: request.bindingDigest
    })
  );
  await endingOnRefusal(runtime, runId, ABORT, () =>
    confirmDigest(io, request.bindingDigest, { confirmStdin, label: "binding" })
  );
  return endingOnRefusal(runtime, runId, FAIL, () => authorizedRun(context, request));
}

// invariant: AC 15 first, then AC 13, AC 8 to AC 12 and AC 14, each before any
// run exists: Windows is refused before anything is read, and the signing
// passphrase, the only credential read, is read last, so a missing one leaves
// no run behind.
export async function runProbe(io: TaskCommandIo, options: ProbeRunOptions): Promise<ProbeRunOutput> {
  refuseUnsupportedPlatform(io.platform);
  const file = await readProbeRequest(io.controlRoot, options.requestPath);
  const workspace = await openTaskWorkspace(io);
  await requireWorkspaceStateContained(workspace.layout);
  const target = await probeTarget(workspace, options.databaseId, file);
  const worker = await admissibleWorker(workspace, options.approvalRef);
  const signer = await unlockedSigner(io, workspace);
  const policy = await loadProbePolicy();
  const trust = await workspaceTrustRoot(workspace);
  const runtime = openRuntime(workspace);
  try {
    const authority = new ProbeAuthority({ runtime, trust, policy });
    const runId = `run_${randomUUID()}`;
    return await governedRun(
      { io, workspace, runtime, authority, trust, signer, target, worker, runId },
      options.confirmStdin
    );
  } finally {
    runtime.close();
  }
}
