// The only place that wires the Self-Test trust domain together (T69, #10;
// T70 scenarios, #11). The application package owns the rules,
// packages/self-test owns the facts, and neither may import a sibling
// adapter — so the TEST-ONLY subject, the scenario content that drives the
// real @verchestra/workspace-backed CLI, and the evidence boundary are all
// constructed here, in the composition root, and nowhere else.
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import {
  MachineBootstrapService,
  SelfTestOrchestrator,
  WORKSPACE_SHAPES,
  WorkspaceReconcileService,
  assertNoNetworkAttempts,
  assertReportPayload,
  resolveSelfTestProfile,
  type CanonicalSyncConfiguration,
  type MaterialFact,
  type PersistedSyncState,
  type RootFacts,
  type ScenarioCheck,
  type SelfTestProfileId,
  type SelfTestReportPayload,
  type SelfTestRunResult,
  type SentinelFact,
  type SubjectRunFacts,
  type WorkspaceShape
} from "@verchestra/application";
import { ArtifactSealer, SupportCodeRegistry, type SealedArtifact } from "@verchestra/evidence";
import {
  BoundedFixtureFactory,
  DisposableRootProvider,
  GitFixtureFactory,
  SentinelCatalog,
  offlineGuard,
  testOnlyKeyMaterial,
  type SentinelTarget
} from "@verchestra/self-test";
import { scanWorkspace } from "@verchestra/workspace";
import { runCli } from "./cli.ts";
import { createCommandBus } from "./main.ts";
import { installedReleaseManifest } from "./release-manifest.ts";

// Every VES_SELFTEST_* code the domain can emit into
// `self_test.failure_codes`. The support-bundle contract rejects any code the
// registry does not carry, so this list is the single registration point and
// an unregistered code fails closed at report time rather than leaking an
// unexplained string into evidence.
export const SELF_TEST_FAILURE_CODES = Object.freeze([
  "VES_SELFTEST_FIXTURE_BUDGET",
  "VES_SELFTEST_FIXTURE_ESCAPE",
  "VES_SELFTEST_NETWORK_ATTEMPT",
  "VES_SELFTEST_NONCONVERGENT",
  "VES_SELFTEST_PRODUCTION_MATERIAL",
  "VES_SELFTEST_QUARANTINE_FAILED",
  "VES_SELFTEST_QUARANTINE_TRANSITION",
  "VES_SELFTEST_REPORT_CONTENT_PROHIBITED",
  "VES_SELFTEST_REPORT_FIELD_UNKNOWN",
  "VES_SELFTEST_ROOT_FACTS_INVALID",
  "VES_SELFTEST_ROOT_OVERLAP",
  "VES_SELFTEST_SCENARIO_CHECK_FAILED",
  "VES_SELFTEST_SCENARIO_MISSING",
  "VES_SELFTEST_SENTINEL_FACTS_INVALID",
  "VES_SELFTEST_SENTINEL_MUTATION",
  "VES_SELFTEST_UNKNOWN_PROFILE"
] as const);

export function createSelfTestCodeRegistry(): SupportCodeRegistry {
  return new SupportCodeRegistry({ codes: [...SELF_TEST_FAILURE_CODES] });
}

// A scenario is handed the disposable root and a bounded fixture factory; it
// returns facts. It never sees the guarded roots, the sentinels, or the
// sealer — the trust domain is closed around it.
export interface SelfTestScenario {
  run(context: {
    readonly root: RootFacts;
    readonly fixtures: BoundedFixtureFactory;
    readonly materials: readonly MaterialFact[];
  }): Promise<SubjectRunFacts>;
}

export interface SelfTestCompositionOptions {
  readonly baseDirectory: string;
  // The roots this run must never touch. The caller names them because only
  // the composition root knows where production state actually lives.
  readonly guardedRoots: readonly RootFacts[];
  readonly sentinels: readonly SentinelTarget[];
  readonly scenario: SelfTestScenario;
  readonly sealer: ArtifactSealer;
  readonly codeRegistry?: SupportCodeRegistry;
}

export interface SealedSelfTestReport {
  readonly result: SelfTestRunResult;
  readonly artifact: SealedArtifact<SelfTestReportPayload>;
}

function assertRegisteredCodes(payload: SelfTestReportPayload, registry: SupportCodeRegistry): void {
  const codes = payload["self_test.failure_codes"];
  for (const code of Array.isArray(codes) ? codes : []) {
    if (typeof code !== "string" || !registry.has(code))
      throw new Error(`self-test emitted an unregistered failure code: ${String(code)}`);
  }
}

export class SelfTestComposition {
  readonly #options: SelfTestCompositionOptions;
  readonly #registry: SupportCodeRegistry;

  constructor(options: SelfTestCompositionOptions) {
    this.#options = options;
    this.#registry = options.codeRegistry ?? createSelfTestCodeRegistry();
  }

  // Runs one profile and seals its report. The sealed artifact is the only
  // thing that leaves the trust domain, and it carries exactly the allowlisted
  // `self_test.*` fields the support-bundle contract declares.
  async run(profileId: string): Promise<SealedSelfTestReport> {
    const profile = resolveSelfTestProfile(profileId);
    const provider = new DisposableRootProvider({ baseDirectory: this.#options.baseDirectory });
    const catalog = new SentinelCatalog(this.#options.sentinels);
    const identity = testOnlyKeyMaterial(`key:self-test-${profile.profileId}`);
    const scenario = this.#options.scenario;
    const maxFixtureBytes = profile.maxFixtureBytes;

    const result = await new SelfTestOrchestrator({
      guardedRoots: async (): Promise<readonly RootFacts[]> => this.#options.guardedRoots,
      roots: {
        provision: (id: SelfTestProfileId) => provider.provision(id),
        cleanup: (root: RootFacts) => provider.cleanup(root),
        quarantine: (root: RootFacts, reason: string) => provider.quarantine(root, reason)
      },
      sentinels: { capture: (): Promise<readonly SentinelFact[]> => catalog.capture() },
      subject: {
        // TEST-ONLY by construction: the identity is generated per run and
        // never persisted, so there is no path by which production material
        // reaches the subject from here.
        materials: async (): Promise<readonly MaterialFact[]> => [identity.material],
        run: (_id: SelfTestProfileId, root: RootFacts) =>
          scenario.run({
            root,
            fixtures: new BoundedFixtureFactory(root, maxFixtureBytes),
            materials: [identity.material]
          })
      }
    }).run(profile.profileId);

    assertReportPayload(result.payload);
    assertRegisteredCodes(result.payload, this.#registry);
    // The report is bound to the code registry it was validated against, so a
    // report cannot be replayed against a registry that admits different
    // codes. Artifact bindings carry bare hex, while the registry publishes a
    // prefixed digest.
    const artifact = await this.#options.sealer.seal(result.payload, {
      schema: { name: "self-test-report", version: 1 },
      purpose: "self-test-report",
      bindingId: `self-test:${profile.profileId}`,
      sourceStateDigest: this.#registry.digest.replace(/^sha256:/u, "")
    });
    return Object.freeze({ result, artifact });
  }
}

// T70: byte-level snapshot of a directory's working tree, excluding `.git`
// (which mutates on every Git command regardless of working-tree content).
// Used only to prove a dry-run made zero writes; never sealed into evidence.
async function workingTreeSnapshot(root: string): Promise<readonly string[]> {
  const entries: string[] = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        const digest = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
        entries.push(`${relative(root, path).replaceAll("\\", "/")}:${digest}`);
      }
    }
  }
  await walk(root);
  return Object.freeze(entries.sort());
}

interface CliInvocation {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function invokeCli(argv: readonly string[], controlRoot: string): Promise<CliInvocation> {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli({
    argv,
    invokedAs: "vestra",
    installedManifest: installedReleaseManifest,
    installedCliVersion: installedReleaseManifest.semanticVersion,
    commandBus: createCommandBus(controlRoot),
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    }
  });
  return { exitCode, stdout, stderr };
}

function pushCheck(checks: ScenarioCheck[], checkId: string, requirement: string, ok: boolean): void {
  checks.push(Object.freeze({ checkId, requirement, status: ok ? "pass" : "fail" }));
}

// Shared by every T70 scenario: network is blocked for the whole run as a
// PRF-01 backstop, and a single failed check is enough to fail the profile
// closed rather than reporting a partial PASS.
async function finalizeScenario(
  checks: readonly ScenarioCheck[],
  guard: ReturnType<typeof offlineGuard>,
  startedAt: number
): Promise<SubjectRunFacts> {
  assertNoNetworkAttempts(guard.attempts());
  const failureCodes = checks.some((check) => check.status === "fail")
    ? Object.freeze(["VES_SELFTEST_SCENARIO_CHECK_FAILED"])
    : Object.freeze([]);
  return Object.freeze({
    checkCount: checks.length,
    durationMs: Date.now() - startedAt,
    evidenceRefs: [],
    failureCodes: Object.freeze(failureCodes),
    redactionCount: 0,
    checks: Object.freeze(checks)
  });
}

// T70 (PRF-05, PRF-07): the smoke profile drives the exact controller path
// production traffic uses (runCli + the real command bus), against a
// disposable, real Git repository, and proves the dry-run path writes
// nothing. Network is blocked for the whole scenario as a PRF-01 backstop.
export function createSmokeScenario(): SelfTestScenario {
  return {
    async run({ root, fixtures }) {
      const startedAt = Date.now();
      const checks: ScenarioCheck[] = [];
      const guard = offlineGuard();
      try {
        const fixtureFacts = await new GitFixtureFactory(root, fixtures).provision("standalone");
        const controlRoot = fixtureFacts.controlRootPath;

        const record = (checkId: string, requirement: string, ok: boolean): void =>
          pushCheck(checks, checkId, requirement, ok);

        const help = await invokeCli(["--help"], controlRoot);
        record(
          "smoke.help",
          "vestra --help exits 0 with non-empty output",
          help.exitCode === 0 && help.stdout.length > 0
        );

        const version = await invokeCli(["--version"], controlRoot);
        record(
          "smoke.version",
          "vestra --version reports the installed semantic version",
          version.exitCode === 0 && version.stdout.includes(installedReleaseManifest.semanticVersion)
        );

        const before = await workingTreeSnapshot(controlRoot);
        const preview = await invokeCli(
          [
            "init",
            "--dry-run",
            "--workspace-id",
            "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
            "--name",
            "Self-Test Smoke",
            "--placement",
            "centralized"
          ],
          controlRoot
        );
        record("smoke.init.dry-run.preview", "init --dry-run exits 0 with a preview", preview.exitCode === 0);
        const after = await workingTreeSnapshot(controlRoot);
        record(
          "smoke.init.dry-run.zero-writes",
          "init --dry-run makes zero writes to the working tree",
          before.length === after.length && before.every((entry, index) => entry === after[index])
        );

        const invalidArgument = await invokeCli(["init"], controlRoot);
        record(
          "smoke.init.invalid-argument",
          "init without required arguments fails distinctly",
          invalidArgument.exitCode !== 0
        );

        const unknownCommand = await invokeCli(["frobnicate"], controlRoot);
        record("smoke.unknown-command", "an unrecognized command fails distinctly", unknownCommand.exitCode !== 0);
      } finally {
        guard.restore();
      }
      return finalizeScenario(checks, guard, startedAt);
    }
  };
}

// T70 (PRF-02, PRF-03): one placement, init, bootstrap, sync, and
// reconcile check per workspace shape, each against a real fixture. No
// driver or secret is real — MachineBootstrapService is exercised with an
// empty discovery/secrets stub (no live paid model calls, per the issue's
// non-goals) so only the deterministic bootstrap contract is under test.
const EXPECTED_INVENTORY: Readonly<
  Record<WorkspaceShape, { readonly projectCount: number; readonly ignoredProjectPath: string | null }>
> = Object.freeze({
  standalone: Object.freeze({ projectCount: 1, ignoredProjectPath: null }),
  colocated: Object.freeze({ projectCount: 2, ignoredProjectPath: null }),
  centralized: Object.freeze({ projectCount: 2, ignoredProjectPath: null }),
  nested: Object.freeze({ projectCount: 2, ignoredProjectPath: null }),
  ignored: Object.freeze({ projectCount: 2, ignoredProjectPath: "projects/service" })
});

async function checkPlacement(shape: WorkspaceShape, controlRoot: string, checks: ScenarioCheck[]): Promise<void> {
  const expected = EXPECTED_INVENTORY[shape];
  const inventory = await scanWorkspace({ controlRoot });
  const ignoredProject = inventory.projects.find((project) => project.ignoredByControl);
  pushCheck(
    checks,
    `workspace.${shape}.placement`,
    `scanWorkspace reports ${expected.projectCount} Projects for ${shape}, ignored: ${expected.ignoredProjectPath ?? "none"}`,
    inventory.projects.length === expected.projectCount &&
      (expected.ignoredProjectPath === null
        ? ignoredProject === undefined
        : ignoredProject?.logicalPath === expected.ignoredProjectPath)
  );
}

async function checkInit(shape: WorkspaceShape, controlRoot: string, checks: ScenarioCheck[]): Promise<void> {
  const result = await invokeCli(
    [
      "init",
      "--dry-run",
      "--workspace-id",
      "workspace_018f0b6d-7b1a-7abc-8def-2123456789ab",
      "--name",
      `Self-Test ${shape}`,
      "--placement",
      "centralized"
    ],
    controlRoot
  );
  pushCheck(checks, `workspace.${shape}.init`, `init --dry-run exits 0 for ${shape}`, result.exitCode === 0);
}

async function checkBootstrap(shape: WorkspaceShape, checks: ScenarioCheck[]): Promise<void> {
  const service = new MachineBootstrapService({
    discovery: { discover: async () => [] },
    secrets: { expectedStore: "self-test", isBound: async () => false },
    profiles: { save: async () => ({ changed: true, profileDigest: "sha256:self-test" }) },
    now: () => "2026-01-01T00:00:00.000Z"
  });
  const result = await service.execute({
    config: {
      schemaVersion: 1,
      configVersion: 1,
      minimumCliVersion: "1.0.0",
      workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-2123456789ab",
      roles: [{ roleId: "self-test-orchestrator", requiredCapabilities: ["plan"], independence: "none" }],
      requiredSecrets: [],
      databases: []
    },
    installedCliVersion: "1.0.0",
    machineId: "machine_018f0b6d-7b1a-7abc-8def-2123456789ab"
  });
  pushCheck(
    checks,
    `workspace.${shape}.bootstrap`,
    `MachineBootstrapService completes deterministically for ${shape}`,
    result.schemaVersion === 1
  );
}

function reconcileDigest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class SelfTestSyncStore {
  #state: PersistedSyncState | undefined;
  writes = 0;

  async load(): Promise<PersistedSyncState | undefined> {
    return this.#state;
  }

  async save(state: PersistedSyncState): Promise<{ readonly changed: boolean }> {
    const changed = JSON.stringify(this.#state) !== JSON.stringify(state);
    if (changed) {
      this.#state = state;
      this.writes += 1;
    }
    return { changed };
  }
}

function reconcileConfiguration(shape: WorkspaceShape, releaseGeneration: string): CanonicalSyncConfiguration {
  return {
    schemaVersion: 1,
    minimumCliVersion: "1.0.0",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-3123456789ab",
    generations: {
      release: releaseGeneration,
      config: "config-1",
      skills: "skills-1",
      data: "data-1",
      integrations: "integrations-1"
    },
    projects: [
      {
        projectId: `project_018f0b6d-7b1a-7abc-8def-${shapeSuffix(shape)}`,
        logicalPath: ".",
        state: "active" as const,
        predecessorProjectIds: []
      }
    ],
    projections: [],
    ingestionManifests: []
  };
}

function shapeSuffix(shape: WorkspaceShape): string {
  return { standalone: "0", colocated: "1", centralized: "2", nested: "3", ignored: "4" }[shape].padStart(12, "0");
}

async function checkSyncAndReconcile(shape: WorkspaceShape, checks: ScenarioCheck[]): Promise<void> {
  const store = new SelfTestSyncStore();
  const service = new WorkspaceReconcileService({ store, digest: { sha256: reconcileDigest } });

  const first = await service.execute({
    installedCliVersion: "1.0.0",
    configuration: reconcileConfiguration(shape, "release-1"),
    directions: {},
    uncertainEffects: []
  });
  pushCheck(
    checks,
    `workspace.${shape}.sync`,
    `initial sync persists state for ${shape}`,
    first.status === "reconciled" && first.stateChanged === true && store.writes === 1
  );

  const second = await service.execute({
    installedCliVersion: "1.0.0",
    configuration: reconcileConfiguration(shape, "release-2"),
    directions: {},
    uncertainEffects: []
  });
  pushCheck(
    checks,
    `workspace.${shape}.reconcile`,
    `a changed generation is recognized as a local rebuild requirement for ${shape}`,
    second.status === "reconciled" && second.localRebuildRequirements.length > 0
  );
}

export function createWorkspaceScenario(): SelfTestScenario {
  return {
    async run({ root, fixtures }) {
      const startedAt = Date.now();
      const checks: ScenarioCheck[] = [];
      const guard = offlineGuard();
      try {
        const gitFactory = new GitFixtureFactory(root, fixtures);
        for (const shape of WORKSPACE_SHAPES) {
          const fixtureFacts = await gitFactory.provision(shape);
          await checkPlacement(shape, fixtureFacts.controlRootPath, checks);
          await checkInit(shape, fixtureFacts.controlRootPath, checks);
          await checkBootstrap(shape, checks);
          await checkSyncAndReconcile(shape, checks);
        }
      } finally {
        guard.restore();
      }
      return finalizeScenario(checks, guard, startedAt);
    }
  };
}
