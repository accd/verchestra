import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DURABLE_CRASH_PHASES,
  DURABLE_CRASH_EXIT_CODE,
  DRIVER_CHECK_IDS,
  FULL_CHECK_IDS,
  FULL_DURABLE_BOUNDARY_IDS,
  assertDriverInvocationFacts,
  assertDriverScenarioFacts,
  assertDurableBoundaryFacts as assertDurableBoundaryFactsRule,
  assertFullWorkflowFacts,
  driverScenarioChecks,
  fullWorkflowChecks
} from "../../packages/application/src/index.ts";

const fingerprint = Object.freeze(["full.complete:pass"]);
const HAPPY_ROOT_IDENTITY = `sha256:${"f".repeat(64)}`;

function boundaryFacts(overrides = {}) {
  let rootIndex = 0;
  return FULL_DURABLE_BOUNDARY_IDS.flatMap((boundaryId) =>
    DURABLE_CRASH_PHASES.map((phase) => ({
      boundaryId,
      phase,
      logicalId: `self-test:${boundaryId}`,
      logicalResultCount: 1,
      resultDigest: `sha256:${"a".repeat(64)}`,
      resultStatus: "STORED",
      rootIdentity: `sha256:${(++rootIndex).toString(16).padStart(64, "0")}`,
      resumed: true,
      semanticFingerprint: fingerprint,
      crashExitCode: DURABLE_CRASH_EXIT_CODE,
      resumeExitCode: 0,
      ...overrides
    }))
  );
}

function assertDurableBoundaryFacts(facts, happyRootIdentity = HAPPY_ROOT_IDENTITY) {
  return assertDurableBoundaryFactsRule(facts, happyRootIdentity);
}

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
  const approvedReview = review();
  return {
    review: approvedReview,
    displayedReview: structuredClone(approvedReview),
    actualReview: structuredClone(approvedReview),
    authorized: true,
    providerBoundaryEntries: 1,
    writerToolReachable: false,
    ...overrides
  };
}

test("T71 registers ten full and seven driver scenario checks", () => {
  assert.equal(FULL_CHECK_IDS.length, 10);
  assert.equal(DRIVER_CHECK_IDS.length, 7);
  assert.equal(new Set([...FULL_CHECK_IDS, ...DRIVER_CHECK_IDS]).size, 17);
});

test("T71 durable boundary catalog is exact and closed", () => {
  assert.deepEqual(FULL_DURABLE_BOUNDARY_IDS, [
    "full.package.stored",
    "full.approval.stored",
    "full.execution.checkpoint-stored",
    "full.effect.intent-stored",
    "full.effect.receipt-stored",
    "full.gate.commit-stored",
    "full.verification.report-stored",
    "full.handoff.prepared-stored",
    "full.handoff.publication-receipt-stored",
    "full.handoff.acceptance-stored",
    "full.capsule.stored"
  ]);
  assert.deepEqual(DURABLE_CRASH_PHASES, ["before", "after"]);
});

test("one resumed, convergent result per boundary and phase passes", () => {
  assert.doesNotThrow(() => assertDurableBoundaryFacts(boundaryFacts()));
});

test("a missing durable boundary phase fails closed", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts().slice(1)), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("an unknown durable boundary fails closed", () => {
  const facts = boundaryFacts();
  facts[0] = { ...facts[0], boundaryId: "full.unknown.stored" };
  assert.throws(() => assertDurableBoundaryFacts(facts), { code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID" });
});

test("a malformed durable boundary fact fails with the stable Self-Test code", () => {
  const facts = boundaryFacts();
  facts[0] = null;
  assert.throws(() => assertDurableBoundaryFacts(facts), { code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID" });
});

test("a duplicated durable boundary phase fails closed", () => {
  const facts = boundaryFacts();
  facts.push(facts[0]);
  assert.throws(() => assertDurableBoundaryFacts(facts), { code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID" });
});

test("a durable boundary with zero logical results fails closed", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts({ logicalResultCount: 0 })), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("a durable boundary with duplicated logical results fails closed", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts({ logicalResultCount: 2 })), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

for (const [name, overrides] of [
  ["logical identity", { logicalId: "" }],
  ["result digest", { resultDigest: "sha256:invalid" }],
  ["result status", { resultStatus: "" }],
  ["root identity", { rootIdentity: "sha256:invalid" }]
]) {
  test(`a durable boundary with an invalid ${name} fails closed`, () => {
    assert.throws(() => assertDurableBoundaryFacts(boundaryFacts(overrides)), {
      code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
    });
  });
}

test("a boundary that did not resume fails closed", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts({ resumed: false })), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("a boundary without the expected hard-crash exit fails closed", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts({ crashExitCode: 0 })), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("a boundary whose resume process fails is rejected", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts({ resumeExitCode: 1 })), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("a divergent resumed fingerprint fails closed", () => {
  const facts = boundaryFacts();
  facts.at(-1).semanticFingerprint = ["full.complete:fail"];
  assert.throws(() => assertDurableBoundaryFacts(facts), { code: "VES_SELFTEST_NONCONVERGENT" });
});

test("a reused matrix root fails closed", () => {
  const facts = boundaryFacts();
  facts[1].rootIdentity = facts[0].rootIdentity;
  assert.throws(() => assertDurableBoundaryFacts(facts), { code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID" });
});

test("a matrix root shared with the happy path fails closed", () => {
  const facts = boundaryFacts();
  assert.throws(() => assertDurableBoundaryFacts(facts, facts[0].rootIdentity), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("an approved read-only invocation with an exact displayed review passes", () => {
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation()));
});

test("review equality does not depend on JavaScript object key order", () => {
  const approvedReview = review();
  const displayedReview = Object.fromEntries(Object.entries(approvedReview).reverse());
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation({ displayedReview })));
});

// Issue #58: Driver review equality is a trust identity — it decides whether a
// provider boundary may be entered — and it is now encoded with the qualified
// canonical contract (canonicalizeJsonV2, RFC 8785 JCS) instead of a
// JSON.stringify of one hand-written projection. The projection fixed the
// order of the top-level members only, so a nested Tool written as
// {access, name} rather than {name, access} used to serialize differently and
// was rejected as a *different review* — a false denial with no content
// difference behind it.
test("review equality does not depend on the member order of a nested Tool", () => {
  const approvedReview = review();
  const displayedReview = {
    ...approvedReview,
    tools: approvedReview.tools.map((tool) => Object.fromEntries(Object.entries(tool).reverse()))
  };
  assert.deepEqual(Object.keys(displayedReview.tools[0]), ["access", "name"]);
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation({ displayedReview })));
});

// Replacing String.prototype.localeCompare with a comparator that reverses
// UTF-16 code-unit order simulates a divergent locale collation without
// depending on a particular installed ICU locale disagreeing today.
function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

test("Driver review equality reaches the same verdict under a divergent locale collation", () => {
  const approvedReview = review();
  const displayedReview = Object.fromEntries(
    Object.entries({
      ...approvedReview,
      tools: approvedReview.tools.map((tool) => Object.fromEntries(Object.entries(tool).reverse()))
    }).reverse()
  );
  withHostileLocaleCompare(() => {
    assert.doesNotThrow(() => assertDriverInvocationFacts(invocation({ displayedReview })));
    // A real content difference is still a difference under any collation.
    assert.throws(
      () =>
        assertDriverInvocationFacts(
          invocation({ displayedReview: { ...displayedReview, destinationId: "destination:elsewhere" } })
        ),
      { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" }
    );
  });
});

// Arrays carry order under the contract, so a Tool list presented in a
// different sequence than the one approved is still a different review.
test("a Tool list presented in a different order is still a different review", () => {
  const approvedReview = review({
    tools: [
      { name: "vestra_read", access: "read" },
      { name: "vestra_list", access: "read" }
    ]
  });
  const facts = invocation({
    review: approvedReview,
    displayedReview: { ...approvedReview, tools: [...approvedReview.tools].reverse() },
    actualReview: structuredClone(approvedReview)
  });
  assert.throws(() => assertDriverInvocationFacts(facts), { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" });
});

test("a denied invocation with zero provider calls passes", () => {
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation({ authorized: false, providerBoundaryEntries: 0 })));
});

test("a denied invocation that reaches a provider fails closed", () => {
  assert.throws(() => assertDriverInvocationFacts(invocation({ authorized: false })), {
    code: "VES_SELFTEST_PROVIDER_CALL_REACHED"
  });
});

test("an approved invocation must reach exactly one provider boundary", () => {
  for (const providerBoundaryEntries of [0, 2]) {
    assert.throws(() => assertDriverInvocationFacts(invocation({ providerBoundaryEntries })), {
      code: "VES_SELFTEST_PROVIDER_CALL_INVALID"
    });
  }
});

test("every displayed review field is bound exactly", () => {
  const mutations = [
    { providerId: "openai" },
    { modelId: "other-model" },
    { destinationId: "destination:other" },
    { maximumCostUsd: 0.02 },
    { modelCapabilities: ["stream"] },
    { tools: [] },
    { classification: "public" },
    { purpose: "other" },
    { retention: "session" },
    { egressMode: "offline" }
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => assertDriverInvocationFacts(invocation({ displayedReview: review(mutation) })),
      { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" },
      JSON.stringify(mutation)
    );
  }
});

test("every actually used review field is bound exactly", () => {
  const mutations = [
    { providerId: "openai" },
    { modelId: "other-model" },
    { destinationId: "destination:other" },
    { maximumCostUsd: 0.02 },
    { modelCapabilities: ["stream"] },
    { tools: [] },
    { classification: "public" },
    { purpose: "other" },
    { retention: "session" },
    { egressMode: "offline" }
  ];
  for (const mutation of mutations) {
    assert.throws(
      () => assertDriverInvocationFacts(invocation({ actualReview: review(mutation) })),
      { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" },
      JSON.stringify(mutation)
    );
  }
});

test("an invalid cost fails closed", () => {
  assert.throws(() => assertDriverInvocationFacts(invocation({ review: review({ maximumCostUsd: 0 }) })), {
    code: "VES_SELFTEST_DRIVER_REVIEW_INVALID"
  });
});

test("a writer Tool in the review fails closed", () => {
  const tools = [{ name: "vestra_write", access: "write" }];
  assert.throws(
    () =>
      assertDriverInvocationFacts(
        invocation({ review: review({ tools }), displayedReview: review({ tools }), actualReview: review({ tools }) })
      ),
    { code: "VES_SELFTEST_WRITER_TOOL_REACHABLE" }
  );
});

test("a reachable writer Tool fails closed even if the review is read-only", () => {
  assert.throws(() => assertDriverInvocationFacts(invocation({ writerToolReachable: true })), {
    code: "VES_SELFTEST_WRITER_TOOL_REACHABLE"
  });
});

test("writer reachability must be an explicit false fact", () => {
  assert.throws(() => assertDriverInvocationFacts(invocation({ writerToolReachable: undefined })), {
    code: "VES_SELFTEST_WRITER_TOOL_REACHABLE"
  });
});

function fullFacts(overrides = {}) {
  return {
    packageStored: "published",
    packageVerified: true,
    approvalVerified: true,
    contextFragments: 1,
    routedPassportId: "passport_018f0b6d-7b1a-7abc-8def-012345678901",
    executionStatus: "AWAITING_GATE",
    effectApplyCalls: 1,
    gateStatus: "COMMITTED",
    verificationVerdict: "PASS",
    handoffStatus: "EXECUTION_AUTHORIZED",
    capsuleStored: "published",
    capsuleVerified: true,
    portableEvidenceValid: true,
    ...overrides
  };
}

test("full workflow verdict rejects every invalid observed fact", () => {
  const mutations = [
    { packageStored: "conflict" },
    { packageVerified: false },
    { approvalVerified: false },
    { contextFragments: 0 },
    { routedPassportId: "" },
    { executionStatus: "FAILED" },
    { effectApplyCalls: 0 },
    { effectApplyCalls: 2 },
    { gateStatus: "PENDING" },
    { verificationVerdict: "FAIL" },
    { handoffStatus: "PREPARED" },
    { capsuleStored: "conflict" },
    { capsuleVerified: false },
    { portableEvidenceValid: false }
  ];
  for (const mutation of mutations)
    assert.throws(() => assertFullWorkflowFacts(fullFacts(mutation)), { code: "VES_SELFTEST_FULL_FACTS_INVALID" });
});

test("full workflow PASS checks cannot be created from invalid facts", () => {
  assert.throws(() => fullWorkflowChecks(fullFacts({ effectApplyCalls: 2 })), {
    code: "VES_SELFTEST_FULL_FACTS_INVALID"
  });
});

function driverScenarioFacts(overrides = {}) {
  const approved = ["anthropic", "openai", "opencode"].map((providerId) =>
    invocation({
      review: review({ providerId }),
      displayedReview: review({ providerId }),
      actualReview: review({ providerId })
    })
  );
  return {
    invocations: [...approved, invocation({ authorized: false, providerBoundaryEntries: 0 })],
    lifecycle: { sessionStarted: 3, sessionClosed: 3, writerToolRequests: 0, networkAttempts: 0 },
    ...overrides
  };
}

test("Driver scenario verdict rejects missing, duplicate, writer, lifecycle, and network facts", () => {
  const duplicateProvider = structuredClone(driverScenarioFacts());
  duplicateProvider.invocations[2] = structuredClone(duplicateProvider.invocations[0]);
  const mutations = [
    { invocations: driverScenarioFacts().invocations.slice(1) },
    { invocations: duplicateProvider.invocations },
    { lifecycle: { sessionStarted: 2, sessionClosed: 3, writerToolRequests: 0, networkAttempts: 0 } },
    { lifecycle: { sessionStarted: 3, sessionClosed: 2, writerToolRequests: 0, networkAttempts: 0 } },
    { lifecycle: { sessionStarted: 3, sessionClosed: 3, writerToolRequests: 1, networkAttempts: 0 } },
    { lifecycle: { sessionStarted: 3, sessionClosed: 3, writerToolRequests: 0, networkAttempts: 1 } }
  ];
  for (const mutation of mutations)
    assert.throws(() => assertDriverScenarioFacts(driverScenarioFacts(mutation)), {
      code: "VES_SELFTEST_DRIVER_SCENARIO_INVALID"
    });
});

test("Driver PASS checks cannot be created from a duplicate-provider set", () => {
  const duplicateProvider = structuredClone(driverScenarioFacts());
  duplicateProvider.invocations[2] = structuredClone(duplicateProvider.invocations[0]);
  assert.throws(() => driverScenarioChecks(duplicateProvider), {
    code: "VES_SELFTEST_DRIVER_SCENARIO_INVALID"
  });
});
