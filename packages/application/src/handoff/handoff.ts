import {
  createHandoffSuccessor,
  type RunSnapshot,
  type WorkflowCommand,
  type WorkflowDecision
} from "@verchestra/domain";

type Row = Record<string, unknown>;
type Digest = `sha256:${string}`;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}|file:|\/(?:home|Users|private|tmp|var)\/)/u;
const PROHIBITED = new Set([
  "provider",
  "providerId",
  "backend",
  "backendId",
  "model",
  "modelId",
  "session",
  "sessionId",
  "threadId",
  "transcript",
  "credential",
  "credentials",
  "secretValue",
  "token",
  "providerToken",
  "localPath",
  "absolutePath"
]);

export type HandoffErrorCode =
  | "VES_HANDOFF_INPUT_INVALID"
  | "VES_HANDOFF_PRIVATE_MATERIAL"
  | "VES_HANDOFF_SOURCE_STALE"
  | "VES_HANDOFF_PACKAGE_INVALID"
  | "VES_HANDOFF_ARTIFACT_INVALID"
  | "VES_HANDOFF_WORKSPACE_MISMATCH"
  | "VES_HANDOFF_WORKFLOW_REJECTED"
  | "VES_HANDOFF_PUBLICATION_APPROVAL_INVALID"
  | "VES_HANDOFF_RECONCILIATION_REQUIRED"
  | "VES_HANDOFF_PUBLICATION_INVALID"
  | "VES_HANDOFF_CLAIM_INVALID"
  | "VES_HANDOFF_CAPSULE_INVALID"
  | "VES_HANDOFF_FINAL_RECORD_INVALID"
  | "VES_HANDOFF_SUCCESSOR_MISMATCH"
  | "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
  | "VES_HANDOFF_POLICY_DENIED"
  | "VES_HANDOFF_CLAIM_REQUIRED"
  | "VES_HANDOFF_ACCEPTANCE_INVALID"
  | "VES_HANDOFF_EXECUTION_APPROVAL_INVALID";

export class HandoffError extends Error {
  readonly code: HandoffErrorCode;

  constructor(code: HandoffErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HandoffError";
    this.code = code;
  }
}

function fail(code: HandoffErrorCode, message: string): never {
  throw new HandoffError(code, message);
}

function exact<const Key extends string>(
  value: unknown,
  label: string,
  keys: readonly Key[],
  code: HandoffErrorCode
): Record<Key, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const row = value as Row;
  if (Object.keys(row).some((key) => !(keys as readonly string[]).includes(key)))
    fail(code, `${label} contains unknown fields`);
  return row as Record<Key, unknown>;
}

function token(value: unknown, label: string, code: HandoffErrorCode): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function digest(value: unknown, label: string, code: HandoffErrorCode): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code, `${label} is invalid`);
  return value as Digest;
}

function integer(value: unknown, label: string, min: number, max: number, code: HandoffErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(code, `${label} is invalid`);
  return value as number;
}

function literal<T extends string>(value: unknown, label: string, values: readonly T[], code: HandoffErrorCode): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(code, `${label} is invalid`);
  return value as T;
}

function strings(value: unknown, label: string, code: HandoffErrorCode, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100)
    fail(code, `${label} is invalid`);
  const result = value.map((entry, index) => token(entry, `${label}[${index}]`, code));
  if (new Set(result).size !== result.length) fail(code, `${label} contains duplicates`);
  return Object.freeze(result);
}

function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Row)) freeze(child, seen);
  return Object.freeze(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Row)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function rejectPrivate(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (ABSOLUTE.test(value)) fail("VES_HANDOFF_PRIVATE_MATERIAL", "Handoff contains a machine-local path");
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("VES_HANDOFF_PRIVATE_MATERIAL", "Handoff input is cyclic");
  seen.add(value);
  for (const [key, entry] of Object.entries(value as Row)) {
    if (PROHIBITED.has(key)) fail("VES_HANDOFF_PRIVATE_MATERIAL", `Handoff field is prohibited: ${key}`);
    rejectPrivate(entry, seen);
  }
  seen.delete(value);
}

function normalizeRun(value: unknown, state: RunSnapshot["state"], code: HandoffErrorCode): RunSnapshot {
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

interface PackageReference {
  readonly packageRef: string;
  readonly packageDigest: Digest;
  readonly sourceStateDigest: Digest;
}

interface Destination {
  readonly kind: "local" | "remote";
  readonly targetRef: string;
  readonly destinationDigest: Digest;
}

interface ClaimPlan {
  readonly claimRef: string;
  readonly disposition: "release" | "transfer";
}

interface PreparedArtifact {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly handoffId: Digest;
  readonly sourceRunId: string;
  readonly successorRunId: string;
  readonly package: PackageReference;
  readonly packageId: string;
  readonly firstPendingTaskId: string;
  readonly pendingTaskIds: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly requiredSecretNames: readonly string[];
  readonly requiredIntegrationNames: readonly string[];
  readonly semanticObligationsDigest: Digest;
  readonly destination: Destination;
  readonly claim: ClaimPlan;
  readonly receiverApprovalInherited: false;
}

interface PackageProof {
  readonly workspaceId: string;
  readonly packageRef: string;
  readonly packageDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly semanticObligationsDigest: Digest;
  readonly packageId: string;
  readonly firstPendingTaskId: string;
  readonly pendingTaskIds: readonly string[];
  readonly requiredRoles: readonly string[];
  readonly requiredSecretNames: readonly string[];
  readonly requiredIntegrationNames: readonly string[];
}

export interface HandoffPorts {
  readonly digest: { readonly sha256: (value: string) => string };
  readonly packages: { readonly verify: (request: Readonly<Row>) => Promise<unknown> };
  readonly artifacts: {
    readonly save: (artifact: PreparedArtifact) => Promise<unknown>;
    readonly open: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly workflow: {
    readonly apply: (snapshot: RunSnapshot, command: WorkflowCommand) => Promise<WorkflowDecision>;
  };
  readonly publicationApproval: { readonly verify: (request: Readonly<Row>) => Promise<unknown> };
  readonly effects: {
    readonly publish: (request: Readonly<Row>) => Promise<unknown>;
    readonly reconcile: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly claims: {
    readonly dispose: (request: Readonly<Row>) => Promise<unknown>;
    readonly acquire: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly capsules: {
    readonly seal: (request: Readonly<Row>) => Promise<unknown>;
    readonly verify: (request: Readonly<Row>) => Promise<unknown>;
  };
  readonly records: {
    readonly loadFinal: (handoffRef: string) => Promise<unknown>;
    readonly loadProgress: (handoffRef: string) => Promise<unknown>;
    readonly saveProgress: (record: Readonly<Row>) => Promise<unknown>;
    readonly saveFinal: (record: Readonly<Row>) => Promise<unknown>;
    readonly loadAcceptance: (handoffRef: string) => Promise<unknown>;
    readonly loadAcceptanceByRef: (acceptanceRef: string) => Promise<unknown>;
    readonly saveAcceptance: (record: Readonly<Row>) => Promise<unknown>;
    readonly loadContinuation: (acceptanceRef: string) => Promise<unknown>;
    readonly saveContinuation: (record: Readonly<Row>) => Promise<unknown>;
  };
  readonly bindings: { readonly resolve: (request: Readonly<Row>) => Promise<unknown> };
  readonly secrets: { readonly rebind: (request: Readonly<Row>) => Promise<unknown> };
  readonly integrations: { readonly rebind: (request: Readonly<Row>) => Promise<unknown> };
  readonly policy: { readonly reevaluate: (request: Readonly<Row>) => Promise<unknown> };
  readonly executionApproval: { readonly verify: (request: Readonly<Row>) => Promise<unknown> };
}

function packageProof(value: unknown): PackageProof {
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

function packageRequest(workspaceId: string, reference: PackageReference): Readonly<Row> {
  return freeze({ workspaceId, ...reference });
}

function validatePackageBinding(
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

function artifactReceipt(value: unknown): { readonly handoffRef: string; readonly handoffDigest: Digest } {
  const code = "VES_HANDOFF_ARTIFACT_INVALID" as const;
  const row = exact(value, "artifact receipt", ["handoffRef", "handoffDigest"], code);
  return freeze({
    handoffRef: token(row.handoffRef, "handoffRef", code),
    handoffDigest: digest(row.handoffDigest, "handoffDigest", code)
  });
}

function normalizeArtifact(value: unknown): PreparedArtifact {
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

function normalizePrepare(value: unknown) {
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

function normalizeRefInput(value: unknown, label: string) {
  const code = "VES_HANDOFF_INPUT_INVALID" as const;
  const row = exact(value, label, ["schemaVersion", "workspaceId", "handoffRef", "handoffDigest"], code);
  if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
  return freeze({
    workspaceId: token(row.workspaceId, "workspaceId", code),
    handoffRef: token(row.handoffRef, "handoffRef", code),
    handoffDigest: digest(row.handoffDigest, "handoffDigest", code)
  });
}

async function openArtifact(
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

function workflowAccepted(decision: WorkflowDecision, state: RunSnapshot["state"]): RunSnapshot {
  if (!decision.accepted || decision.nextState !== state)
    fail("VES_HANDOFF_WORKFLOW_REJECTED", `workflow did not reach ${state}`);
  return decision.snapshot;
}

function publishedResult(value: unknown): Readonly<Row> {
  const row = value as Row;
  const capsule = row["capsule"] as Row | undefined;
  if (capsule === undefined) fail("VES_HANDOFF_FINAL_RECORD_INVALID", "final record has no capsule");
  return freeze({
    ...row,
    capsuleRef: token(capsule["capsuleRef"], "final capsuleRef", "VES_HANDOFF_FINAL_RECORD_INVALID"),
    capsuleDigest: digest(capsule["capsuleDigest"], "final capsuleDigest", "VES_HANDOFF_FINAL_RECORD_INVALID")
  });
}

export class PortableHandoffCoordinator {
  private readonly ports: HandoffPorts;

  constructor(ports: HandoffPorts) {
    this.ports = ports;
  }

  async prepare(value: unknown): Promise<Readonly<Row>> {
    const input = normalizePrepare(value);
    if (input.source.runId === input.successorRunId)
      fail("VES_HANDOFF_SUCCESSOR_MISMATCH", "successor must be a new run");
    if (input.package.sourceStateDigest !== input.currentSourceStateDigest)
      fail("VES_HANDOFF_SOURCE_STALE", "source state changed before Handoff preparation");
    const proof = packageProof(await this.ports.packages.verify(packageRequest(input.workspaceId, input.package)));
    validatePackageBinding(proof, input.workspaceId, input.package, input.semanticObligationsDigest);
    const identity = freeze({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      sourceRunId: input.source.runId,
      successorRunId: input.successorRunId,
      packageDigest: input.package.packageDigest,
      destinationDigest: input.destination.destinationDigest,
      semanticObligationsDigest: input.semanticObligationsDigest
    });
    const handoffId = digest(
      this.ports.digest.sha256(canonical(identity)),
      "handoffId",
      "VES_HANDOFF_ARTIFACT_INVALID"
    );
    const artifact: PreparedArtifact = freeze({
      schemaVersion: 1,
      workspaceId: input.workspaceId,
      handoffId,
      sourceRunId: input.source.runId,
      successorRunId: input.successorRunId,
      package: input.package,
      packageId: proof.packageId,
      firstPendingTaskId: proof.firstPendingTaskId,
      pendingTaskIds: proof.pendingTaskIds,
      requiredRoles: proof.requiredRoles,
      requiredSecretNames: proof.requiredSecretNames,
      requiredIntegrationNames: proof.requiredIntegrationNames,
      semanticObligationsDigest: proof.semanticObligationsDigest,
      destination: input.destination,
      claim: input.claim,
      receiverApprovalInherited: false
    });
    const receipt = artifactReceipt(await this.ports.artifacts.save(artifact));
    const expectedArtifactDigest = digest(
      this.ports.digest.sha256(canonical(artifact)),
      "expected Handoff digest",
      "VES_HANDOFF_ARTIFACT_INVALID"
    );
    if (receipt.handoffDigest !== expectedArtifactDigest)
      fail("VES_HANDOFF_ARTIFACT_INVALID", "artifact store receipt does not bind canonical Handoff bytes");
    const source = workflowAccepted(
      await this.ports.workflow.apply(
        input.source,
        freeze({
          type: "PREPARE_HANDOFF",
          expectedVersion: input.source.version,
          actorRole: "controller",
          actorId: "actor:handoff-controller",
          evidence: ["signed-package"],
          successorRunId: input.successorRunId
        })
      ),
      "HANDOFF_PREPARING"
    );
    return freeze({ status: "PREPARED", workspaceId: input.workspaceId, ...receipt, source });
  }

  async inspect(value: unknown): Promise<Readonly<Row>> {
    const input = normalizeRefInput(value, "inspect input");
    const artifact = await openArtifact(this.ports, input);
    return freeze({
      handoffRef: input.handoffRef,
      handoffDigest: input.handoffDigest,
      sourceRunId: artifact.sourceRunId,
      successorRunId: artifact.successorRunId,
      destinationKind: artifact.destination.kind,
      firstPendingTaskId: artifact.firstPendingTaskId
    });
  }

  async publish(value: unknown): Promise<Readonly<Row>> {
    const code = "VES_HANDOFF_INPUT_INVALID" as const;
    const row = exact(
      value,
      "publish input",
      ["schemaVersion", "workspaceId", "source", "handoffRef", "handoffDigest", "publicationApproval"],
      code
    );
    if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
    const input = freeze({
      workspaceId: token(row.workspaceId, "workspaceId", code),
      source: normalizeRun(row.source, "HANDOFF_PREPARING", code),
      handoffRef: token(row.handoffRef, "handoffRef", code),
      handoffDigest: digest(row.handoffDigest, "handoffDigest", code),
      publicationApproval: row.publicationApproval
    });
    const artifact = await openArtifact(this.ports, input);
    const existing = await this.ports.records.loadFinal(input.handoffRef);
    if (existing !== undefined) return publishedResult(existing);
    if (artifact.sourceRunId !== input.source.runId || artifact.successorRunId !== input.source.successorRunId)
      fail("VES_HANDOFF_ARTIFACT_INVALID", "source run does not match prepared Handoff");
    const proof = packageProof(await this.ports.packages.verify(packageRequest(input.workspaceId, artifact.package)));
    validatePackageBinding(proof, input.workspaceId, artifact.package, artifact.semanticObligationsDigest);
    let progress = (await this.ports.records.loadProgress(input.handoffRef)) as Row | undefined;
    if (
      progress !== undefined &&
      (progress["workspaceId"] !== input.workspaceId ||
        progress["handoffRef"] !== input.handoffRef ||
        progress["handoffDigest"] !== input.handoffDigest)
    )
      fail("VES_HANDOFF_FINAL_RECORD_INVALID", "publication progress belongs to different Handoff content");
    let source: RunSnapshot;
    let publication: Readonly<Row>;
    let normalizedClaim: Readonly<Row>;
    if (progress?.["claim"] !== undefined) {
      source = normalizeRun(
        progress["source"],
        artifact.destination.kind === "remote" ? "AWAITING_HANDOFF_PUBLICATION_APPROVAL" : "HANDOFF_PREPARING",
        "VES_HANDOFF_FINAL_RECORD_INVALID"
      );
      const savedPublication = exact(
        progress["publication"],
        "saved publication",
        ["receiptRef", "receiptDigest"],
        "VES_HANDOFF_FINAL_RECORD_INVALID"
      );
      publication = freeze({
        receiptRef: token(
          savedPublication.receiptRef,
          "saved publication receiptRef",
          "VES_HANDOFF_FINAL_RECORD_INVALID"
        ),
        receiptDigest: digest(
          savedPublication.receiptDigest,
          "saved publication receiptDigest",
          "VES_HANDOFF_FINAL_RECORD_INVALID"
        )
      });
      const savedClaim = exact(
        progress["claim"],
        "saved claim",
        ["claimDispositionRef", "claimDispositionDigest"],
        "VES_HANDOFF_CLAIM_INVALID"
      );
      normalizedClaim = freeze({
        claimDispositionRef: token(
          savedClaim.claimDispositionRef,
          "saved claimDispositionRef",
          "VES_HANDOFF_CLAIM_INVALID"
        ),
        claimDispositionDigest: digest(
          savedClaim.claimDispositionDigest,
          "saved claimDispositionDigest",
          "VES_HANDOFF_CLAIM_INVALID"
        )
      });
    } else {
      source = input.source;
      publication = freeze({
        receiptRef: "receipt:local-publication",
        receiptDigest: artifact.package.packageDigest
      });
      if (artifact.destination.kind === "remote") {
        source = workflowAccepted(
          await this.ports.workflow.apply(
            source,
            freeze({
              type: "REQUEST_HANDOFF_PUBLICATION_APPROVAL",
              expectedVersion: source.version,
              actorRole: "controller",
              actorId: "actor:handoff-controller",
              evidence: ["signed-package"]
            })
          ),
          "AWAITING_HANDOFF_PUBLICATION_APPROVAL"
        );
        const approvalInput = exact(
          input.publicationApproval,
          "publicationApproval",
          ["approvalRef", "approvalDigest"],
          code
        );
        const approvalRef = token(approvalInput.approvalRef, "publicationApproval.approvalRef", code);
        const approvalDigest = digest(approvalInput.approvalDigest, "publicationApproval.approvalDigest", code);
        const approval = exact(
          await this.ports.publicationApproval.verify(
            freeze({
              action: "handoff-publication",
              workspaceId: input.workspaceId,
              sourceRunId: source.runId,
              handoffRef: input.handoffRef,
              handoffDigest: input.handoffDigest,
              packageDigest: artifact.package.packageDigest,
              destinationDigest: artifact.destination.destinationDigest,
              approvalRef,
              approvalDigest
            })
          ),
          "publication Approval proof",
          ["valid", "action", "approvalRef", "bindingDigest"],
          "VES_HANDOFF_PUBLICATION_APPROVAL_INVALID"
        );
        if (
          approval.valid !== true ||
          approval.action !== "handoff-publication" ||
          approval.approvalRef !== approvalRef
        )
          fail("VES_HANDOFF_PUBLICATION_APPROVAL_INVALID", "publication Approval is invalid");
        digest(approval.bindingDigest, "publication Approval binding", "VES_HANDOFF_PUBLICATION_APPROVAL_INVALID");
        const idempotencyKey = this.publicationKey(artifact);
        const effect = exact(
          await this.ports.effects.publish(
            freeze({
              idempotencyKey,
              workspaceId: input.workspaceId,
              handoffRef: input.handoffRef,
              handoffDigest: input.handoffDigest,
              targetRef: artifact.destination.targetRef,
              destinationDigest: artifact.destination.destinationDigest,
              packageRef: artifact.package.packageRef,
              packageDigest: artifact.package.packageDigest,
              approvalRef
            })
          ),
          "publication effect",
          ["status", "idempotencyKey", "receiptRef", "receiptDigest"],
          "VES_HANDOFF_PUBLICATION_INVALID"
        );
        if (effect.status === "uncertain")
          fail("VES_HANDOFF_RECONCILIATION_REQUIRED", "remote publication outcome is unknown");
        if (effect.status !== "completed" || effect.idempotencyKey !== idempotencyKey)
          fail("VES_HANDOFF_PUBLICATION_INVALID", "remote publication receipt is invalid");
        publication = freeze({
          receiptRef: token(effect.receiptRef, "publication.receiptRef", "VES_HANDOFF_PUBLICATION_INVALID"),
          receiptDigest: digest(effect.receiptDigest, "publication.receiptDigest", "VES_HANDOFF_PUBLICATION_INVALID")
        });
      }
      const claim = exact(
        await this.ports.claims.dispose(
          freeze({
            workspaceId: input.workspaceId,
            sourceRunId: source.runId,
            successorRunId: artifact.successorRunId,
            claimRef: artifact.claim.claimRef,
            disposition: artifact.claim.disposition,
            handoffDigest: input.handoffDigest
          })
        ),
        "claim disposition",
        ["valid", "claimDispositionRef", "claimDispositionDigest"],
        "VES_HANDOFF_CLAIM_INVALID"
      );
      if (claim.valid !== true) fail("VES_HANDOFF_CLAIM_INVALID", "claim disposition is invalid");
      normalizedClaim = freeze({
        claimDispositionRef: token(claim.claimDispositionRef, "claimDispositionRef", "VES_HANDOFF_CLAIM_INVALID"),
        claimDispositionDigest: digest(
          claim.claimDispositionDigest,
          "claimDispositionDigest",
          "VES_HANDOFF_CLAIM_INVALID"
        )
      });
      progress = (await this.ports.records.saveProgress(
        freeze({
          schemaVersion: 1,
          stage: "PRETERMINAL_READY",
          workspaceId: input.workspaceId,
          handoffRef: input.handoffRef,
          handoffDigest: input.handoffDigest,
          source,
          publication,
          claim: normalizedClaim
        })
      )) as Row;
    }
    const evidence = ["signed-package"];
    if (artifact.destination.kind === "remote")
      evidence.push("handoff-publication-approval", "handoff-publication-receipt");
    let terminalSource: RunSnapshot;
    if (progress?.["terminalSource"] !== undefined) {
      terminalSource = normalizeRun(progress["terminalSource"], "HANDED_OFF", "VES_HANDOFF_FINAL_RECORD_INVALID");
    } else {
      terminalSource = workflowAccepted(
        await this.ports.workflow.apply(
          source,
          freeze({
            type: "COMPLETE_HANDOFF",
            expectedVersion: source.version,
            actorRole: "controller",
            actorId: "actor:handoff-controller",
            evidence,
            publicationRequired: artifact.destination.kind === "remote"
          })
        ),
        "HANDED_OFF"
      );
      progress = (await this.ports.records.saveProgress(
        freeze({
          schemaVersion: 1,
          stage: "TERMINAL_COMMITTED",
          workspaceId: input.workspaceId,
          handoffRef: input.handoffRef,
          handoffDigest: input.handoffDigest,
          source,
          publication,
          claim: normalizedClaim,
          terminalSource
        })
      )) as Row;
    }
    let normalizedCapsule: Readonly<Row>;
    if (progress?.["capsule"] !== undefined) {
      const savedCapsule = exact(
        progress["capsule"],
        "saved capsule",
        ["capsuleRef", "capsuleDigest"],
        "VES_HANDOFF_CAPSULE_INVALID"
      );
      normalizedCapsule = freeze({
        capsuleRef: token(savedCapsule.capsuleRef, "saved capsuleRef", "VES_HANDOFF_CAPSULE_INVALID"),
        capsuleDigest: digest(savedCapsule.capsuleDigest, "saved capsuleDigest", "VES_HANDOFF_CAPSULE_INVALID")
      });
    } else {
      const capsule = exact(
        await this.ports.capsules.seal(
          freeze({ artifact, source: terminalSource, publication, claim: normalizedClaim })
        ),
        "Handoff capsule",
        [
          "capsuleRef",
          "capsuleDigest",
          "status",
          "sourceRunId",
          "successorRunId",
          "packageRef",
          "packageDigest",
          "receiverApprovalInherited"
        ],
        "VES_HANDOFF_CAPSULE_INVALID"
      );
      if (
        capsule.status !== "HANDED_OFF" ||
        capsule.sourceRunId !== terminalSource.runId ||
        capsule.successorRunId !== artifact.successorRunId ||
        capsule.packageRef !== artifact.package.packageRef ||
        capsule.packageDigest !== artifact.package.packageDigest ||
        capsule.receiverApprovalInherited !== false
      )
        fail("VES_HANDOFF_CAPSULE_INVALID", "Handoff capsule proof is invalid");
      normalizedCapsule = freeze({
        capsuleRef: token(capsule.capsuleRef, "capsuleRef", "VES_HANDOFF_CAPSULE_INVALID"),
        capsuleDigest: digest(capsule.capsuleDigest, "capsuleDigest", "VES_HANDOFF_CAPSULE_INVALID")
      });
      progress = (await this.ports.records.saveProgress(
        freeze({
          schemaVersion: 1,
          stage: "CAPSULE_SEALED",
          workspaceId: input.workspaceId,
          handoffRef: input.handoffRef,
          handoffDigest: input.handoffDigest,
          source,
          publication,
          claim: normalizedClaim,
          terminalSource,
          capsule: normalizedCapsule
        })
      )) as Row;
    }
    const record = freeze({
      status: "HANDED_OFF",
      workspaceId: input.workspaceId,
      handoffRef: input.handoffRef,
      handoffDigest: input.handoffDigest,
      artifact,
      source: terminalSource,
      publication,
      claim: normalizedClaim,
      capsule: normalizedCapsule
    });
    const saved = await this.ports.records.saveFinal(record);
    const savedRow = exact(
      saved,
      "final Handoff record",
      [
        "status",
        "workspaceId",
        "handoffRef",
        "handoffDigest",
        "artifact",
        "source",
        "publication",
        "claim",
        "capsule",
        "recordRef",
        "recordDigest"
      ],
      "VES_HANDOFF_FINAL_RECORD_INVALID"
    );
    token(savedRow.recordRef, "recordRef", "VES_HANDOFF_FINAL_RECORD_INVALID");
    digest(savedRow.recordDigest, "recordDigest", "VES_HANDOFF_FINAL_RECORD_INVALID");
    return publishedResult(savedRow);
  }

  async verify(value: unknown): Promise<Readonly<Row>> {
    const input = this.normalizeAccept(value);
    const artifact = await openArtifact(this.ports, input);
    const proof = packageProof(await this.ports.packages.verify(packageRequest(input.workspaceId, artifact.package)));
    validatePackageBinding(proof, input.workspaceId, artifact.package, artifact.semanticObligationsDigest);
    if (input.currentSourceStateDigest !== artifact.package.sourceStateDigest)
      fail("VES_HANDOFF_SOURCE_STALE", "receiver source state does not match package");
    if (input.successorRunId !== artifact.successorRunId)
      fail("VES_HANDOFF_SUCCESSOR_MISMATCH", "receiver successor does not match Handoff");
    const capsule = exact(
      await this.ports.capsules.verify(
        freeze({
          artifact,
          capsuleRef: input.capsuleRef,
          capsuleDigest: input.capsuleDigest
        })
      ),
      "capsule verification",
      [
        "valid",
        "status",
        "sourceRunId",
        "successorRunId",
        "packageRef",
        "packageDigest",
        "sourceStateDigest",
        "receiverApprovalInherited"
      ],
      "VES_HANDOFF_CAPSULE_INVALID"
    );
    if (
      capsule.valid !== true ||
      capsule.status !== "HANDED_OFF" ||
      capsule.sourceRunId !== artifact.sourceRunId ||
      capsule.successorRunId !== artifact.successorRunId ||
      capsule.packageRef !== artifact.package.packageRef ||
      capsule.packageDigest !== artifact.package.packageDigest ||
      capsule.sourceStateDigest !== artifact.package.sourceStateDigest ||
      capsule.receiverApprovalInherited !== false
    )
      fail("VES_HANDOFF_CAPSULE_INVALID", "capsule does not authenticate the Handoff closure");
    return freeze({ valid: true, artifact, packageProof: proof });
  }

  async accept(value: unknown): Promise<Readonly<Row>> {
    const input = this.normalizeAccept(value);
    const verified = await this.verify(value);
    const artifact = verified["artifact"] as PreparedArtifact;
    const proof = verified["packageProof"] as PackageProof;
    const final = await this.ports.records.loadFinal(input.handoffRef);
    if (final === undefined) fail("VES_HANDOFF_FINAL_RECORD_INVALID", "source Handoff is not terminal");
    const finalRow = final as Row;
    const source = normalizeRun(finalRow["source"], "HANDED_OFF", "VES_HANDOFF_FINAL_RECORD_INVALID");
    const existing = await this.ports.records.loadAcceptance(input.handoffRef);
    if (existing !== undefined) return freeze(existing as Row);
    const bindings = exact(
      await this.ports.bindings.resolve(
        freeze({
          workspaceId: input.workspaceId,
          successorRunId: input.successorRunId,
          machineProfileRef: input.receiver.machineProfileRef,
          requiredRoles: artifact.requiredRoles
        })
      ),
      "local bindings",
      ["ready", "localBindingDigest", "passportRefs"],
      "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
    );
    if (bindings.ready !== true) fail("VES_HANDOFF_LOCAL_BINDINGS_REQUIRED", "local Passports are not ready");
    const passportRefs = strings(bindings.passportRefs, "passportRefs", "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED");
    const passportDigest = digest(
      bindings.localBindingDigest,
      "localBindingDigest",
      "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
    );
    const secretBinding = this.readyBinding(
      await this.ports.secrets.rebind(
        freeze({
          workspaceId: input.workspaceId,
          successorRunId: input.successorRunId,
          logicalNames: artifact.requiredSecretNames
        })
      ),
      "secret"
    );
    const integrationBinding = this.readyBinding(
      await this.ports.integrations.rebind(
        freeze({
          workspaceId: input.workspaceId,
          successorRunId: input.successorRunId,
          logicalNames: artifact.requiredIntegrationNames
        })
      ),
      "integration"
    );
    const policy = exact(
      await this.ports.policy.reevaluate(
        freeze({
          workspaceId: input.workspaceId,
          sourceRunId: artifact.sourceRunId,
          successorRunId: input.successorRunId,
          packageDigest: artifact.package.packageDigest,
          semanticObligationsDigest: artifact.semanticObligationsDigest,
          passportDigest,
          secretBindingDigest: secretBinding,
          integrationBindingDigest: integrationBinding
        })
      ),
      "receiver policy",
      ["allowed", "policyDigest", "approvalInvalidated"],
      "VES_HANDOFF_POLICY_DENIED"
    );
    if (policy.allowed !== true || policy.approvalInvalidated !== true)
      fail("VES_HANDOFF_POLICY_DENIED", "receiver policy did not invalidate inherited authority");
    const policyDigest = digest(policy.policyDigest, "receiver policy digest", "VES_HANDOFF_POLICY_DENIED");
    const claim = exact(
      await this.ports.claims.acquire(
        freeze({
          workspaceId: input.workspaceId,
          successorRunId: input.successorRunId,
          actorId: input.receiver.actorId,
          packageDigest: artifact.package.packageDigest
        })
      ),
      "receiver claim",
      ["acquired", "claimRef", "claimDigest"],
      "VES_HANDOFF_CLAIM_REQUIRED"
    );
    if (claim.acquired !== true) fail("VES_HANDOFF_CLAIM_REQUIRED", "receiver claim was not acquired");
    const claimRef = token(claim.claimRef, "receiver claimRef", "VES_HANDOFF_CLAIM_REQUIRED");
    const claimDigest = digest(claim.claimDigest, "receiver claimDigest", "VES_HANDOFF_CLAIM_REQUIRED");
    const localBindingDigest = digest(
      this.ports.digest.sha256(
        canonical({ passportDigest, passportRefs, secretBinding, integrationBinding, policyDigest, claimDigest })
      ),
      "combined local binding",
      "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
    );
    const successor = createHandoffSuccessor({
      source,
      successorRunId: input.successorRunId,
      packageVerified: true,
      sourceStateDigest: input.currentSourceStateDigest,
      packageSourceStateDigest: artifact.package.sourceStateDigest,
      localBindingsReady: true,
      claimReady: true,
      policyReevaluated: true,
      firstPendingTaskId: proof.firstPendingTaskId
    });
    const record = freeze({
      status: "EXECUTION_READY",
      workspaceId: input.workspaceId,
      handoffRef: input.handoffRef,
      handoffDigest: input.handoffDigest,
      capsuleRef: input.capsuleRef,
      capsuleDigest: input.capsuleDigest,
      receiver: input.receiver,
      successor,
      firstPendingTaskId: proof.firstPendingTaskId,
      pendingTaskIds: proof.pendingTaskIds,
      semanticObligationsDigest: proof.semanticObligationsDigest,
      localBindingDigest,
      passportRefs,
      claimRef
    });
    const saved = (await this.ports.records.saveAcceptance(record)) as Row;
    token(saved["acceptanceRef"], "acceptanceRef", "VES_HANDOFF_ACCEPTANCE_INVALID");
    digest(saved["acceptanceDigest"], "acceptanceDigest", "VES_HANDOFF_ACCEPTANCE_INVALID");
    return freeze(saved);
  }

  async continue(value: unknown): Promise<Readonly<Row>> {
    const code = "VES_HANDOFF_INPUT_INVALID" as const;
    const row = exact(
      value,
      "continue input",
      [
        "schemaVersion",
        "workspaceId",
        "successor",
        "acceptanceRef",
        "acceptanceDigest",
        "currentBindingDigest",
        "executionApproval"
      ],
      code
    );
    if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
    const workspaceId = token(row.workspaceId, "workspaceId", code);
    const successor = normalizeRun(row.successor, "EXECUTION_READY", code);
    const acceptanceRef = token(row.acceptanceRef, "acceptanceRef", code);
    const acceptanceDigest = digest(row.acceptanceDigest, "acceptanceDigest", code);
    const currentBindingDigest = digest(row.currentBindingDigest, "currentBindingDigest", code);
    const acceptance = await this.ports.records.loadAcceptanceByRef(acceptanceRef);
    if (
      acceptance === undefined ||
      (acceptance as Row)["acceptanceDigest"] !== acceptanceDigest ||
      (acceptance as Row)["workspaceId"] !== workspaceId ||
      ((acceptance as Row)["successor"] as Row | undefined)?.["runId"] !== successor.runId
    )
      fail("VES_HANDOFF_ACCEPTANCE_INVALID", "acceptance receipt is invalid");
    const existing = await this.ports.records.loadContinuation(acceptanceRef);
    if (existing !== undefined) return freeze(existing as Row);
    const approvalRow = exact(
      row.executionApproval,
      "executionApproval",
      ["approvalRef", "approvalDigest", "bindingDigest"],
      code
    );
    const approval = freeze({
      approvalRef: token(approvalRow.approvalRef, "executionApproval.approvalRef", code),
      approvalDigest: digest(approvalRow.approvalDigest, "executionApproval.approvalDigest", code),
      bindingDigest: digest(approvalRow.bindingDigest, "executionApproval.bindingDigest", code)
    });
    if (approval.bindingDigest !== currentBindingDigest)
      fail("VES_HANDOFF_EXECUTION_APPROVAL_INVALID", "Execution Approval binding is stale");
    const proof = exact(
      await this.ports.executionApproval.verify(
        freeze({
          action: "execution",
          workspaceId,
          successorRunId: successor.runId,
          acceptanceRef,
          acceptanceDigest,
          currentBindingDigest,
          approval
        })
      ),
      "Execution Approval proof",
      ["valid", "action", "approvalRef", "bindingDigest"],
      "VES_HANDOFF_EXECUTION_APPROVAL_INVALID"
    );
    if (
      proof.valid !== true ||
      proof.action !== "execution" ||
      proof.approvalRef !== approval.approvalRef ||
      proof.bindingDigest !== currentBindingDigest
    )
      fail("VES_HANDOFF_EXECUTION_APPROVAL_INVALID", "receiver Execution Approval is invalid");
    const awaiting = workflowAccepted(
      await this.ports.workflow.apply(
        successor,
        freeze({
          type: "REQUEST_EXECUTION_APPROVAL",
          expectedVersion: successor.version,
          actorRole: "controller",
          actorId: "actor:handoff-controller",
          evidence: ["execution-package"]
        })
      ),
      "AWAITING_EXECUTION_APPROVAL"
    );
    const authorized = workflowAccepted(
      await this.ports.workflow.apply(
        awaiting,
        freeze({
          type: "GRANT_EXECUTION_APPROVAL",
          expectedVersion: awaiting.version,
          actorRole: "human",
          actorId: "actor:execution-approver",
          evidence: ["execution-approval"],
          currentBindingDigest,
          approvalBindingDigest: currentBindingDigest
        })
      ),
      "EXECUTION_AUTHORIZED"
    );
    const firstPendingTaskId = token(
      (acceptance as Row)["firstPendingTaskId"],
      "acceptance.firstPendingTaskId",
      "VES_HANDOFF_ACCEPTANCE_INVALID"
    );
    const record = freeze({
      status: "EXECUTION_AUTHORIZED",
      workspaceId,
      acceptanceRef,
      acceptanceDigest,
      currentBindingDigest,
      successor: authorized,
      firstPendingTaskId
    });
    return freeze((await this.ports.records.saveContinuation(record)) as Row);
  }

  async reconcile(value: unknown): Promise<Readonly<Row>> {
    const input = normalizeRefInput(value, "reconcile input");
    const artifact = await openArtifact(this.ports, input);
    if (artifact.destination.kind !== "remote")
      fail("VES_HANDOFF_PUBLICATION_INVALID", "local Handoff has no remote effect to reconcile");
    const idempotencyKey = this.publicationKey(artifact);
    const result = exact(
      await this.ports.effects.reconcile(
        freeze({
          idempotencyKey,
          workspaceId: input.workspaceId,
          handoffRef: input.handoffRef,
          handoffDigest: input.handoffDigest
        })
      ),
      "publication reconciliation",
      ["status", "idempotencyKey", "receiptRef", "receiptDigest"],
      "VES_HANDOFF_RECONCILIATION_REQUIRED"
    );
    if (result.idempotencyKey !== idempotencyKey)
      fail("VES_HANDOFF_RECONCILIATION_REQUIRED", "reconciliation identity is invalid");
    if (result.status === "applied") {
      token(result.receiptRef, "reconciliation receiptRef", "VES_HANDOFF_RECONCILIATION_REQUIRED");
      digest(result.receiptDigest, "reconciliation receiptDigest", "VES_HANDOFF_RECONCILIATION_REQUIRED");
      return freeze({ status: "READY_TO_RESUME", idempotencyKey });
    }
    if (result.status === "not-applied") return freeze({ status: "READY_TO_RETRY", idempotencyKey });
    return freeze({ status: "RECONCILIATION_REQUIRED", idempotencyKey });
  }

  private normalizeAccept(value: unknown) {
    const code = "VES_HANDOFF_INPUT_INVALID" as const;
    const row = exact(
      value,
      "accept input",
      [
        "schemaVersion",
        "workspaceId",
        "handoffRef",
        "handoffDigest",
        "capsuleRef",
        "capsuleDigest",
        "successorRunId",
        "receiver",
        "currentSourceStateDigest"
      ],
      code
    );
    if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
    const receiver = exact(row.receiver, "receiver", ["actorId", "machineProfileRef"], code);
    return freeze({
      workspaceId: token(row.workspaceId, "workspaceId", code),
      handoffRef: token(row.handoffRef, "handoffRef", code),
      handoffDigest: digest(row.handoffDigest, "handoffDigest", code),
      capsuleRef: token(row.capsuleRef, "capsuleRef", code),
      capsuleDigest: digest(row.capsuleDigest, "capsuleDigest", code),
      successorRunId: token(row.successorRunId, "successorRunId", code),
      receiver: {
        actorId: token(receiver.actorId, "receiver.actorId", code),
        machineProfileRef: token(receiver.machineProfileRef, "receiver.machineProfileRef", code)
      },
      currentSourceStateDigest: digest(row.currentSourceStateDigest, "currentSourceStateDigest", code)
    });
  }

  private readyBinding(value: unknown, kind: "secret" | "integration"): Digest {
    const row = exact(value, `${kind} bindings`, ["ready", "bindingDigest"], "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED");
    if (row.ready !== true) fail("VES_HANDOFF_LOCAL_BINDINGS_REQUIRED", `${kind} bindings are not ready`);
    return digest(row.bindingDigest, `${kind} bindingDigest`, "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED");
  }

  private publicationKey(artifact: PreparedArtifact): Digest {
    return digest(
      this.ports.digest.sha256(
        canonical({
          schemaVersion: 1,
          operationKind: "handoff-publication",
          workspaceId: artifact.workspaceId,
          logicalTarget: artifact.destination.targetRef,
          canonicalInputDigest: artifact.package.packageDigest,
          semanticIdentity: artifact.handoffId
        })
      ),
      "publication idempotency key",
      "VES_HANDOFF_PUBLICATION_INVALID"
    );
  }
}
