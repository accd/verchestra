import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  ApprovalService,
  assertNoToolRequests,
  assertReadOnlyGrant,
  assertFullWorkflowFacts,
  fullWorkflowChecks,
  IndependentVerificationCoordinator,
  PortableHandoffCoordinator,
  resolveVerifierDriver,
  type ApprovalArtifactPort,
  type DurableOutcomeFact,
  type HandoffPorts,
  type FullDurableBoundaryId,
  type FullWorkflowFacts,
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
import {
  ClaudeCodeDriver,
  CodexDriver,
  type Driver,
  type DriverEvent,
  type DriverStartRequest
} from "@verchestra/drivers";
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
import { FileRecordStore } from "@verchestra/self-test";

import { runSelfTestExecutionAndGate } from "./self-test-full-execution.ts";

const NOW = "2026-07-15T15:00:00.000Z";
const LATER = "2026-07-15T16:00:00.000Z";
const WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
const SOURCE_RUN_ID = "run_018f0b6d-7b1a-7abc-8def-112345678901";
const SUCCESSOR_RUN_ID = "run_018f0b6d-7b1a-7abc-8def-212345678901";
const MACHINE_ID = "machine_018f0b6d-7b1a-7abc-8def-312345678901";
// #35 / AD-011. These used to be two invented string constants fed straight
// into the verification input, so `assertIndependentVerifier` passed because
// the strings differed — not because two drivers existed, and the sealed
// report recorded a driver binding nobody had probed.
//
// They are now resolved from real driver instances: each is probed, the facts
// go through `resolveVerifierDriver`, and the ids it returns are what the
// report binds. The drivers are the same fake-backed ones the `drivers` profile
// composes, so this needs no provider install and stays hermetic — what is real
// here is the *resolution*, which is what the acceptance bar is about.
const FAKE_DRIVER_PATH = fileURLToPath(new URL("./self-test-driver-fake.mjs", import.meta.url));

export interface SelfTestDriverBinding {
  readonly implementerDriverId: string;
  readonly verifierDriverId: string;
}

/**
 * Turn probe facts into the binding the sealed report records.
 *
 * Pure and exported so the refusal paths are testable without spawning
 * anything — the same reason `resolveVerifierDriver` is pure. An unavailable
 * driver must never be attributed to: a missing provider is `not configured`,
 * never a silently invented identity.
 */
export function deriveDriverBinding(
  facts: readonly { readonly driverId: string; readonly available: boolean }[]
): SelfTestDriverBinding {
  const implementer = facts.find((fact) => fact.available);
  if (implementer === undefined) {
    throw new Error("Self-Test full profile found no available driver to attribute the implementation to");
  }
  const verifier = resolveVerifierDriver(facts, implementer.driverId);
  if (verifier.status !== "resolved") {
    throw new Error("Self-Test full profile found no second driver able to verify independently");
  }
  return { implementerDriverId: implementer.driverId, verifierDriverId: verifier.driverId };
}

export interface SelfTestDriverCommands {
  readonly claude: readonly string[];
  readonly codex: readonly string[];
}

const DEFAULT_DRIVER_COMMANDS: SelfTestDriverCommands = Object.freeze({
  claude: Object.freeze([process.execPath, FAKE_DRIVER_PATH, "claude"]),
  codex: Object.freeze([process.execPath, FAKE_DRIVER_PATH, "codex"])
});

/**
 * Probe the composed drivers and derive the binding the report will record.
 *
 * `commands` is injectable so a test can point a driver at something that is
 * not there and prove the composition root refuses. Without that seam the wiring
 * between `probe.available` and the binding is untestable — the logic could be
 * right while the cable feeding it was not, and a mutation making every driver
 * look available would survive every test.
 */
export async function resolveDriverBinding(
  commands: SelfTestDriverCommands = DEFAULT_DRIVER_COMMANDS
): Promise<SelfTestDriverBinding> {
  const probeOnly = async () => {
    throw new Error("probe only");
  };
  const probes = await Promise.all([
    new ClaudeCodeDriver({
      command: [...commands.claude],
      minimumVersion: "2.1.168",
      resolveExecution: probeOnly
    }).probe(),
    new CodexDriver({ command: [...commands.codex], minimumVersion: "0.115.0", resolveExecution: probeOnly }).probe()
  ]);
  return deriveDriverBinding(
    probes.map((probe) => ({ driverId: probe.driverId, available: probe.available === true }))
  );
}

interface VerifierSessionEvidence {
  readonly closed: true;
  readonly driverId: string;
  readonly grantedToolCount: 0;
  readonly outcome: "completed";
  readonly requestedToolCount: 0;
}

function verifierStartRequest(): DriverStartRequest {
  return {
    workspaceId: WORKSPACE_ID,
    runId: SOURCE_RUN_ID,
    passportRef: { passportId: "passport_018f0b6d-7b1a-7abc-8def-0123456789ab", revision: 1 },
    serializedContextRef: { manifestId: digest("verification-context"), target: "verifier" },
    tools: []
  };
}

function verifierDriver(driverId: string, request: DriverStartRequest): Driver {
  if (driverId === "claude-code") {
    return new ClaudeCodeDriver({
      command: [...DEFAULT_DRIVER_COMMANDS.claude],
      minimumVersion: "2.1.168",
      resolveExecution: async () => ({
        passport: {
          passportId: request.passportRef.passportId,
          revision: request.passportRef.revision,
          provider: "anthropic",
          resolvedModel: "claude-opus-4-8"
        },
        prompt: "Read the deterministic verification context.",
        model: "claude-opus-4-8",
        environment: { VERCHESTRA_SELF_TEST_FAKE: "claude" },
        sensitiveValues: []
      })
    });
  }
  if (driverId === "codex") {
    return new CodexDriver({
      command: [...DEFAULT_DRIVER_COMMANDS.codex],
      minimumVersion: "0.115.0",
      resolveExecution: async () => ({
        passport: {
          passportId: request.passportRef.passportId,
          revision: request.passportRef.revision,
          provider: "openai",
          resolvedModel: "gpt-5.5-codex"
        },
        prompt: "Read the deterministic verification context.",
        model: "gpt-5.5-codex",
        tools: [],
        environment: { VERCHESTRA_SELF_TEST_FAKE: "codex" },
        sensitiveValues: [],
        cancelGraceMs: 50
      })
    });
  }
  throw new Error(`Self-Test has no composed verifier driver for ${driverId}`);
}

async function runVerifierDriverSession(binding: SelfTestDriverBinding): Promise<VerifierSessionEvidence> {
  const request = verifierStartRequest();
  assertReadOnlyGrant(request.tools);
  const events: DriverEvent[] = [];
  const driver = verifierDriver(binding.verifierDriverId, request);
  const session = await driver.start(request, (event) => events.push(event), new AbortController().signal);
  const closed = await driver.close(session);
  assertNoToolRequests(events);
  if (closed["closed"] !== true || closed["outcome"] !== "completed")
    throw new Error("Self-Test verifier driver did not complete its isolated session");
  return Object.freeze({
    closed: true,
    driverId: binding.verifierDriverId,
    grantedToolCount: 0,
    outcome: "completed",
    requestedToolCount: 0
  });
}
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

function durableOutcome(
  boundaryId: FullDurableBoundaryId,
  logicalId: string,
  value: unknown,
  resultStatus: string,
  resultDigest: ShaDigest = digest(canonical(value))
): DurableOutcomeFact {
  return Object.freeze({
    boundaryId,
    logicalId,
    logicalResultCount: value === undefined ? 0 : 1,
    resultDigest,
    resultStatus
  });
}

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

type ScenarioDiagnostics = FullWorkflowFacts;

export interface FullWorkflowScenarioResult {
  readonly facts: SubjectRunFacts;
  readonly diagnostics: ScenarioDiagnostics;
  readonly portableArtifacts: readonly [SignedExecutionPackage, SignedRunCapsule];
  readonly durableOutcomes: readonly DurableOutcomeFact[];
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
    const persisted = await store.loadApproval(record.approvalId);
    if (persisted === undefined) throw new Error("Approval was not persisted");
    return { record, persisted, verified: await service.verify(record.approvalId, record.binding) };
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
    signer: { sign: async () => ({ keyId: "context-key", signature: digest("context-signature") }) }
    // No estimateTokens: the composition root takes the qualified estimator, so
    // a product run never depends on caller injection (AD-015, TOK-04). It used
    // to inject a whitespace word count here, which disagreed with the test
    // fixture's chars/4 by roughly a quarter on the same text.
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
    const receipt = await atBoundary(hooks, "full.effect.receipt-stored", async () =>
      broker.execute(intent.idempotencyKey)
    );
    await broker.execute(intent.idempotencyKey);
    const repository = runtime.createEffectRepository();
    const persistedIntent = await repository.get(intent.idempotencyKey);
    const persistedReceipt = await repository.getReceipt(intent.idempotencyKey);
    return {
      applyCalls: receipt === undefined ? 0 : 1,
      durableOutcomes: Object.freeze([
        durableOutcome("full.effect.intent-stored", intent.idempotencyKey, persistedIntent, "COMPLETED"),
        durableOutcome(
          "full.effect.receipt-stored",
          persistedReceipt?.receiptId ?? intent.idempotencyKey,
          persistedReceipt,
          "APPLIED"
        )
      ])
    };
  } finally {
    runtime.close();
  }
}

function structurallyPortable(value: unknown): boolean {
  const forbiddenKeys = new Set([
    "absolutePath",
    "credential",
    "environment",
    "localPath",
    "providerSession",
    "secret",
    "session",
    "transcript",
    "userProfile"
  ]);
  const visit = (entry: unknown): boolean => {
    if (Array.isArray(entry)) return entry.every(visit);
    if (entry === null || typeof entry !== "object") return true;
    return Object.entries(entry).every(([key, child]) => !forbiddenKeys.has(key) && visit(child));
  };
  return visit(value);
}

function verificationPorts(hooks: FullScenarioBoundaryHooks, records: FileRecordStore): VerificationPorts {
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
        return atBoundary(hooks, "full.verification.report-stored", async () => {
          await records.save("verification:report", value);
          return {
            reportRef: "verification:report:self-test",
            reportDigest: digest(JSON.stringify(value))
          };
        });
      },
      verify: async (value) => {
        const report = await records.load("verification:report");
        return {
          valid: report !== undefined,
          reportRef: textField(value, "reportRef"),
          reportDigest: textField(value, "reportDigest"),
          verdict: textField(value, "verdict"),
          commitId: textField(value, "commitId")
        };
      }
    },
    workflow: { apply: async (snapshot, command) => WorkflowMachine.decide(snapshot, command) },
    humanAuthority: { verify: async () => ({ authorized: true, authorizationRef: "human:self-test" }) },
    reviews: {
      save: async (value) => ({ reviewRef: "review:self-test", reviewDigest: digest(JSON.stringify(value)) })
    }
  };
}

async function verifyIndependently(hooks: FullScenarioBoundaryHooks, records: FileRecordStore) {
  const driverBinding = await resolveDriverBinding();
  const verifierSession = await runVerifierDriverSession(driverBinding);
  await records.save("verification:driver-session", verifierSession);
  return new IndependentVerificationCoordinator(verificationPorts(hooks, records)).verify({
    schemaVersion: 2,
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
    implementerDriverId: driverBinding.implementerDriverId,
    verifierDriverId: driverBinding.verifierDriverId,
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
  root: RootFacts,
  capsuleBuilder: RunCapsuleBuilder,
  capsuleStore: FileRunCapsuleStore,
  capsuleTrust: ReturnType<typeof createTrustRoot>,
  hooks: FullScenarioBoundaryHooks
) {
  const records = new FileRecordStore({ root: join(root.canonicalPath, "handoff-records") });
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
          await records.save(`artifact:${handoffRef}`, { artifact, handoffRef, handoffDigest });
          return { handoffRef, handoffDigest };
        });
      },
      open: async (request) => {
        const handoffRef = textField(request, "handoffRef");
        const stored = await records.load<{
          readonly artifact: unknown;
          readonly handoffRef: string;
          readonly handoffDigest: string;
        }>(`artifact:${handoffRef}`);
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
        atBoundary(hooks, "full.handoff.publication-receipt-stored", async () =>
          records.save(`publication:${textField(request, "idempotencyKey")}`, {
            status: "completed",
            idempotencyKey: textField(request, "idempotencyKey"),
            receiptRef: "receipt:handoff-publication:self-test",
            receiptDigest: digest("publication-receipt")
          })
        ),
      reconcile: async (request) =>
        (await records.load(`publication:${textField(request, "idempotencyKey")}`)) ?? {
          status: "applied",
          idempotencyKey: textField(request, "idempotencyKey"),
          receiptRef: "receipt:handoff-publication:self-test",
          receiptDigest: digest("publication-receipt")
        }
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
        await records.save("capsule:artifact", { capsuleRef: capsuleArtifact.artifactId });
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
        const saved = await records.load<{ readonly capsuleRef: string }>("capsule:artifact");
        if (saved === undefined) return { valid: false };
        capsuleArtifact = await capsuleStore.get(saved.capsuleRef);
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
      loadFinal: async (key) => (await records.load(`final:${key}`)) as never,
      loadProgress: async (key) => (await records.load(`progress:${key}`)) as never,
      saveProgress: async (record) => {
        const saved = { ...record, progressDigest: digest(JSON.stringify(record)) };
        return records.replace(`progress:${textField(record, "handoffRef")}`, saved);
      },
      saveFinal: async (record) => {
        const saved = {
          ...record,
          recordRef: "handoff-final:self-test",
          recordDigest: digest(JSON.stringify(record))
        };
        return records.save(`final:${textField(record, "handoffRef")}`, saved);
      },
      loadAcceptance: async (key) => (await records.load(`acceptance:${key}`)) as never,
      loadAcceptanceByRef: async (key) => (await records.find("acceptanceRef", key)) as never,
      saveAcceptance: async (record) => {
        return atBoundary(hooks, "full.handoff.acceptance-stored", async () => {
          const saved = {
            ...record,
            acceptanceRef: "handoff-acceptance:self-test",
            acceptanceDigest: digest(JSON.stringify(record))
          };
          return records.save(`acceptance:${textField(record, "handoffRef")}`, saved);
        });
      },
      loadContinuation: async (key) => (await records.load(`continuation:${key}`)) as never,
      saveContinuation: async (record) => {
        const saved = { ...record, continuationDigest: digest(JSON.stringify(record)) };
        return records.replace(`continuation:${textField(record, "acceptanceRef")}`, saved);
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
    capsule: async () => {
      if (capsuleArtifact === undefined) {
        const saved = await records.load<{ readonly capsuleRef: string }>("capsule:artifact");
        if (saved === undefined) throw new Error("Capsule was not sealed");
        capsuleArtifact = await capsuleStore.get(saved.capsuleRef);
      }
      return { artifact: capsuleArtifact, stored: capsuleStored ?? "already-published" };
    },
    durableOutcomes: async (handoffRef: string, capsuleRef: string) => {
      const prepared = await records.load(`artifact:${handoffRef}`);
      const publication = await records.find<Record<string, unknown>>(
        "receiptRef",
        "receipt:handoff-publication:self-test"
      );
      const acceptance = await records.load<Record<string, unknown>>(`acceptance:${handoffRef}`);
      const capsule = await capsuleStore.get(capsuleRef);
      return Object.freeze([
        durableOutcome("full.handoff.prepared-stored", handoffRef, prepared, "STORED"),
        durableOutcome(
          "full.handoff.publication-receipt-stored",
          textField(publication ?? {}, "receiptRef"),
          publication,
          "COMPLETED"
        ),
        durableOutcome(
          "full.handoff.acceptance-stored",
          textField(acceptance ?? {}, "acceptanceRef"),
          acceptance,
          "ACCEPTED"
        ),
        durableOutcome(
          "full.capsule.stored",
          capsule.artifactId,
          capsule,
          "HANDED_OFF",
          envelopeDigest(capsule.payloadDigest)
        )
      ]);
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
    root,
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
  const capsule = await fixture.capsule();
  return {
    continuation,
    capsule,
    durableOutcomes: await fixture.durableOutcomes(textField(prepared, "handoffRef"), capsule.artifact.artifactId)
  };
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
  const records = new FileRecordStore({ root: join(root.canonicalPath, "self-test-records") });
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
  const execution = await runSelfTestExecutionAndGate(hooks, records, async () => executeEffect(root, hooks));
  const effectApplyCalls = execution.duringExecution.applyCalls;
  const verification = await verifyIndependently(hooks, records);
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
  const portableArtifacts: readonly [SignedExecutionPackage, SignedRunCapsule] = [
    packageArtifact,
    handoff.capsule.artifact
  ];
  const storedPackage = await packageStore.get(packageArtifact.artifactId);
  const verificationReport = await records.load("verification:report");
  const durableOutcomes = Object.freeze([
    durableOutcome(
      "full.package.stored",
      storedPackage.artifactId,
      storedPackage,
      "STORED",
      envelopeDigest(storedPackage.payloadDigest)
    ),
    durableOutcome(
      "full.approval.stored",
      approval.persisted.approvalId,
      approval.persisted,
      "APPROVED",
      approval.persisted.bindingDigest as ShaDigest
    ),
    execution.durableOutcomes[0],
    ...execution.duringExecution.durableOutcomes,
    execution.durableOutcomes[1],
    durableOutcome("full.verification.report-stored", "verification:report:self-test", verificationReport, "PASS"),
    ...handoff.durableOutcomes
  ]);
  const diagnostics: ScenarioDiagnostics = {
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
    capsuleVerified: capsuleVerification.ok,
    portableEvidenceValid: structurallyPortable(portableArtifacts)
  };
  assertFullWorkflowFacts(diagnostics);
  const checks = fullWorkflowChecks(diagnostics);
  return {
    facts: facts(checks),
    diagnostics,
    portableArtifacts,
    durableOutcomes
  };
}
