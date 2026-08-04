import assert from "node:assert/strict";
import { test } from "node:test";

import { runAuthorizedDriverBoundary } from "../../apps/vestra-cli/src/self-test-driver-authority.ts";

const review = {
  providerId: "anthropic",
  modelId: "claude-opus-4-8",
  destinationId: "local:claude",
  maximumCostUsd: 0.25,
  modelCapabilities: ["read", "reason"],
  tools: [{ name: "vestra_read", access: "read" }],
  classification: "internal",
  purpose: "self-test-read-only",
  retention: "none",
  egressMode: "online"
};

const authority = () => ({
  approvalGranted: true,
  capabilityGranted: true,
  destinationId: review.destinationId,
  maximumCostUsd: review.maximumCostUsd,
  egressAllowed: true,
  approvedReview: review
});

for (const [name, change] of [
  ["approval", { approvalGranted: false }],
  ["capability", { capabilityGranted: false }],
  ["destination", { destinationId: "local:other" }],
  ["cost", { maximumCostUsd: 0.5 }],
  ["egress", { egressAllowed: false }]
]) {
  test(`missing or mismatched ${name} authority produces zero provider calls`, async () => {
    let invoked = 0;
    const facts = await runAuthorizedDriverBoundary({
      review,
      displayedReview: review,
      actualReview: review,
      authority: { ...authority(), ...change },
      invoke: async () => {
        invoked += 1;
      }
    });
    assert.equal(facts.authorized, false);
    assert.equal(facts.providerBoundaryEntries, 0);
    assert.equal(invoked, 0);
  });
}

test("a writer-shaped Tool is denied before the provider boundary", async () => {
  let invoked = 0;
  const writerReview = { ...review, tools: [{ name: "vestra_write", access: "write" }] };
  await assert.rejects(
    runAuthorizedDriverBoundary({
      review: writerReview,
      displayedReview: writerReview,
      actualReview: writerReview,
      authority: { ...authority(), approvedReview: writerReview },
      invoke: async () => {
        invoked += 1;
      }
    }),
    { code: "VES_SELFTEST_WRITER_TOOL_REACHABLE" }
  );
  assert.equal(invoked, 0);
});

const sensitiveMutations = [
  ["provider", { providerId: "openai" }],
  ["model", { modelId: "other-model" }],
  ["destination", { destinationId: "local:other" }],
  ["cost", { maximumCostUsd: 0.5 }],
  ["capabilities", { modelCapabilities: ["read"] }],
  [
    "tools",
    {
      tools: [
        { name: "vestra_read", access: "read" },
        { name: "extra", access: "read" }
      ]
    }
  ],
  ["classification", { classification: "public" }],
  ["purpose", { purpose: "other" }],
  ["retention", { retention: "session" }],
  ["egress", { egressMode: "offline" }]
];

for (const [surface, inputFor] of [
  ["approved", (change) => ({ authority: { ...authority(), approvedReview: { ...review, ...change } } })],
  ["displayed", (change) => ({ displayedReview: { ...review, ...change } })],
  ["actually used", (change) => ({ actualReview: { ...review, ...change } })]
]) {
  for (const [name, change] of sensitiveMutations) {
    test(`${surface} ${name} mismatch is rejected before provider entry`, async () => {
      let invoked = 0;
      await assert.rejects(
        runAuthorizedDriverBoundary({
          review,
          displayedReview: review,
          actualReview: review,
          authority: authority(),
          ...inputFor(change),
          invoke: async () => {
            invoked += 1;
          }
        }),
        { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" }
      );
      assert.equal(invoked, 0);
    });
  }
}

for (const [surface, input] of [
  ["approved", { authority: { ...authority(), approvedReview: { ...review, unexpected: true } } }],
  ["displayed", { displayedReview: { ...review, unexpected: true } }],
  ["actually used", { actualReview: { ...review, unexpected: true } }]
]) {
  test(`${surface} unknown field is rejected before provider entry`, async () => {
    let invoked = 0;
    await assert.rejects(
      runAuthorizedDriverBoundary({
        review,
        displayedReview: review,
        actualReview: review,
        authority: authority(),
        ...input,
        invoke: async () => {
          invoked += 1;
        }
      }),
      { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" }
    );
    assert.equal(invoked, 0);
  });
}

test("unknown authority fields are rejected before provider entry", async () => {
  let invoked = 0;
  await assert.rejects(
    runAuthorizedDriverBoundary({
      review,
      displayedReview: review,
      actualReview: review,
      authority: { ...authority(), unexpected: true },
      invoke: async () => {
        invoked += 1;
      }
    }),
    { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" }
  );
  assert.equal(invoked, 0);
});

test("the provider boundary receives the exact preflighted review", async () => {
  let usedReview;
  const facts = await runAuthorizedDriverBoundary({
    review,
    displayedReview: structuredClone(review),
    actualReview: structuredClone(review),
    authority: authority(),
    invoke: async (value) => {
      usedReview = value;
    }
  });
  assert.deepEqual(usedReview, review);
  assert.deepEqual(facts.actualReview, review);
  assert.equal(facts.providerBoundaryEntries, 1);
});
