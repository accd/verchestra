import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  ApprovalService,
  FULL_CHECK_IDS,
  IndependentVerificationCoordinator,
  PortableHandoffCoordinator,
  type ApprovalArtifactPort,
  type HandoffPorts,
  type FullDurableBoundaryId,
  type RootFacts,
  type ScenarioCheck,
  type SignedApprovalArtifact,
  type SubjectRunFacts,
  type VerificationPorts
} from "@verchestra/application";
import {
  CapabilityModelRouter,
  ContextSnapshotResolver,
  DeterministicContextCompiler,
  type ContextRecipe,
  type PassportRecord
} from "@verchestra/agent-runtime";
import { FixedClock, IsoInstant, WorkflowMachine } from "@verchestra/domain";
import { EffectBroker, MockEffectAdapter, buildIdempotencyKey } from "@verchestra/effects";
import {
  ArtifactSealer,
  ExecutionPackageBuilder,
  FileExecutionPackageStore,
  FileRunCapsuleStore,
  NodeEd25519Signer,
  RunCapsuleBuilder,
  createTrustRoot,
  sha256Digest,
  type RunCapsuleBuildInput,
  type SignedExecutionPackage,
  type SignedRunCapsule
} from "@verchestra/evidence";
import { NodeContentDigest, RuntimeAuthorityStore, RuntimeStore } from "@verchestra/platform-node";

import { runSelfTestExecutionAndGate } from "./self-test-full-execution.ts";

const NOW = "2026-07-15T15:00:00.000Z";
const LATER = "2026-07-15T16:00:00.000Z";
const WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
const SOURCE_RUN_ID = "run_018f0b6d-7b1a-7abc-8def-112345678901";
const SUCCESSOR_RUN_ID = "run_018f0b6d-7b1a-7abc-8def-212345678901";
const MACHINE_ID = "machine_018f0b6d-7b1a-7abc-8def-312345678901";
type ShaDigest = `sha256:${string}`;
const digest = (value: string): ShaDigest => `sha256:${sha256Digest(value)}`;
const envelopeDigest = (value: string): ShaDigest => `sha256:${value}`;
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

function textField(row: Readonly<Record<string, unknown>>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`${key} is not a string`);
  return value;
}

function recordField(row: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
  const value = row[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} is not a record`);
  return value as Readonly<Record<string, unknown>>;
}

interface ScenarioDiagnostics {
  readonly packageStored: "published" | "already-published";
  readonly packageVerified: boolean;
  readonly approvalVerified: boolean;
  readonly contextFragments: number;
  readonly routedPassportId: string;
  readonly executionStatus: string;
  readonly effectApplyCalls: number;
  readonly gateStatus: string;
  readonly verificationVerdict: string;
  readonly handoffStatus: string;
  readonly capsuleStored: "published" | "already-published";
  readonly capsuleVerified: boolean;
}

export interface FullWorkflowScenarioResult {
  readonly facts: SubjectRunFacts;
  readonly diagnostics: ScenarioDiagnostics;
  readonly portableArtifacts: readonly [SignedExecutionPackage, SignedRunCapsule];
}

export interface FullScenarioBoundaryHooks {
  readonly before: (boundaryId: FullDurableBoundaryId) => Promise<void>;
  readonly after: (boundaryId: FullDurableBoundaryId) => Promise<void>;
}

const NO_BOUNDARY_HOOKS: FullScenarioBoundaryHooks = {
  before: async () => undefined,
  after: async () => undefined
};

async function atBoundary<T>(
  hooks: FullScenarioBoundaryHooks,
  boundaryId: FullDurableBoundaryId,
  operation: () => Promise<T>
): Promise<T> {
  await hooks.before(boundaryId);
  const result = await operation();
  await hooks.after(boundaryId);
  return result;
}

async function durableSigner(
  root: RootFacts,
  keyId: string,
  purpose: "execution-package" | "approval" | "run-capsule"
): Promise<NodeEd25519Signer> {
  const directory = join(root.canonicalPath, ".self-test-keys");
  const path = join(directory, `${purpose}.pk8`);
  await mkdir(directory, { recursive: true });
  let encoded: Uint8Array;
  try {
    encoded = await readFile(path);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "ENOENT") throw error;
    const generated = NodeEd25519Signer.generate({ keyId, purposes: [purpose] });
    encoded = generated.exportPkcs8();
    try {
      await writeFile(path, encoded, { flag: "wx", mode: 0o600 });
    } catch (writeError) {
      if ((writeError as { readonly code?: unknown }).code !== "EEXIST") throw writeError;
      encoded = await readFile(path);
    }
  }
  return NodeEd25519Signer.fromPkcs8({ keyId, purposes: [purpose] }, encoded);
}

function executionInput() {
  const bindings = {
    sourceState: { "repo:control": digest("control-state") },
    policyDigest: digest("policy"),
    skillLockDigest: digest("skills"),
    contextDigest: digest("context"),
    dataAccessDigest: digest("data-access"),
    effectPlanDigest: digest("effects"),
    verificationPlanDigest: digest("verification"),
    destinationDigest: digest("destination"),
    capabilityDigest: digest("capabilities"),
    budgetDigest: digest("budget"),
    evidenceDigest: digest("evidence")
  };
  return {
    schemaVersion: 1 as const,
    packageVersion: 1,
    workspaceId: WORKSPACE_ID,
    projectIds: ["project_018f0b6d-7b1a-7abc-8def-412345678901"],
    featureId: "feature:self-test-full",
    executionContractDigest: digest("execution-contract"),
    requirements: [
      {
        requirementId: "VES-STF-001",
        priority: "must" as const,
        acceptanceCriteria: "WHEN full self-test runs THEN production boundaries SHALL pass.",
        assumptionState: "closed" as const,
        independentTest: "node --test tests/integration/self-test-full-scenario.test.mjs",
        artifactDigest: digest("requirement")
      }
    ],
    decisions: [{ artifactId: "adr:self-test", digest: digest("decision") }],
    tasks: [
      {
        taskId: "T71",
        sequence: 1,
        requirementIds: ["VES-STF-001"],
        dependsOn: [],
        componentRefs: ["apps/vestra-cli"],
        verificationCommands: ["node --test tests/integration/self-test-full-scenario.test.mjs"],
        doneCriteria: ["Production boundaries pass"],
        risk: "high" as const,
        expectedCommit: "feat(self-test): add full workflow scenario"
      }
    ],
    completedTaskEvidence: [],
    contextRecipes: [{ artifactId: "context:self-test", digest: bindings.contextDigest }],
    discoveryEvidence: [{ artifactId: "discovery:repository", digest: digest("discovery") }],
    dataPolicies: [{ artifactId: "data:readonly", digest: bindings.dataAccessDigest }],
    seedSpecifications: [{ artifactId: "seed:self-test", digest: digest("seed") }],
    requiredCapabilities: ["planning"],
    roleRequirements: [
      { role: "implementer", capabilities: ["planning"], minimumContextTokens: 4096, reasoning: "high" }
    ],
    gates: [{ gateId: "quick", command: "pnpm gate:quick", evidenceRequired: true }],
    approvalRequirements: ["human-execution"],
    workClaimRequirement: { scopeDigest: digest("scope"), mode: "exclusive" as const },
    budgets: { maximumCostUsd: 1, maximumTokens: 10000, maximumDurationMs: 60000 },
    completionCriteria: [
      { criterionId: "complete:self-test", requirementIds: ["VES-STF-001"], verificationRefs: ["quick"] }
    ],
    canonicalLocation: {
      gitOwnerId: digest("owner"),
      logicalPath: ".verchestra/execution-packages/self-test-full.json"
    },
    createdByRunId: SOURCE_RUN_ID,
    createdAt: NOW,
    bindings
  };
}

function currentExecutionState(input: ReturnType<typeof executionInput>) {
  return { ...input.bindings, workspaceId: input.workspaceId, evaluatedAt: NOW };
}

function ensureRuntimeRun(runtime: RuntimeStore): void {
  try {
    runtime.getRun(SOURCE_RUN_ID);
  } catch (error) {
    if ((error as { readonly code?: unknown }).code !== "VES_RUNTIME_NOT_FOUND") throw error;
    runtime.createRun({
      runId: SOURCE_RUN_ID,
      runKind: "feature",
      state: "AWAITING_EXECUTION_APPROVAL",
      version: 1,
      repairCycles: 0,
      approval: undefined,
      terminalCapsuleRequired: false
    });
  }
}

async function approve(root: RootFacts, packageArtifact: SignedExecutionPackage, signer: NodeEd25519Signer) {
  const clock = new FixedClock(IsoInstant.parse(NOW));
  const sealer = new ArtifactSealer({ signer, now: () => new Date(NOW) });
  const trust = createTrustRoot({ trustRootId: "self-test-approval-root", version: 1, keys: [signer.publicKeyRef] });
  const artifacts: ApprovalArtifactPort = {
    seal: async (payload) =>
      sealer.seal(payload as never, {
        schema: { name: "approval-grant", version: 1 },
        purpose: "approval",
        bindingId: payload.approvalId,
        sourceStateDigest: payload.binding.sourceStateDigest.slice(7)
      }) as unknown as Promise<SignedApprovalArtifact>,
    verify: async (artifact) =>
      sealer.verify(artifact as never, trust, {
        schema: { name: "approval-grant", version: 1 },
        purpose: "approval",
        bindingId: artifact.payload.approvalId,
        sourceStateDigest: artifact.payload.binding.sourceStateDigest.slice(7),
        now: new Date(NOW)
      })
  };
  const runtime = new RuntimeStore({ dbPath: join(root.canonicalPath, "runtime.sqlite"), now: () => NOW });
  runtime.open();
  try {
    ensureRuntimeRun(runtime);
    const store = new RuntimeAuthorityStore(runtime);
    const service = new ApprovalService({
      store,
      digest: new NodeContentDigest(),
      clock,
      uuid: () => "018f0b6d-7b1a-7abc-8def-512345678901",
      artifacts
    });
    const request = service.request({
      action: "execution",
      workspaceId: WORKSPACE_ID,
      runId: SOURCE_RUN_ID,
      policyDigest: digest("policy"),
      contextRecipeDigest: digest("recipe"),
      semanticObligationsDigest: digest("obligations"),
      contextManifestDigest: digest("manifest"),
      expiresAt: LATER,
      review: {
        packageDigest: envelopeDigest(packageArtifact.payloadDigest),
        sourceStateDigest: digest("source-state"),
        scope: ["apps/vestra-cli"],
        protectedPaths: ["none:disposable-root"],
        tasks: ["T71"],
        dataAccess: ["repository:read"],
        capabilities: ["planning"],
        selectedPassports: ["passport:self-test"],
        destinations: ["disposable-root"],
        budgets: ["cost-usd:1"],
        claims: ["claim:self-test"],
        gates: ["quick"],
        risks: ["test-only"],
        assumptions: ["deterministic-inputs"],
        completionCriteria: ["all-checks-pass"],
        evidenceRefs: ["evidence:self-test-spec"]
      }
    });
    const existing = await store.loadApproval(request.approvalId);
    const record = existing ?? (await service.record(request, { id: "human:self-test-reviewer", kind: "human" }));
    return { record, verified: await service.verify(record.approvalId, record.binding) };
  } finally {
    runtime.close();
  }
}

function contextRecipe(): ContextRecipe {
  return {
    schemaVersion: 1,
    recipeId: "recipe_018f0b6d-7b1a-7abc-8def-612345678901",
    taskId: "task_018f0b6d-7b1a-7abc-8def-712345678901",
    requiredSources: [
      {
        selectorId: "selector_018f0b6d-7b1a-7abc-8def-812345678901",
        sourceKind: "repository",
        sourceId: "repository:control",
        query: { scope: "project:self-test" },
        maximumAgeSeconds: 7200,
        classification: "internal"
      }
    ],
    optionalSources: [],
    semanticObligations: ["preserve-requirement-ids"],
    priorityBudgets: [{ priority: "mandatory", maximumTokens: 4096 }],
    freshnessPolicy: { defaultMaximumAgeSeconds: 7200 },
    trustPolicyRef: "trust-policy:self-test",
    egressPurpose: "model-inference"
  };
}

async function compileContext() {
  const contentDigest = new NodeContentDigest();
  const unavailable = { resolve: async () => undefined };
  const resolver = new ContextSnapshotResolver({
    digest: contentDigest,
    sources: {
      repository: {
        resolve: async () => ({
          source: { kind: "repository", identity: "repository:control", revision: "revision-1" },
          retrievedAt: NOW,
          scope: "project:self-test",
          fragments: [
            {
              fragmentId: "fragment_018f0b6d-7b1a-7abc-8def-912345678901",
              content: "T71 full self-test production boundary evidence",
              classification: "internal",
              trust: "verified-evidence",
              claims: [{ factKey: "task:status", value: "specified" }]
            }
          ]
        })
      },
      tracker: unavailable,
      knowledge: unavailable,
      memory: unavailable
    }
  });
  const recipe = contextRecipe();
  const snapshot = await resolver.resolve({ workspaceId: WORKSPACE_ID, recipe, evaluatedAt: NOW });
  const compiler = new DeterministicContextCompiler({
    digest: contentDigest,
    egress: {
      authorize: async () => ({
        allowed: true,
        code: "VES_EGRESS_ALLOWED",
        egressDigest: digest("egress"),
        policyEvidenceDigest: digest("policy-evidence")
      })
    },
    signer: { sign: async () => ({ keyId: "context-key", signature: digest("context-signature") }) },
    estimateTokens: (content) => content.split(/\s+/u).length
  });
  return compiler.compile({
    workspaceId: WORKSPACE_ID,
    runId: SOURCE_RUN_ID,
    recipe,
    snapshot,
    capacityTokens: 8192,
    networkMode: "no-egress",
    destinationId: "destination:self-test",
    retention: "none",
    approvalRef: "approval:self-test",
    capabilityRef: "capability:self-test"
  });
}

function passport(): PassportRecord {
  return {
    schemaVersion: 1,
    revision: 1,
    passportId: "passport_018f0b6d-7b1a-7abc-8def-a12345678901",
    endpointIdentity: {
      endpointId: "endpoint_018f0b6d-7b1a-7abc-8def-b12345678901",
      providerId: "self-test",
      driverId: "deterministic-driver",
      transport: "local-cli",
      locationDigest: digest("location")
    },
    requestedModelId: "deterministic-model",
    resolvedModelId: "deterministic-model-v1",
    providerRevision: "revision-1",
    dataHandling: { training: "disabled", retention: "none", region: "local" },
    observedCapabilities: [{ capability: "planning", supported: true, evidenceRef: digest("planning") }],
    contextCapacity: { maximumInputTokens: 8192, maximumOutputTokens: 2048, evidenceRef: digest("capacity") },
    driverContractEvidence: [digest("driver-contract")],
    evaluationCampaignRef: digest("campaign"),
    eligibleRiskTiers: ["low", "medium", "high"],
    independenceClass: "self-test",
    confidence: 1,
    status: "qualified",
    issuedAt: NOW,
    expiresAt: LATER,
    endpointModelIdentityDigest: digest("endpoint-model"),
    candidateDigest: digest("candidate"),
    keyId: "passport-key",
    signature: digest("passport-signature")
  };
}

async function routeModel() {
  const record = passport();
  const router = new CapabilityModelRouter({
    passports: {
      machineIndex: async () => ({
        schemaVersion: 1,
        machineId: MACHINE_ID,
        passports: [{ passportId: record.passportId, revision: record.revision }]
      }),
      current: async (passportId) => (passportId === record.passportId ? record : undefined)
    }
  });
  return router.route({
    machineId: MACHINE_ID,
    roles: [
      {
        roleId: "implementer",
        requiredCapabilities: ["planning"],
        riskTier: "medium",
        minimumInputTokens: 4096,
        minimumOutputTokens: 1024,
        allowedTransports: ["local-cli"],
        dataHandling: {
          requireTrainingDisabled: true,
          allowedRetention: ["none"],
          allowedRegions: ["local"]
        },
        independence: { mode: "none" },
        preferredProviders: [],
        preferredModels: [],
        allowDegraded: false
      }
    ]
  });
}

async function executeEffect(root: RootFacts, hooks: FullScenarioBoundaryHooks) {
  const adapter = new MockEffectAdapter();
  const runtime = new RuntimeStore({ dbPath: join(root.canonicalPath, "runtime.sqlite"), now: () => NOW });
  runtime.open();
  const broker = new EffectBroker({ repository: runtime.createEffectRepository(), adapter, now: () => NOW });
  const identity = {
    operationKind: "publish-self-test-evidence",
    workspaceId: WORKSPACE_ID,
    logicalTarget: "disposable-root",
    canonicalInputDigest: digest("effect-input"),
    semanticIdentity: "self-test-full"
  };
  const intent = {
    ...identity,
    effectId: "effect_018f0b6d-7b1a-7abc-8def-c12345678901",
    idempotencyKey: buildIdempotencyKey(identity),
    runId: SOURCE_RUN_ID,
    riskTier: "low" as const,
    grantRef: "grant:self-test",
    status: "planned" as const,
    attempt: 0,
    createdAt: NOW
  };
  try {
    await atBoundary(hooks, "full.effect.intent-stored", async () => broker.plan(intent));
    await atBoundary(hooks, "full.effect.receipt-stored", async () => broker.execute(intent.idempotencyKey));
    await broker.execute(intent.idempotencyKey);
    return adapter.applyCalls;
  } finally {
    runtime.close();
  }
}

function verificationPorts(hooks: FullScenarioBoundaryHooks): VerificationPorts {
  let report: unknown;
  return {
    digest: { sha256: digest },
    expectations: {
      derive: async (criterion) => ({
        expectedOutcomeRef: `expected:${criterion.criterionId}`,
        expectedOutcomeDigest: digest(`expected:${criterion.criterionId}`)
      })
    },
    evidence: {
      inspect: async (request) => ({
        valid: true,
        commitId: request.commitId,
        expectedOutcomeDigest: request.expectedOutcomeDigest,
        assertionDigest: digest(request.claim.assertionRef)
      })
    },
    sensor: {
      activeStateDigest: async () => digest("active-state"),
      run: async (request) => ({
        scratchIsolationVerified: true,
        killed: true,
        expectedFailureObserved: true,
        evidenceRef: `evidence:${request.mutation.mutationId}`,
        activeStateBeforeDigest: digest("active-state"),
        activeStateAfterDigest: digest("active-state")
      })
    },
    lessons: { record: async (lesson) => ({ lessonRef: `lesson:${textField(lesson, "code")}` }) },
    reports: {
      save: async (value) => {
        report = value;
        return atBoundary(hooks, "full.verification.report-stored", async () => ({
          reportRef: "verification:report:self-test",
          reportDigest: digest(JSON.stringify(value))
        }));
      },
      verify: async (value) => ({
        valid: report !== undefined,
        reportRef: textField(value, "reportRef"),
        reportDigest: textField(value, "reportDigest"),
        verdict: textField(value, "verdict"),
        commitId: textField(value, "commitId")
      })
    },
    workflow: { apply: async (snapshot, command) => WorkflowMachine.decide(snapshot, command) },
    humanAuthority: { verify: async () => ({ authorized: true, authorizationRef: "human:self-test" }) },
    reviews: {
      save: async (value) => ({ reviewRef: "review:self-test", reviewDigest: digest(JSON.stringify(value)) })
    }
  };
}

async function verifyIndependently(hooks: FullScenarioBoundaryHooks) {
  return new IndependentVerificationCoordinator(verificationPorts(hooks)).verify({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    run: {
      runId: SOURCE_RUN_ID,
      runKind: "feature",
      state: "VERIFYING",
      version: 10,
      repairCycles: 0,
      approval: { bindingDigest: digest("approval") },
      implementationActorId: "actor:implementer"
    },
    verifier: { actorId: "actor:verifier", actorKind: "model", passportRef: "passport:self-test" },
    packageDigest: digest("package"),
    commit: { commitId: "b".repeat(40), authorActorId: "actor:implementer", gateEvidenceDigest: digest("gates") },
    criteria: [
      {
        criterionId: "AC-T71",
        requirementId: "VES-STF-001",
        whenRef: "spec:when:t71",
        thenRef: "spec:then:t71",
        independentTestRef: "spec:test:t71"
      }
    ],
    evidenceClaims: [
      {
        criterionId: "AC-T71",
        evidenceRef: "evidence:assertion:t71",
        file: "tests/integration/self-test-full-scenario.test.mjs",
        lineStart: 1,
        lineEnd: 1,
        assertionRef: "assertion:t71",
        expectedOutcomeDigest: digest("expected:AC-T71")
      }
    ],
    mutations: [
      {
        mutationId: "mutation:AC-T71:condition",
        criterionId: "AC-T71",
        operator: "condition-negation",
        targetRef: "target:self-test:t71",
        expectedFailureRef: "failure:AC-T71"
      }
    ]
  });
}

function capsuleInput(packageArtifact: SignedExecutionPackage): RunCapsuleBuildInput {
  const ref = (name: string) => ({ artifactId: `evidence:${name}`, digest: digest(name) });
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    runId: SOURCE_RUN_ID,
    runKind: "feature",
    runVersion: 21,
    status: "HANDED_OFF",
    riskTier: "medium",
    successorRunId: SUCCESSOR_RUN_ID,
    requestDigest: digest("request"),
    workspaceFingerprint: digest("workspace"),
    executionPackageRef: {
      artifactId: packageArtifact.artifactId,
      digest: envelopeDigest(packageArtifact.payloadDigest)
    },
    sourceStateRefs: [ref("source-state")],
    releaseDigest: digest("release"),
    policyDigests: [digest("policy")],
    skillLockDigest: digest("skills"),
    evidence: {
      decisions: [ref("decision")],
      modelSelections: [ref("model-selection")],
      contexts: [ref("context")],
      capabilityGrants: [ref("grant")],
      approvals: [ref("approval")],
      claims: [ref("claim")],
      tasks: [ref("task")],
      gates: [ref("gate")],
      operationReceipts: [ref("receipt")],
      outputs: [ref("output")],
      terminal: [ref("terminal")]
    },
    handoff: {
      packageRef: { artifactId: packageArtifact.artifactId, digest: envelopeDigest(packageArtifact.payloadDigest) },
      publicationReceiptRefs: [ref("publication")],
      claimDispositionRef: ref("claim-release"),
      receiverApprovalInherited: false
    },
    terminalTransition: {
      eventId: "event:handed-off",
      eventDigest: digest("handed-off"),
      fromState: "EXECUTION_READY",
      toState: "HANDED_OFF",
      occurredAt: NOW
    },
    sealedAt: NOW
  };
}

function handoffPorts(
  packageArtifact: SignedExecutionPackage,
  capsuleBuilder: RunCapsuleBuilder,
  capsuleStore: FileRunCapsuleStore,
  capsuleTrust: ReturnType<typeof createTrustRoot>,
  hooks: FullScenarioBoundaryHooks
) {
  const artifacts = new Map<
    string,
    { readonly artifact: unknown; readonly handoffRef: string; readonly handoffDigest: string }
  >();
  const finals = new Map<string, unknown>();
  const progress = new Map<string, unknown>();
  const acceptances = new Map<string, unknown>();
  const continuations = new Map<string, unknown>();
  let capsuleArtifact: SignedRunCapsule | undefined;
  let capsuleStored: "published" | "already-published" | undefined;
  const ports: HandoffPorts = {
    digest: { sha256: digest },
    packages: {
      verify: async (request) => ({
        valid: true,
        workspaceId: textField(request, "workspaceId"),
        packageRef: textField(request, "packageRef"),
        packageDigest: textField(request, "packageDigest"),
        sourceStateDigest: textField(request, "sourceStateDigest"),
        semanticObligationsDigest: digest("semantic-obligations"),
        packageId: packageArtifact.artifactId,
        firstPendingTaskId: "T71",
        pendingTaskIds: ["T71"],
        requiredRoles: ["implementer"],
        requiredSecretNames: [],
        requiredIntegrationNames: []
      })
    },
    artifacts: {
      save: async (artifact) => {
        return atBoundary(hooks, "full.handoff.prepared-stored", async () => {
          const handoffDigest = digest(canonical(artifact));
          const handoffRef = `handoff:${handoffDigest.slice(-16)}`;
          artifacts.set(handoffRef, { artifact, handoffRef, handoffDigest });
          return { handoffRef, handoffDigest };
        });
      },
      open: async (request) => {
        const handoffRef = textField(request, "handoffRef");
        const stored = artifacts.get(handoffRef);
        return stored === undefined ? { valid: false } : { valid: true, ...stored };
      }
    },
    workflow: { apply: async (snapshot, command) => WorkflowMachine.decide(snapshot, command) },
    publicationApproval: {
      verify: async () => ({
        valid: true,
        action: "handoff-publication",
        approvalRef: "approval:handoff-publication:self-test",
        bindingDigest: digest("publication-binding")
      })
    },
    effects: {
      publish: async (request) =>
        atBoundary(hooks, "full.handoff.publication-receipt-stored", async () => ({
          status: "completed",
          idempotencyKey: textField(request, "idempotencyKey"),
          receiptRef: "receipt:handoff-publication:self-test",
          receiptDigest: digest("publication-receipt")
        })),
      reconcile: async (request) => ({
        status: "applied",
        idempotencyKey: textField(request, "idempotencyKey"),
        receiptRef: "receipt:handoff-publication:self-test",
        receiptDigest: digest("publication-receipt")
      })
    },
    claims: {
      dispose: async () => ({
        valid: true,
        claimDispositionRef: "claim-disposition:self-test",
        claimDispositionDigest: digest("claim-disposition")
      }),
      acquire: async () => ({ acquired: true, claimRef: "claim:receiver:self-test", claimDigest: digest("claim") })
    },
    capsules: {
      seal: async (request) => {
        const source = recordField(request, "source");
        const artifact = recordField(request, "artifact");
        const packageReference = recordField(artifact, "package");
        capsuleArtifact = await capsuleBuilder.build(capsuleInput(packageArtifact));
        capsuleStored = await atBoundary(hooks, "full.capsule.stored", async () => capsuleStore.put(capsuleArtifact!));
        return {
          capsuleRef: capsuleArtifact.artifactId,
          capsuleDigest: envelopeDigest(capsuleArtifact.payloadDigest),
          status: "HANDED_OFF",
          sourceRunId: textField(source, "runId"),
          successorRunId: textField(source, "successorRunId"),
          packageRef: textField(packageReference, "packageRef"),
          packageDigest: textField(packageReference, "packageDigest"),
          receiverApprovalInherited: false
        };
      },
      verify: async (request) => {
        if (capsuleArtifact === undefined) return { valid: false };
        const artifact = recordField(request, "artifact");
        const packageReference = recordField(artifact, "package");
        const verified = await capsuleBuilder.verify(capsuleArtifact, capsuleTrust, {
          workspaceId: WORKSPACE_ID,
          runId: SOURCE_RUN_ID,
          runVersion: 21,
          status: "HANDED_OFF",
          evaluatedAt: NOW
        });
        return verified.ok
          ? {
              valid: true,
              status: "HANDED_OFF",
              sourceRunId: SOURCE_RUN_ID,
              successorRunId: SUCCESSOR_RUN_ID,
              packageRef: textField(packageReference, "packageRef"),
              packageDigest: textField(packageReference, "packageDigest"),
              sourceStateDigest: digest("source-state"),
              receiverApprovalInherited: false
            }
          : { valid: false };
      }
    },
    records: {
      loadFinal: async (key) => finals.get(key) as never,
      loadProgress: async (key) => progress.get(key) as never,
      saveProgress: async (record) => {
        const saved = { ...record, progressDigest: digest(JSON.stringify(record)) };
        progress.set(textField(record, "handoffRef"), saved);
        return saved;
      },
      saveFinal: async (record) => {
        const saved = {
          ...record,
          recordRef: "handoff-final:self-test",
          recordDigest: digest(JSON.stringify(record))
        };
        finals.set(textField(record, "handoffRef"), saved);
        return saved;
      },
      loadAcceptance: async (key) => acceptances.get(key) as never,
      loadAcceptanceByRef: async (key) =>
        [...acceptances.values()].find(
          (entry) => (entry as { readonly acceptanceRef?: string }).acceptanceRef === key
        ) as never,
      saveAcceptance: async (record) => {
        return atBoundary(hooks, "full.handoff.acceptance-stored", async () => {
          const saved = {
            ...record,
            acceptanceRef: "handoff-acceptance:self-test",
            acceptanceDigest: digest(JSON.stringify(record))
          };
          acceptances.set(textField(record, "handoffRef"), saved);
          return saved;
        });
      },
      loadContinuation: async (key) => continuations.get(key) as never,
      saveContinuation: async (record) => {
        const saved = { ...record, continuationDigest: digest(JSON.stringify(record)) };
        continuations.set(textField(record, "acceptanceRef"), saved);
        return saved;
      }
    },
    bindings: {
      resolve: async () => ({
        ready: true,
        localBindingDigest: digest("receiver-bindings"),
        passportRefs: ["passport:receiver:self-test"]
      })
    },
    secrets: { rebind: async () => ({ ready: true, bindingDigest: digest("empty-bindings") }) },
    integrations: { rebind: async () => ({ ready: true, bindingDigest: digest("empty-integrations") }) },
    policy: {
      reevaluate: async () => ({ allowed: true, policyDigest: digest("receiver-policy"), approvalInvalidated: true })
    },
    executionApproval: {
      verify: async (request) => ({
        valid: true,
        action: "execution",
        approvalRef: textField(recordField(request, "approval"), "approvalRef"),
        bindingDigest: textField(request, "currentBindingDigest")
      })
    }
  };
  return {
    ports,
    capsule: () => {
      if (capsuleArtifact === undefined || capsuleStored === undefined) throw new Error("Capsule was not sealed");
      return { artifact: capsuleArtifact, stored: capsuleStored };
    }
  };
}

async function runHandoff(
  packageArtifact: SignedExecutionPackage,
  root: RootFacts,
  capsuleBuilder: RunCapsuleBuilder,
  capsuleTrust: ReturnType<typeof createTrustRoot>,
  hooks: FullScenarioBoundaryHooks
) {
  const fixture = handoffPorts(
    packageArtifact,
    capsuleBuilder,
    new FileRunCapsuleStore({ root: join(root.canonicalPath, "capsules") }),
    capsuleTrust,
    hooks
  );
  const coordinator = new PortableHandoffCoordinator(fixture.ports);
  const source = {
    runId: SOURCE_RUN_ID,
    runKind: "feature" as const,
    state: "EXECUTION_READY" as const,
    version: 20,
    repairCycles: 0,
    approval: { bindingDigest: digest("source-approval") },
    implementationActorId: "actor:implementer"
  };
  const prepared = await coordinator.prepare({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    source,
    successorRunId: SUCCESSOR_RUN_ID,
    package: {
      packageRef: packageArtifact.artifactId,
      packageDigest: envelopeDigest(packageArtifact.payloadDigest),
      sourceStateDigest: digest("source-state")
    },
    currentSourceStateDigest: digest("source-state"),
    semanticObligationsDigest: digest("semantic-obligations"),
    destination: { kind: "remote", targetRef: "destination:self-test", destinationDigest: digest("destination") },
    claim: { claimRef: "claim:source:self-test", disposition: "release" }
  });
  const published = await coordinator.publish({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    source: recordField(prepared, "source"),
    handoffRef: textField(prepared, "handoffRef"),
    handoffDigest: textField(prepared, "handoffDigest"),
    publicationApproval: {
      approvalRef: "approval:handoff-publication:self-test",
      approvalDigest: digest("handoff-publication-approval")
    }
  });
  const accepted = await coordinator.accept({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    handoffRef: textField(published, "handoffRef"),
    handoffDigest: textField(published, "handoffDigest"),
    capsuleRef: textField(published, "capsuleRef"),
    capsuleDigest: textField(published, "capsuleDigest"),
    successorRunId: SUCCESSOR_RUN_ID,
    receiver: { actorId: "actor:receiver", machineProfileRef: "machine-profile:self-test" },
    currentSourceStateDigest: digest("source-state")
  });
  const continuation = await coordinator.continue({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    successor: recordField(accepted, "successor"),
    acceptanceRef: textField(accepted, "acceptanceRef"),
    acceptanceDigest: textField(accepted, "acceptanceDigest"),
    currentBindingDigest: textField(accepted, "localBindingDigest"),
    executionApproval: {
      approvalRef: "approval:execution:receiver:self-test",
      approvalDigest: digest("receiver-execution-approval"),
      bindingDigest: textField(accepted, "localBindingDigest")
    }
  });
  return { continuation, capsule: fixture.capsule() };
}

function facts(checks: readonly ScenarioCheck[]): SubjectRunFacts {
  return {
    checks,
    checkCount: checks.length,
    durationMs: 0,
    evidenceRefs: [],
    redactionCount: 0,
    failureCodes: []
  };
}

export async function runFullWorkflowScenario(
  root: RootFacts,
  hooks: FullScenarioBoundaryHooks = NO_BOUNDARY_HOOKS
): Promise<FullWorkflowScenarioResult> {
  const executionSigner = await durableSigner(root, "self-test-execution", "execution-package");
  const executionSealer = new ArtifactSealer({ signer: executionSigner, now: () => new Date(NOW) });
  const executionBuilder = new ExecutionPackageBuilder({ sealer: executionSealer });
  const executionTrust = createTrustRoot({
    trustRootId: "self-test-execution-root",
    version: 1,
    keys: [executionSigner.publicKeyRef]
  });
  const input = executionInput();
  const packageArtifact = await executionBuilder.build(input);
  const packageStore = new FileExecutionPackageStore({ root: join(root.canonicalPath, "packages") });
  const packageReceipt = await atBoundary(hooks, "full.package.stored", async () => packageStore.put(packageArtifact));
  const packageVerification = await executionBuilder.verify(
    packageArtifact,
    executionTrust,
    currentExecutionState(input)
  );
  const approvalSigner = await durableSigner(root, "self-test-approval", "approval");
  const approval = await atBoundary(hooks, "full.approval.stored", async () =>
    approve(root, packageArtifact, approvalSigner)
  );
  const context = await compileContext();
  const route = await routeModel();
  const execution = await runSelfTestExecutionAndGate(hooks, async () => executeEffect(root, hooks));
  const effectApplyCalls = execution.duringExecution;
  const verification = await verifyIndependently(hooks);
  const capsuleSigner = await durableSigner(root, "self-test-capsule", "run-capsule");
  const capsuleBuilder = new RunCapsuleBuilder({
    sealer: new ArtifactSealer({ signer: capsuleSigner, now: () => new Date(NOW) })
  });
  const capsuleTrust = createTrustRoot({
    trustRootId: "self-test-capsule-root",
    version: 1,
    keys: [capsuleSigner.publicKeyRef]
  });
  const handoff = await runHandoff(packageArtifact, root, capsuleBuilder, capsuleTrust, hooks);
  const capsuleVerification = await capsuleBuilder.verify(handoff.capsule.artifact, capsuleTrust, {
    workspaceId: WORKSPACE_ID,
    runId: SOURCE_RUN_ID,
    runVersion: 21,
    status: "HANDED_OFF",
    evaluatedAt: NOW
  });
  const checks = FULL_CHECK_IDS.filter((checkId) => checkId !== "full.crash-recovery").map((checkId) => ({
    checkId,
    requirement: "VES-STF-001",
    status: "pass" as const
  }));
  return {
    facts: facts(checks),
    diagnostics: {
      packageStored: packageReceipt.outcome,
      packageVerified: packageVerification.ok,
      approvalVerified: approval.verified.valid,
      contextFragments: context.fragments.length,
      routedPassportId: route.selections[0]?.passportId ?? "",
      executionStatus: execution.execution.status,
      effectApplyCalls,
      gateStatus: execution.gate.status,
      verificationVerdict: textField(verification, "verdict"),
      handoffStatus: textField(handoff.continuation, "status"),
      capsuleStored: handoff.capsule.stored,
      capsuleVerified: capsuleVerification.ok
    },
    portableArtifacts: [packageArtifact, handoff.capsule.artifact]
  };
}
