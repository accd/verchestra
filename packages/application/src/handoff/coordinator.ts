// The portable handoff coordinator: the state machine that prepares, seals,
// publishes, claims, and reconciles a handoff across environments.

import { createHandoffSuccessor, type RunSnapshot } from "@verchestra/domain";

import { fail } from "./errors.ts";
import {
  artifactReceipt,
  normalizePrepare,
  normalizeRefInput,
  normalizeRun,
  openArtifact,
  packageProof,
  packageRequest,
  publishedResult,
  validatePackageBinding,
  workflowAccepted
} from "./normalize.ts";
import type { HandoffPorts, PackageProof, PreparedArtifact } from "./types.ts";
import { canonical, digest, exact, freeze, strings, token, type Digest, type Row } from "./validation.ts";

function normalizePublishInput(value: unknown) {
  const code = "VES_HANDOFF_INPUT_INVALID" as const;
  const row = exact(
    value,
    "publish input",
    ["schemaVersion", "workspaceId", "source", "handoffRef", "handoffDigest", "publicationApproval"],
    code
  );
  if (row.schemaVersion !== 1) fail(code, "schemaVersion is invalid");
  return freeze({
    workspaceId: token(row.workspaceId, "workspaceId", code),
    source: normalizeRun(row.source, "HANDOFF_PREPARING", code),
    handoffRef: token(row.handoffRef, "handoffRef", code),
    handoffDigest: digest(row.handoffDigest, "handoffDigest", code),
    publicationApproval: row.publicationApproval
  });
}

type PublishInput = ReturnType<typeof normalizePublishInput>;

// What a publication settles before its terminal transition: the source run,
// the publication receipt, and the claim disposition.
interface PreterminalState {
  readonly source: RunSnapshot;
  readonly publication: Readonly<Row>;
  readonly claim: Readonly<Row>;
}

function assertProgressBinding(progress: Row | undefined, input: PublishInput): void {
  if (
    progress !== undefined &&
    (progress["workspaceId"] !== input.workspaceId ||
      progress["handoffRef"] !== input.handoffRef ||
      progress["handoffDigest"] !== input.handoffDigest)
  )
    fail("VES_HANDOFF_FINAL_RECORD_INVALID", "publication progress belongs to different Handoff content");
}

function resumedPreterminal(progress: Row, artifact: PreparedArtifact): PreterminalState {
  const source = normalizeRun(
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
  const publication = freeze({
    receiptRef: token(savedPublication.receiptRef, "saved publication receiptRef", "VES_HANDOFF_FINAL_RECORD_INVALID"),
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
  const claim = freeze({
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
  return { source, publication, claim };
}

function resumedCapsule(progress: Row): Readonly<Row> {
  const savedCapsule = exact(
    progress["capsule"],
    "saved capsule",
    ["capsuleRef", "capsuleDigest"],
    "VES_HANDOFF_CAPSULE_INVALID"
  );
  return freeze({
    capsuleRef: token(savedCapsule.capsuleRef, "saved capsuleRef", "VES_HANDOFF_CAPSULE_INVALID"),
    capsuleDigest: digest(savedCapsule.capsuleDigest, "saved capsuleDigest", "VES_HANDOFF_CAPSULE_INVALID")
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
    const input = normalizePublishInput(value);
    const artifact = await openArtifact(this.ports, input);
    const existing = await this.ports.records.loadFinal(input.handoffRef);
    if (existing !== undefined) return publishedResult(existing);
    if (artifact.sourceRunId !== input.source.runId || artifact.successorRunId !== input.source.successorRunId)
      fail("VES_HANDOFF_ARTIFACT_INVALID", "source run does not match prepared Handoff");
    const proof = packageProof(await this.ports.packages.verify(packageRequest(input.workspaceId, artifact.package)));
    validatePackageBinding(proof, input.workspaceId, artifact.package, artifact.semanticObligationsDigest);
    let progress = (await this.ports.records.loadProgress(input.handoffRef)) as Row | undefined;
    assertProgressBinding(progress, input);
    let settled: PreterminalState;
    if (progress?.["claim"] !== undefined) settled = resumedPreterminal(progress, artifact);
    else ({ settled, progress } = await this.settlePreterminal(input, artifact));
    let terminalSource: RunSnapshot;
    if (progress?.["terminalSource"] !== undefined)
      terminalSource = normalizeRun(progress["terminalSource"], "HANDED_OFF", "VES_HANDOFF_FINAL_RECORD_INVALID");
    else ({ terminalSource, progress } = await this.commitTerminal(input, artifact, settled));
    const capsule =
      progress?.["capsule"] !== undefined
        ? resumedCapsule(progress)
        : await this.sealCapsule(input, artifact, settled, terminalSource);
    const record = freeze({
      status: "HANDED_OFF",
      workspaceId: input.workspaceId,
      handoffRef: input.handoffRef,
      handoffDigest: input.handoffDigest,
      artifact,
      source: terminalSource,
      publication: settled.publication,
      claim: settled.claim,
      capsule
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

  // The first pass of a publication: a remote destination is approved and
  // published, the claim is disposed of, and the pre-terminal progress is
  // saved so a retry resumes after it.
  private async settlePreterminal(
    input: PublishInput,
    artifact: PreparedArtifact
  ): Promise<{ readonly settled: PreterminalState; readonly progress: Row }> {
    let source = input.source;
    let publication: Readonly<Row> = freeze({
      receiptRef: "receipt:local-publication",
      receiptDigest: artifact.package.packageDigest
    });
    if (artifact.destination.kind === "remote")
      ({ source, publication } = await this.publishRemote(input, artifact, source));
    const claim = await this.disposeClaim(input, artifact, source);
    const progress = (await this.ports.records.saveProgress(
      freeze({
        schemaVersion: 1,
        stage: "PRETERMINAL_READY",
        workspaceId: input.workspaceId,
        handoffRef: input.handoffRef,
        handoffDigest: input.handoffDigest,
        source,
        publication,
        claim
      })
    )) as Row;
    return { settled: { source, publication, claim }, progress };
  }

  private async publishRemote(
    input: PublishInput,
    artifact: PreparedArtifact,
    preparing: RunSnapshot
  ): Promise<{ readonly source: RunSnapshot; readonly publication: Readonly<Row> }> {
    const code = "VES_HANDOFF_INPUT_INVALID" as const;
    const source = workflowAccepted(
      await this.ports.workflow.apply(
        preparing,
        freeze({
          type: "REQUEST_HANDOFF_PUBLICATION_APPROVAL",
          expectedVersion: preparing.version,
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
    if (approval.valid !== true || approval.action !== "handoff-publication" || approval.approvalRef !== approvalRef)
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
    return {
      source,
      publication: freeze({
        receiptRef: token(effect.receiptRef, "publication.receiptRef", "VES_HANDOFF_PUBLICATION_INVALID"),
        receiptDigest: digest(effect.receiptDigest, "publication.receiptDigest", "VES_HANDOFF_PUBLICATION_INVALID")
      })
    };
  }

  private async disposeClaim(
    input: PublishInput,
    artifact: PreparedArtifact,
    source: RunSnapshot
  ): Promise<Readonly<Row>> {
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
    return freeze({
      claimDispositionRef: token(claim.claimDispositionRef, "claimDispositionRef", "VES_HANDOFF_CLAIM_INVALID"),
      claimDispositionDigest: digest(
        claim.claimDispositionDigest,
        "claimDispositionDigest",
        "VES_HANDOFF_CLAIM_INVALID"
      )
    });
  }

  private async commitTerminal(
    input: PublishInput,
    artifact: PreparedArtifact,
    settled: PreterminalState
  ): Promise<{ readonly terminalSource: RunSnapshot; readonly progress: Row }> {
    const evidence = ["signed-package"];
    if (artifact.destination.kind === "remote")
      evidence.push("handoff-publication-approval", "handoff-publication-receipt");
    const terminalSource = workflowAccepted(
      await this.ports.workflow.apply(
        settled.source,
        freeze({
          type: "COMPLETE_HANDOFF",
          expectedVersion: settled.source.version,
          actorRole: "controller",
          actorId: "actor:handoff-controller",
          evidence,
          publicationRequired: artifact.destination.kind === "remote"
        })
      ),
      "HANDED_OFF"
    );
    const progress = (await this.ports.records.saveProgress(
      freeze({
        schemaVersion: 1,
        stage: "TERMINAL_COMMITTED",
        workspaceId: input.workspaceId,
        handoffRef: input.handoffRef,
        handoffDigest: input.handoffDigest,
        source: settled.source,
        publication: settled.publication,
        claim: settled.claim,
        terminalSource
      })
    )) as Row;
    return { terminalSource, progress };
  }

  private async sealCapsule(
    input: PublishInput,
    artifact: PreparedArtifact,
    settled: PreterminalState,
    terminalSource: RunSnapshot
  ): Promise<Readonly<Row>> {
    const capsule = exact(
      await this.ports.capsules.seal(
        freeze({ artifact, source: terminalSource, publication: settled.publication, claim: settled.claim })
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
    const normalizedCapsule = freeze({
      capsuleRef: token(capsule.capsuleRef, "capsuleRef", "VES_HANDOFF_CAPSULE_INVALID"),
      capsuleDigest: digest(capsule.capsuleDigest, "capsuleDigest", "VES_HANDOFF_CAPSULE_INVALID")
    });
    await this.ports.records.saveProgress(
      freeze({
        schemaVersion: 1,
        stage: "CAPSULE_SEALED",
        workspaceId: input.workspaceId,
        handoffRef: input.handoffRef,
        handoffDigest: input.handoffDigest,
        source: settled.source,
        publication: settled.publication,
        claim: settled.claim,
        terminalSource,
        capsule: normalizedCapsule
      })
    );
    return normalizedCapsule;
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
