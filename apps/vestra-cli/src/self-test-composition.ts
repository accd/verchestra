// The only place that wires the Self-Test trust domain together (T69, #10).
// The application package owns the rules, packages/self-test owns the facts,
// and neither may import a sibling adapter — so the TEST-ONLY subject and the
// evidence boundary are constructed here, in the composition root, and
// nowhere else.
import {
  SelfTestOrchestrator,
  assertReportPayload,
  resolveSelfTestProfile,
  type MaterialFact,
  type RootFacts,
  type SelfTestProfileId,
  type SelfTestReportPayload,
  type SelfTestRunResult,
  type SentinelFact,
  type SubjectRunFacts
} from "@verchestra/application";
import { ArtifactSealer, SupportCodeRegistry, type SealedArtifact } from "@verchestra/evidence";
import {
  BoundedFixtureFactory,
  DisposableRootProvider,
  SentinelCatalog,
  testOnlyKeyMaterial,
  type SentinelTarget
} from "@verchestra/self-test";

// Every VES_SELFTEST_* code the domain can emit into
// `self_test.failure_codes`. The support-bundle contract rejects any code the
// registry does not carry, so this list is the single registration point and
// an unregistered code fails closed at report time rather than leaking an
// unexplained string into evidence.
export const SELF_TEST_FAILURE_CODES = Object.freeze([
  "VES_SELFTEST_FIXTURE_BUDGET",
  "VES_SELFTEST_FIXTURE_ESCAPE",
  "VES_SELFTEST_PRODUCTION_MATERIAL",
  "VES_SELFTEST_QUARANTINE_FAILED",
  "VES_SELFTEST_QUARANTINE_TRANSITION",
  "VES_SELFTEST_REPORT_CONTENT_PROHIBITED",
  "VES_SELFTEST_REPORT_FIELD_UNKNOWN",
  "VES_SELFTEST_ROOT_FACTS_INVALID",
  "VES_SELFTEST_ROOT_OVERLAP",
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
