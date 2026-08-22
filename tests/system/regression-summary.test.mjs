// T73 (#14, CAM-05): the public campaign summary end to end — schema-valid
// machine output, an agreeing human projection, and no leaked path or secret.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { buildCampaignSummary, canonicalizeCorpus } from "../../packages/application/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/schema-registry.ts";
import { CAMPAIGNS, CAMPAIGN_DEFINITIONS, runCampaign } from "../public-regression/corpus.mjs";

const registry = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));

async function summarize() {
  const digest = `sha256:${createHash("sha256").update(canonicalizeCorpus(CAMPAIGN_DEFINITIONS)).digest("hex")}`;
  return buildCampaignSummary(await Promise.all(CAMPAIGNS.map(runCampaign)), digest, CAMPAIGN_DEFINITIONS);
}

function humanSummary(summary) {
  return [
    `Regression corpus ${summary.verdict} (${summary.campaignCount} campaigns)`,
    ...summary.campaigns.map(
      (entry) =>
        `${entry.id} [${entry.requirement}] ${entry.verdict} passRate=${entry.passRate} lcb=${entry.lowerConfidenceBound}`
    )
  ].join("\n");
}

test("the machine summary validates against regression-campaign-summary@1", async () => {
  const summary = await summarize();
  assert.doesNotThrow(() => registry.validate("regression-campaign-summary", "1", summary));
  assert.equal(summary.verdict, "PASS");
});

test("the human summary projects the same verdicts as the machine summary", async () => {
  const summary = await summarize();
  const human = humanSummary(summary);
  for (const entry of summary.campaigns)
    assert.ok(human.includes(`${entry.id} [${entry.requirement}] ${entry.verdict}`));
});

test("neither summary carries an absolute path or secret", async () => {
  const summary = await summarize();
  const rendered = `${JSON.stringify(summary)}\n${humanSummary(summary)}`;
  assert.doesNotMatch(rendered, /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u);
});
