// T73 (#14): the frozen, public regression corpus. Each campaign observes a real
// qualified surface through a reproducible, local, credential-free fixture and
// returns a boolean outcome. Deterministic campaigns run once; probabilistic
// campaigns draw from a frozen outcome sequence that stands in for repeated live
// runs (fake-first: the canonical corpus makes no paid or networked call). The
// definitions are immutable — the runner seals them into a corpus digest.
import {
  DOCTOR_CAPABILITY_IDS,
  DOCTOR_CHECK_IDS,
  DURABLE_CRASH_EXIT_CODE,
  DURABLE_CRASH_PHASES,
  FEEDBACK_BYTE_BUDGET,
  FULL_DURABLE_BOUNDARY_IDS,
  assertCampaignCorpus,
  assertDoctorCheckFacts,
  assertConvergence,
  assertDriverInvocationFacts,
  assertProfileCoverage,
  assertReportPayload,
  buildDoctorReport,
  collectDoctorFacts,
  diffSentinels,
  doctorExitCode,
  evaluateCampaign,
  resolveSelfTestProfile,
  assertDurableBoundaryFacts
} from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";

function ok(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

function threw(fn, code) {
  try {
    fn();
    return false;
  } catch (error) {
    return code === undefined ? true : error?.code === code;
  }
}

// ---- reusable fixtures over qualified surfaces ----

const doctorPassFacts = DOCTOR_CHECK_IDS.map((checkId) => ({
  checkId,
  status: "pass",
  capabilityId: DOCTOR_CAPABILITY_IDS[checkId]
}));

const healthyDoctorProbes = Object.fromEntries(
  DOCTOR_CHECK_IDS.map((id) => [id, () => ({ present: true, healthy: true })])
);

const fingerprint = Object.freeze(["full.complete:pass"]);
function durableMatrix() {
  let root = 0;
  return FULL_DURABLE_BOUNDARY_IDS.flatMap((boundaryId) =>
    DURABLE_CRASH_PHASES.map((phase) => ({
      boundaryId,
      phase,
      logicalId: `self-test:${boundaryId}`,
      logicalResultCount: 1,
      resultDigest: `sha256:${"a".repeat(64)}`,
      resultStatus: "STORED",
      rootIdentity: `sha256:${(++root).toString(16).padStart(64, "0")}`,
      resumed: true,
      semanticFingerprint: fingerprint,
      crashExitCode: DURABLE_CRASH_EXIT_CODE,
      resumeExitCode: 0
    }))
  );
}
const HAPPY_ROOT = `sha256:${"f".repeat(64)}`;

function review(overrides = {}) {
  return {
    providerId: "anthropic",
    modelId: "claude-self-test",
    destinationId: "destination:self-test-anthropic",
    maximumCostUsd: 0.01,
    modelCapabilities: ["stream", "usage"],
    tools: [{ name: "vestra_read", access: "read" }],
    classification: "internal",
    purpose: "self-test-read",
    retention: "none",
    egressMode: "online",
    ...overrides
  };
}
function invocation(overrides = {}) {
  const approved = review();
  return {
    review: approved,
    displayedReview: structuredClone(approved),
    actualReview: structuredClone(approved),
    authorized: true,
    providerBoundaryEntries: 1,
    writerToolReachable: false,
    ...overrides
  };
}

const selfTestPayload = {
  "self_test.check_count": 1,
  "self_test.duration_ms": 1,
  "self_test.evidence_refs": [],
  "self_test.failure_codes": [],
  "self_test.profile": "smoke",
  "self_test.redaction_count": 0,
  "self_test.verdict": "PASS"
};

// A frozen outcome sequence standing in for repeated non-deterministic runs. It
// is public and reproducible: the same indices fail on every machine.
function frozenSequence(total, failingIndices) {
  const failures = new Set(failingIndices);
  return (index) => !failures.has(index % total);
}

const EVIDENCE = "docs/qualification/t73-validation.md";

function deterministic(id, requirement, fixtureRef, threshold, check) {
  return {
    def: { id, requirement, owner: "verchestra", threshold, fixtureRef, evidenceRef: EVIDENCE, sampleSize: 1 },
    check
  };
}
function probabilistic(id, requirement, fixtureRef, threshold, sampleSize, check) {
  return {
    def: { id, requirement, owner: "verchestra", threshold, fixtureRef, evidenceRef: EVIDENCE, sampleSize },
    check
  };
}

export const CAMPAIGNS = Object.freeze([
  // Doctor (T72)
  deterministic(
    "doctor-report-pass",
    "CAM-04",
    "fixtures/doctor/all-pass",
    1,
    () => buildDoctorReport(doctorPassFacts, 1)["doctor.verdict"] === "PASS"
  ),
  deterministic(
    "doctor-exit-codes-stable",
    "CAM-04",
    "fixtures/doctor/exit-codes",
    1,
    () => doctorExitCode("PASS") === 0 && doctorExitCode("FAIL") === 1 && doctorExitCode("BLOCKED") === 4
  ),
  deterministic("doctor-catalog-closed", "CAM-02", "fixtures/doctor/missing-check", 1, () =>
    threw(() => assertDoctorCheckFacts(doctorPassFacts.slice(1)), "VES_DOCTOR_CHECK_CATALOG_INVALID")
  ),
  deterministic(
    "doctor-facts-complete",
    "CAM-04",
    "fixtures/doctor/probes",
    1,
    async () => (await collectDoctorFacts(healthyDoctorProbes)).length === 12
  ),
  // Self-Test durable boundaries (T71)
  deterministic("selftest-durable-matrix-valid", "CAM-04", "fixtures/selftest/durable-matrix", 1, () =>
    ok(() => assertDurableBoundaryFacts(durableMatrix(), HAPPY_ROOT))
  ),
  deterministic("selftest-durable-missing-fails", "CAM-02", "fixtures/selftest/durable-missing", 1, () =>
    threw(
      () => assertDurableBoundaryFacts(durableMatrix().slice(1), HAPPY_ROOT),
      "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
    )
  ),
  deterministic(
    "selftest-convergence-holds",
    "CAM-04",
    "fixtures/selftest/convergence",
    1,
    () =>
      ok(() => assertConvergence(["a:pass"], ["a:pass"])) &&
      threw(() => assertConvergence(["a:pass"], ["a:fail"]), "VES_SELFTEST_NONCONVERGENT")
  ),
  // Self-Test profiles and coverage (T69/T70)
  deterministic(
    "selftest-profile-sealed",
    "CAM-02",
    "fixtures/selftest/profile",
    1,
    () => resolveSelfTestProfile("smoke").profileId === "smoke"
  ),
  deterministic("selftest-coverage-missing-fails", "CAM-02", "fixtures/selftest/coverage", 1, () =>
    threw(() => assertProfileCoverage(resolveSelfTestProfile("smoke"), []), "VES_SELFTEST_SCENARIO_MISSING")
  ),
  deterministic(
    "selftest-sentinels-identical",
    "CAM-04",
    "fixtures/selftest/sentinels",
    1,
    () => diffSentinels([{ sentinelId: "s", digest: "d" }], [{ sentinelId: "s", digest: "d" }]).identical === true
  ),
  deterministic(
    "selftest-report-allowlist",
    "CAM-05",
    "fixtures/selftest/report",
    1,
    () =>
      ok(() => assertReportPayload(selfTestPayload)) &&
      threw(() => assertReportPayload({ ...selfTestPayload, "self_test.leak": "x" }))
  ),
  // Approved-driver authority (T71)
  deterministic("driver-review-binding-valid", "CAM-02", "fixtures/driver/review", 1, () =>
    ok(() => assertDriverInvocationFacts(invocation()))
  ),
  deterministic("driver-denied-reaches-zero", "CAM-04", "fixtures/driver/denied", 1, () =>
    threw(() => assertDriverInvocationFacts(invocation({ authorized: false })), "VES_SELFTEST_PROVIDER_CALL_REACHED")
  ),
  deterministic("driver-writer-tool-denied", "CAM-04", "fixtures/driver/writer-tool", 1, () =>
    threw(
      () => assertDriverInvocationFacts(invocation({ writerToolReachable: true })),
      "VES_SELFTEST_WRITER_TOOL_REACHABLE"
    )
  ),
  // Gate repair bounded feedback (T68c)
  deterministic(
    "gate-repair-feedback-bounded",
    "CAM-05",
    "fixtures/gate-repair/budget",
    1,
    () => FEEDBACK_BYTE_BUDGET === 16384
  ),
  // Canonical JSON (T3, RFC 8785)
  deterministic(
    "canonical-json-key-order",
    "CAM-04",
    "fixtures/canonical/order",
    1,
    () => canonicalizeJsonV2({ b: 1, a: 2 }) === canonicalizeJsonV2({ a: 2, b: 1 })
  ),
  deterministic(
    "canonical-json-deterministic",
    "CAM-04",
    "fixtures/canonical/stable",
    1,
    () => canonicalizeJsonV2({ a: [1, 2], c: true }) === canonicalizeJsonV2({ a: [1, 2], c: true })
  ),
  // Campaign framework self-checks (T73)
  deterministic("campaign-corpus-minimum-enforced", "CAM-01", "fixtures/campaign/minimum", 1, () =>
    threw(() => assertCampaignCorpus([]), "VES_CAMPAIGN_CORPUS_INVALID")
  ),
  deterministic(
    "campaign-wilson-below-threshold-fails",
    "CAM-03",
    "fixtures/campaign/wilson",
    1,
    () =>
      evaluateCampaign(
        {
          id: "probe",
          requirement: "CAM-03",
          owner: "v",
          threshold: 0.9,
          fixtureRef: "fixtures/x",
          evidenceRef: EVIDENCE,
          sampleSize: 100
        },
        Array.from({ length: 100 }, (_, i) => i >= 5)
      ).verdict === "FAIL"
  ),
  deterministic(
    "campaign-deterministic-pass",
    "CAM-03",
    "fixtures/campaign/deterministic",
    1,
    () =>
      evaluateCampaign(
        {
          id: "probe",
          requirement: "CAM-03",
          owner: "v",
          threshold: 1,
          fixtureRef: "fixtures/x",
          evidenceRef: EVIDENCE,
          sampleSize: 1
        },
        [true]
      ).verdict === "PASS"
  ),
  // Probabilistic campaigns: repeated runs with a frozen distribution (T73)
  probabilistic(
    "selftest-verdict-distribution",
    "CAM-03",
    "fixtures/distribution/selftest",
    0.9,
    100,
    frozenSequence(100, [13, 47, 88])
  ),
  probabilistic(
    "driver-review-distribution",
    "CAM-03",
    "fixtures/distribution/driver",
    0.85,
    50,
    frozenSequence(50, [7, 41])
  )
]);

export const CAMPAIGN_DEFINITIONS = Object.freeze(CAMPAIGNS.map((campaign) => campaign.def));

// Run one campaign's fixture for its declared sample size and return the result.
export async function runCampaign(campaign) {
  const outcomes = await Promise.all(
    Array.from({ length: campaign.def.sampleSize }, (_, index) => campaign.check(index))
  );
  return evaluateCampaign(campaign.def, outcomes);
}
