import {
  ArtifactSealer,
  FileRunCapsuleStore,
  NodeEd25519Signer,
  RunCapsuleBuilder,
  RunCapsuleRecoveryCoordinator,
  createTrustRoot,
  sha256Digest
} from "../../packages/evidence/src/index.ts";

export const capsuleNow = "2026-07-15T18:00:00.000Z";
export const capsuleWorkspace = "workspace_018f0b6d-7b1a-7abc-8def-112345678901";
export const capsuleRun = "run_018f0b6d-7b1a-7abc-8def-112345678902";
export const capsuleDigest = (value) => `sha256:${sha256Digest(value)}`;
export const capsuleRef = (name) => ({ artifactId: `evidence:${name}`, digest: capsuleDigest(name) });

export function capsuleInput(status = "COMPLETED", riskTier = "low", overrides = {}) {
  const evidence = {
    decisions: [capsuleRef("decision")],
    modelSelections: [capsuleRef("model-selection-or-absence")],
    contexts: [capsuleRef("context-or-absence")],
    capabilityGrants: [capsuleRef("grant-or-absence")],
    approvals: [capsuleRef("approval-or-absence")],
    claims: [capsuleRef("claim-or-absence")],
    tasks: [capsuleRef("task-or-absence")],
    gates: [capsuleRef("gate-or-absence")],
    operationReceipts: [capsuleRef("receipt-or-no-effects")],
    outputs: [capsuleRef("output-or-absence")],
    terminal: [capsuleRef(`terminal-${status.toLowerCase()}`)]
  };
  const specific =
    status === "COMPLETED"
      ? { verificationRef: capsuleRef("verification"), humanReviewRef: capsuleRef("human-review") }
      : ["FAILED", "ABORTED", "INTERRUPTED"].includes(status)
        ? { terminalErrorRef: capsuleRef(`${status.toLowerCase()}-reason`) }
        : status === "RECOVERED"
          ? { recoveryRef: capsuleRef("recovery") }
          : status === "HANDED_OFF"
            ? {
                successorRunId: "run_018f0b6d-7b1a-7abc-8def-112345678903",
                handoff: {
                  packageRef: capsuleRef("execution-package"),
                  publicationReceiptRefs: [capsuleRef("handoff-publication")],
                  claimDispositionRef: capsuleRef("claim-release"),
                  receiverApprovalInherited: false
                }
              }
            : {};
  return {
    schemaVersion: 1,
    workspaceId: capsuleWorkspace,
    runId: capsuleRun,
    runKind: status === "RECOVERED" ? "recovery" : "feature",
    runVersion: 7,
    status,
    riskTier,
    requestDigest: capsuleDigest("request"),
    workspaceFingerprint: capsuleDigest("workspace"),
    executionPackageRef: capsuleRef("execution-package"),
    sourceStateRefs: [capsuleRef("source-api"), capsuleRef("source-control")],
    releaseDigest: capsuleDigest("release"),
    policyDigests: [capsuleDigest("policy-b"), capsuleDigest("policy-a")],
    skillLockDigest: capsuleDigest("skills"),
    evidence,
    ...specific,
    terminalTransition: {
      eventId: `event:${status.toLowerCase()}`,
      eventDigest: capsuleDigest(`event-${status}`),
      fromState: status === "COMPLETED" ? "HUMAN_REVIEW" : "EXECUTION_READY",
      toState: status,
      occurredAt: "2026-07-15T17:59:59.000Z"
    },
    sealedAt: capsuleNow,
    ...overrides
  };
}

export function capsuleHarness() {
  const signer = NodeEd25519Signer.generate({ keyId: "team-capsule-2026", purposes: ["run-capsule"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date("2030-01-01T00:00:00.000Z") });
  return {
    signer,
    sealer,
    builder: new RunCapsuleBuilder({ sealer }),
    trust: createTrustRoot({ trustRootId: "capsule-root", version: 1, keys: [signer.publicKeyRef] })
  };
}

export function capsuleExpectation(input = capsuleInput()) {
  return {
    workspaceId: input.workspaceId,
    runId: input.runId,
    runVersion: input.runVersion,
    status: input.status,
    evaluatedAt: capsuleNow
  };
}

export function recoveryCoordinator({ journal, resolver, builder, root, afterStore, afterPublish }) {
  return new RunCapsuleRecoveryCoordinator({
    journal,
    resolver,
    builder,
    store: new FileRunCapsuleStore({ root, ...(afterPublish === undefined ? {} : { afterPublish }) }),
    ...(afterStore === undefined ? {} : { afterStore })
  });
}
