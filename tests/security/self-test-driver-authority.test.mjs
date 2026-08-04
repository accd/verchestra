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
      authority: { ...authority(), approvedReview: writerReview },
      invoke: async () => {
        invoked += 1;
      }
    }),
    { code: "VES_SELFTEST_WRITER_TOOL_REACHABLE" }
  );
  assert.equal(invoked, 0);
});

for (const [name, change] of [
  ["destination", { destinationId: "local:other" }],
  ["cost", { maximumCostUsd: 0.5 }],
  [
    "tools",
    {
      tools: [
        { name: "vestra_read", access: "read" },
        { name: "extra", access: "read" }
      ]
    }
  ],
  ["egress", { egressMode: "offline" }]
]) {
  test(`displayed ${name} mismatch is rejected before provider entry`, async () => {
    let invoked = 0;
    await assert.rejects(
      runAuthorizedDriverBoundary({
        review,
        displayedReview: { ...review, ...change },
        authority: authority(),
        invoke: async () => {
          invoked += 1;
        }
      }),
      { code: "VES_SELFTEST_DRIVER_REVIEW_INVALID" }
    );
    assert.equal(invoked, 0);
  });
}
