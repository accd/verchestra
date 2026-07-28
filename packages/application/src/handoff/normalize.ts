// Normalizers that turn untrusted input into frozen, structurally valid
// handoff values, or fail closed.

import type { RunSnapshot, WorkflowDecision } from "@verchestra/domain";

import { fail, type HandoffErrorCode } from "./errors.ts";
import type { HandoffPorts, PackageProof, PackageReference, PreparedArtifact } from "./types.ts";
import {
  canonical,
  digest,
  exact,
  freeze,
  integer,
  literal,
  rejectPrivate,
  strings,
  token,
  type Digest,
  type Row
} from "./validation.ts";

export function normalizeRun(value: unknown, state: RunSnapshot["state"], code: HandoffErrorCode): RunSnapshot {
  const row = exact(
    value,
    "run",
    [
      "runId",
      "runKind",
      "state",
      "version",
      "repairCycles",
      "approval",
      "implementationActorId",
      "terminalCapsuleRequired",
      "predecessorRunId",
      "successorRunId"
    ],
    code
  );
  let approval: { readonly bindingDigest: string } | undefined;
  if (row.approval !== undefined) {
    const approvalRow = exact(row.approval, "run.approval", ["bindingDigest"], code);
    approval = { bindingDigest: digest(approvalRow.bindingDigest, "run.approval.bindingDigest", code) };
  }
  return freeze({
    runId: token(row.runId, "run.runId", code),
    runKind: literal(row.runKind, "run.runKind", ["feature", "recovery"] as const, code),
    state: literal(row.state, "run.state", [state] as const, code),
    version: integer(row.version, "run.version", 0, Number.MAX_SAFE_INTEGER, code),
    repairCycles: integer(row.repairCycles, "run.repairCycles", 0, 3, code),
    approval,
    ...(row.implementationActorId === undefined
      ? {}
      : { implementationActorId: token(row.implementationActorId, "run.implementationActorId", code) }),
    ...(row.terminalCapsuleRequired === undefined
      ? {}
      : { terminalCapsuleRequired: row.terminalCapsuleRequired === true }),
    ...(row.predecessorRunId === undefined
      ? {}
      : { predecessorRunId: token(row.predecessorRunId, "run.predecessorRunId", code) }),
    ...(row.successorRunId === undefined
      ? {}
      : { successorRunId: token(row.successorRunId, "run.successorRunId", code) })
  });
}

export function packageProof(value: unknown): PackageProof {
  const code = "VES_HANDOFF_PACKAGE_INVALID" as const;
  const row = exact(
    value,
    "package proof",
    [
      "valid",
      "workspaceId",
      "packageRef",
      "packageDigest",
      "sourceStateDigest",
      "semanticObligationsDigest",
      "packageId",
      "firstPendingTaskId",
      "pendingTaskIds",
      "requiredRoles",
      "requiredSecretNames",
      "requiredIntegrationNames"
    ],
    code
  );
  if (row.valid !== true) fail(code, "Execution Package proof is invalid");
  return freeze({
    workspaceId: token(row.workspaceId, "package.workspaceId", code),
    packageRef: token(row.packageRef, "package.packageRef", code),
    packageDigest: digest(row.packageDigest, "package.packageDigest", code),
    sourceStateDigest: digest(row.sourceStateDigest, "package.sourceStateDigest", code),
    semanticObligationsDigest: digest(row.semanticObligationsDigest, "package.semanticObligationsDigest", code),
    packageId: token(row.packageId, "package.packageId", code),
    firstPendingTaskId: token(row.firstPendingTaskId, "package.firstPendingTaskId", code),
    pendingTaskIds: strings(row.pendingTaskIds, "package.pendingTaskIds", code),
    requiredRoles: strings(row.requiredRoles, "package.requiredRoles", code),
    requiredSecretNames: strings(row.requiredSecretNames, "package.requiredSecretNames", code, true),
    requiredIntegrationNames: strings(row.requiredIntegrationNames, "package.requiredIntegrationNames", code, true)
  });
}

export function packageRequest(workspaceId: string, reference: PackageReference): Readonly<Row> {
  return freeze({ workspaceId, ...reference });
}

export function validatePackageBinding(
  proof: PackageProof,
  workspaceId: string,
  reference: PackageReference,
  obligations: Digest
): void {
  if (
    proof.workspaceId !== workspaceId ||
    proof.packageRef !== reference.packageRef ||
    proof.packageDigest !== reference.packageDigest ||
    proof.sourceStateDigest !== reference.sourceStateDigest ||
    proof.semanticObligationsDigest !== obligations
  )
    fail("VES_HANDOFF_PACKAGE_INVALID", "Execution Package proof does not match Handoff bindings");
}

export function artifactReceipt(value: unknown): { readonly handoffRef: string; readonly handoffDigest: Digest } {
  const code = "VES_HANDOFF_ARTIFACT_INVALID" as const;
  const row = exact(value, "artifact receipt", ["handoffRef", "handoffDigest"], code);
  return freeze({
    handoffRef: token(row.handoffRef, "handoffRef", code),
    handoffDigest: digest(row.handoffDigest, "handoffDigest", code)
  });
}

export function normalizeArtifact(value: unknown): PreparedArtifact {
  const code = "VES_HANDOFF_ARTIFACT_INVALID" as const;
  const row = exact(
    value,
    "Handoff artifact",
    [
      "schemaVersion",
      "workspaceId",
      "handoffId",
      "sourceRunId",
      "successorRunId",
      "package",
      "packageId",
      "firstPendingTaskId",
      "pendingTaskIds",
      "requiredRoles",
      "requiredSecretNames",
      "requiredIntegrationNames",
      "semanticObligationsDigest",
      "destination",
      "claim",
      "receiverApprovalInherited"
    ],
    code
  );
  if (row.schemaVersion !== 1 || row.receiverApprovalInherited !== false)
    fail(code, "Handoff artifact version or Approval inheritance is invalid");
  const packageRow = exact(row.package, "artifact.package", ["packageRef", "packageDigest", "sourceStateDigest"], code);
  const destinationRow = exact(
    row.destination,
    "artifact.destination",
    ["kind", "targetRef", "destinationDigest"],
    code
  );
  const claimRow = exact(row.claim, "artifact.claim", ["claimRef", "disposition"], code);
  return freeze({
    schemaVersion: 1,
    workspaceId: token(row.workspaceId, "artifact.workspaceId", code),
    handoffId: digest(row.handoffId, "artifact.handoffId", code),
    sourceRunId: token(row.sourceRunId, "artifact.sourceRunId", code),
    successorRunId: token(row.successorRunId, "artifact.successorRunId", code),
    package: {
      packageRef: token(packageRow.packageRef, "artifact.package.packageRef", code),
      packageDigest: digest(packageRow.packageDigest, "artifact.package.packageDigest", code),
      sourceStateDigest: digest(packageRow.sourceStateDigest, "artifact.package.sourceStateDigest", code)
    },
    packageId: token(row.packageId, "artifact.packageId", code),
    firstPendingTaskId: token(row.firstPendingTaskId, "artifact.firstPendingTaskId", code),
    pendingTaskIds: strings(row.pendingTaskIds, "artifact.pendingTaskIds", code),
    requiredRoles: strings(row.requiredRoles, "artifact.requiredRoles", code),
    requiredSecretNames: strings(row.requiredSecretNames, "artifact.requiredSecretNames", code, true),
    requiredIntegrationNames: strings(row.requiredIntegrationNames, "artifact.requiredIntegrationNames", code, true),
    semanticObligationsDigest: digest(row.semanticObligationsDigest, "artifact.semanticObligationsDigest", code),
    destination: {
      kind: literal(destinationRow.kind, "artifact.destination.kind", ["local", "remote"] as const, code),
      targetRef: token(destinationRow.targetRef, "artifact.destination.targetRef", code),
      destinationDigest: digest(destinationRow.destinationDigest, "artifact.destination.destinationDigest", code)
    },
    claim: {
      claimRef: token(claimRow.claimRef, "artifact.claim.claimRef", code),
      disposition: literal(claimRow.disposition, "artifact.claim.disposition", ["release", "transfer"] as const, code)
    },
    receiverApprovalInherited: false
  });
}

export function normalizePrepare(value: unknown) {
  rejectPrivate(value);
  const code = "VES_HANDOFF_INPUT_INVALID" as const;
  const row = exact(
    value,
    "prepare input",
    [
      "schemaVersion",
      "workspaceId",
      "source",
      "successorRunId",
      "package",
      "currentSourceStateDigest",
      "semanticObligationsDigest",
      "destination",
      "claim"
    ],
    code
  );
  if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
  const packageRow = exact(row.package, "package", ["packageRef", "packageDigest", "sourceStateDigest"], code);
  const destinationRow = exact(row.destination, "destination", ["kind", "targetRef", "destinationDigest"], code);
  const claimRow = exact(row.claim, "claim", ["claimRef", "disposition"], code);
  return freeze({
    workspaceId: token(row.workspaceId, "workspaceId", code),
    source: normalizeRun(row.source, "EXECUTION_READY", code),
    successorRunId: token(row.successorRunId, "successorRunId", code),
    package: {
      packageRef: token(packageRow.packageRef, "package.packageRef", code),
      packageDigest: digest(packageRow.packageDigest, "package.packageDigest", code),
      sourceStateDigest: digest(packageRow.sourceStateDigest, "package.sourceStateDigest", code)
    },
    currentSourceStateDigest: digest(row.currentSourceStateDigest, "currentSourceStateDigest", code),
    semanticObligationsDigest: digest(row.semanticObligationsDigest, "semanticObligationsDigest", code),
    destination: {
      kind: literal(destinationRow.kind, "destination.kind", ["local", "remote"] as const, code),
      targetRef: token(destinationRow.targetRef, "destination.targetRef", code),
      destinationDigest: digest(destinationRow.destinationDigest, "destination.destinationDigest", code)
    },
    claim: {
      claimRef: token(claimRow.claimRef, "claim.claimRef", code),
      disposition: literal(claimRow.disposition, "claim.disposition", ["release", "transfer"] as const, code)
    }
  });
}

export function normalizeRefInput(value: unknown, label: string) {
  const code = "VES_HANDOFF_INPUT_INVALID" as const;
  const row = exact(value, label, ["schemaVersion", "workspaceId", "handoffRef", "handoffDigest"], code);
  if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
  return freeze({
    workspaceId: token(row.workspaceId, "workspaceId", code),
    handoffRef: token(row.handoffRef, "handoffRef", code),
    handoffDigest: digest(row.handoffDigest, "handoffDigest", code)
  });
}

export async function openArtifact(
  ports: HandoffPorts,
  input: { workspaceId: string; handoffRef: string; handoffDigest: Digest }
): Promise<PreparedArtifact> {
  const code = "VES_HANDOFF_ARTIFACT_INVALID" as const;
  const row = exact(
    await ports.artifacts.open(input),
    "opened Handoff",
    ["valid", "artifact", "handoffRef", "handoffDigest"],
    code
  );
  if (row.valid !== true || row.handoffRef !== input.handoffRef || row.handoffDigest !== input.handoffDigest)
    fail(code, "Handoff artifact proof is invalid");
  rejectPrivate(row.artifact);
  const artifact = normalizeArtifact(row.artifact);
  const actualDigest = digest(ports.digest.sha256(canonical(artifact)), "opened Handoff digest", code);
  if (actualDigest !== input.handoffDigest) fail(code, "Handoff artifact content does not match its digest");
  if (artifact.workspaceId !== input.workspaceId)
    fail("VES_HANDOFF_WORKSPACE_MISMATCH", "Handoff belongs to another Workspace");
  if (artifact.receiverApprovalInherited !== false) fail(code, "Handoff cannot inherit receiver Approval");
  return freeze(artifact);
}

export function workflowAccepted(decision: WorkflowDecision, state: RunSnapshot["state"]): RunSnapshot {
  if (!decision.accepted || decision.nextState !== state)
    fail("VES_HANDOFF_WORKFLOW_REJECTED", `workflow did not reach ${state}`);
  return decision.snapshot;
}

export function publishedResult(value: unknown): Readonly<Row> {
  const row = value as Row;
  const capsule = row["capsule"] as Row | undefined;
  if (capsule === undefined) fail("VES_HANDOFF_FINAL_RECORD_INVALID", "final record has no capsule");
  return freeze({
    ...row,
    capsuleRef: token(capsule["capsuleRef"], "final capsuleRef", "VES_HANDOFF_FINAL_RECORD_INVALID"),
    capsuleDigest: digest(capsule["capsuleDigest"], "final capsuleDigest", "VES_HANDOFF_FINAL_RECORD_INVALID")
  });
}
