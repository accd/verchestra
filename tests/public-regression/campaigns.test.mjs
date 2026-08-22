// T73 (#14): run the frozen public regression corpus. Every campaign observes a
// real qualified surface and must clear its threshold via the lower confidence
// bound. The corpus is immutable — its canonical serialization seals a digest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  assertCampaignCorpus,
  buildCampaignSummary,
  canonicalizeCorpus
} from "../../packages/application/src/index.ts";
import { CAMPAIGNS, CAMPAIGN_DEFINITIONS, runCampaign } from "./corpus.mjs";

const corpusDigest = () =>
  `sha256:${createHash("sha256").update(canonicalizeCorpus(CAMPAIGN_DEFINITIONS)).digest("hex")}`;

test("the public corpus is a valid set of at least twenty campaigns", () => {
  assert.doesNotThrow(() => assertCampaignCorpus(CAMPAIGN_DEFINITIONS));
  assert.ok(CAMPAIGN_DEFINITIONS.length >= 20, `only ${CAMPAIGN_DEFINITIONS.length} campaigns`);
});

test("the corpus digest is stable and change-sensitive", () => {
  assert.equal(corpusDigest(), corpusDigest());
  assert.match(corpusDigest(), /^sha256:[a-f0-9]{64}$/u);
  const edited = [...CAMPAIGN_DEFINITIONS.slice(1), { ...CAMPAIGN_DEFINITIONS[0], threshold: 0.5 }];
  const editedDigest = `sha256:${createHash("sha256").update(canonicalizeCorpus(edited)).digest("hex")}`;
  assert.notEqual(editedDigest, corpusDigest());
});

for (const campaign of CAMPAIGNS) {
  test(`campaign ${campaign.def.id} clears its threshold`, async () => {
    const result = await runCampaign(campaign);
    assert.equal(
      result.verdict,
      "PASS",
      `${campaign.def.id}: lower bound ${result.lowerConfidenceBound} below ${campaign.def.threshold}`
    );
  });
}

test("the corpus summary is PASS with every campaign accounted for", async () => {
  const summary = buildCampaignSummary(
    await Promise.all(CAMPAIGNS.map(runCampaign)),
    corpusDigest(),
    CAMPAIGN_DEFINITIONS
  );
  assert.equal(summary.verdict, "PASS");
  assert.equal(summary.campaignCount, CAMPAIGN_DEFINITIONS.length);
});
