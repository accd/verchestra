import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DURABLE_CRASH_PHASES,
  DRIVER_CHECK_IDS,
  FULL_CHECK_IDS,
  FULL_DURABLE_BOUNDARY_IDS,
  assertDriverInvocationFacts,
  assertDurableBoundaryFacts
} from "../../packages/application/src/index.ts";

const fingerprint = Object.freeze(["full.complete:pass"]);

function boundaryFacts(overrides = {}) {
  return FULL_DURABLE_BOUNDARY_IDS.flatMap((boundaryId) =>
    DURABLE_CRASH_PHASES.map((phase) => ({
      boundaryId,
      phase,
      logicalResultCount: 1,
      resumed: true,
      semanticFingerprint: fingerprint,
      ...overrides
    }))
  );
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
    authorized: true,
    providerCalls: 1,
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

test("a boundary that did not resume fails closed", () => {
  assert.throws(() => assertDurableBoundaryFacts(boundaryFacts({ resumed: false })), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("a divergent resumed fingerprint fails closed", () => {
  const facts = boundaryFacts();
  facts.at(-1).semanticFingerprint = ["full.complete:fail"];
  assert.throws(() => assertDurableBoundaryFacts(facts), { code: "VES_SELFTEST_NONCONVERGENT" });
});

test("an approved read-only invocation with an exact displayed review passes", () => {
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation()));
});

test("review equality does not depend on JavaScript object key order", () => {
  const approvedReview = review();
  const displayedReview = Object.fromEntries(Object.entries(approvedReview).reverse());
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation({ displayedReview })));
});

test("a denied invocation with zero provider calls passes", () => {
  assert.doesNotThrow(() => assertDriverInvocationFacts(invocation({ authorized: false, providerCalls: 0 })));
});

test("a denied invocation that reaches a provider fails closed", () => {
  assert.throws(() => assertDriverInvocationFacts(invocation({ authorized: false })), {
    code: "VES_SELFTEST_PROVIDER_CALL_REACHED"
  });
});

test("an approved invocation must reach exactly one provider boundary", () => {
  for (const providerCalls of [0, 2]) {
    assert.throws(() => assertDriverInvocationFacts(invocation({ providerCalls })), {
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

test("an invalid cost fails closed", () => {
  assert.throws(() => assertDriverInvocationFacts(invocation({ review: review({ maximumCostUsd: 0 }) })), {
    code: "VES_SELFTEST_DRIVER_REVIEW_INVALID"
  });
});

test("a writer Tool in the review fails closed", () => {
  const tools = [{ name: "vestra_write", access: "write" }];
  assert.throws(
    () => assertDriverInvocationFacts(invocation({ review: review({ tools }), displayedReview: review({ tools }) })),
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
