import {
  ArtifactSealer,
  ExecutionPackageBuilder,
  NodeEd25519Signer,
  createTrustRoot,
  sha256Digest
} from "../../packages/evidence/src/index.ts";

export const now = "2026-07-15T15:00:00.000Z";
export const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
export const projectIds = ["project_018f0b6d-7b1a-7abc-8def-0123456789ab"];
export const digest = (value) => `sha256:${sha256Digest(value)}`;

export function packageInput(overrides = {}) {
  const bindings = {
    sourceState: {
      "repo:api": digest("api-commit"),
      "repo:control": digest("control-commit")
    },
    policyDigest: digest("policy"),
    skillLockDigest: digest("skills"),
    contextDigest: digest("context"),
    dataAccessDigest: digest("data-access"),
    effectPlanDigest: digest("effects"),
    verificationPlanDigest: digest("verification"),
    destinationDigest: digest("destinations"),
    capabilityDigest: digest("capabilities"),
    budgetDigest: digest("budget"),
    evidenceDigest: digest("evidence")
  };
  return {
    schemaVersion: 1,
    packageVersion: 1,
    workspaceId,
    projectIds,
    featureId: "feature:refund-policy",
    executionContractDigest: digest("execution-contract"),
    requirements: [
      {
        requirementId: "VES-SPC-001",
        priority: "must",
        acceptanceCriteria: "WHEN the package is built THEN every requirement SHALL remain traceable.",
        assumptionState: "closed",
        independentTest: "node --test tests/unit/execution-package.test.mjs",
        artifactDigest: digest("requirement-1")
      },
      {
        requirementId: "VES-SPC-004",
        priority: "must",
        acceptanceCriteria: "WHEN execution is ready THEN the package SHALL reconstruct pending work.",
        assumptionState: "closed",
        independentTest: "node --test tests/unit/execution-package.test.mjs",
        artifactDigest: digest("requirement-2")
      }
    ],
    decisions: [{ artifactId: "adr:0015", digest: digest("adr-0015") }],
    tasks: [
      {
        taskId: "T-1",
        sequence: 1,
        requirementIds: ["VES-SPC-001"],
        dependsOn: [],
        componentRefs: ["packages/evidence"],
        verificationCommands: ["node --test tests/unit/execution-package.test.mjs"],
        doneCriteria: ["Package schema is closed"],
        risk: "medium",
        expectedCommit: "feat(evidence): add execution packages"
      },
      {
        taskId: "T-2",
        sequence: 2,
        requirementIds: ["VES-SPC-004"],
        dependsOn: ["T-1"],
        componentRefs: ["packages/evidence"],
        verificationCommands: ["node --test tests/security/execution-package-security.test.mjs"],
        doneCriteria: ["Pending work reconstructs exactly"],
        risk: "high",
        expectedCommit: "feat(evidence): add execution packages"
      },
      {
        taskId: "T-3",
        sequence: 3,
        requirementIds: ["VES-SPC-004"],
        dependsOn: ["T-2"],
        componentRefs: ["tests/system"],
        verificationCommands: ["node scripts/gate.mjs security"],
        doneCriteria: ["Security gate passes"],
        risk: "high",
        expectedCommit: "test(evidence): qualify execution packages"
      }
    ],
    completedTaskEvidence: [
      {
        taskId: "T-1",
        result: "passed",
        evidenceDigest: digest("T-1-evidence"),
        sourceStateDigest: digest(bindings.sourceState)
      }
    ],
    contextRecipes: [{ artifactId: "context:T-2", digest: digest("context-T-2") }],
    discoveryEvidence: [{ artifactId: "discovery:repository", digest: digest("discovery") }],
    dataPolicies: [{ artifactId: "data:readonly", digest: digest("data-policy") }],
    seedSpecifications: [{ artifactId: "seed:refund", digest: digest("seed") }],
    requiredCapabilities: ["code-edit", "test-run"],
    roleRequirements: [
      {
        role: "implementer",
        capabilities: ["code-edit", "test-run"],
        minimumContextTokens: 32768,
        reasoning: "high"
      },
      {
        role: "verifier",
        capabilities: ["repository-read", "test-run"],
        minimumContextTokens: 16384,
        reasoning: "high"
      }
    ],
    gates: [{ gateId: "security", command: "node scripts/gate.mjs security", evidenceRequired: true }],
    approvalRequirements: ["human-execution"],
    workClaimRequirement: { scopeDigest: digest("change-scope"), mode: "exclusive" },
    budgets: { maximumCostUsd: 20, maximumTokens: 500000, maximumDurationMs: 7200000 },
    completionCriteria: [
      {
        criterionId: "complete:security",
        requirementIds: ["VES-SPC-001", "VES-SPC-004"],
        verificationRefs: ["security"]
      }
    ],
    canonicalLocation: {
      gitOwnerId: digest("control-owner"),
      logicalPath: ".verchestra/execution-packages/feature-refund-policy-v1.json"
    },
    createdByRunId: "run:source-001",
    createdAt: now,
    bindings,
    ...overrides
  };
}

export function currentState(input = packageInput(), overrides = {}) {
  return {
    workspaceId: input.workspaceId,
    sourceState: structuredClone(input.bindings.sourceState),
    policyDigest: input.bindings.policyDigest,
    skillLockDigest: input.bindings.skillLockDigest,
    contextDigest: input.bindings.contextDigest,
    dataAccessDigest: input.bindings.dataAccessDigest,
    effectPlanDigest: input.bindings.effectPlanDigest,
    verificationPlanDigest: input.bindings.verificationPlanDigest,
    destinationDigest: input.bindings.destinationDigest,
    capabilityDigest: input.bindings.capabilityDigest,
    budgetDigest: input.bindings.budgetDigest,
    evidenceDigest: input.bindings.evidenceDigest,
    evaluatedAt: now,
    ...overrides
  };
}

export function executionHarness() {
  const signer = NodeEd25519Signer.generate({ keyId: "team-execution-2026", purposes: ["execution-package"] });
  const sealer = new ArtifactSealer({ signer, now: () => new Date(now) });
  return {
    signer,
    sealer,
    builder: new ExecutionPackageBuilder({ sealer }),
    trust: createTrustRoot({ trustRootId: "team-root", version: 1, keys: [signer.publicKeyRef] })
  };
}
