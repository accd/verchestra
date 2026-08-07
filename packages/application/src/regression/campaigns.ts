// Public regression campaign rules (T73, #14). Pure: corpus validation, the
// immutability serialization, the distribution/confidence math, and the summary
// allowlist all live here so they are unit-testable without a filesystem, and so
// a verdict can never be read from a single cherry-picked run. The frozen corpus
// and its reproducible fixtures live under tests/public-regression.

export type CampaignErrorCode = "VES_CAMPAIGN_CORPUS_INVALID" | "VES_CAMPAIGN_SUMMARY_INVALID";

export class CampaignError extends Error {
  readonly code: CampaignErrorCode;

  constructor(code: CampaignErrorCode, message: string) {
    super(message);
    this.name = "CampaignError";
    this.code = code;
  }
}

function fail(code: CampaignErrorCode, message: string): never {
  throw new CampaignError(code, message);
}

// A candidate evaluation must exercise at least this many representative
// delivery behaviors before its distribution of outcomes is public evidence.
export const MINIMUM_CAMPAIGNS = 20;

export interface CampaignDefinition {
  readonly id: string;
  readonly requirement: string;
  readonly owner: string;
  // The pass-rate lower bound a candidate must clear, in [0, 1].
  readonly threshold: number;
  readonly fixtureRef: string;
  readonly evidenceRef: string;
  // 1 for a deterministic campaign; higher for a probabilistic one.
  readonly sampleSize: number;
}

const ID = /^[a-z][a-z0-9-]*$/u;
const REQUIREMENT = /^[A-Z][A-Z0-9-]*$/u;
const REF = /^[a-z][a-z0-9./-]*$/u;

function assertDefinitionKeys(definition: CampaignDefinition): void {
  if (definition === null || typeof definition !== "object")
    fail("VES_CAMPAIGN_CORPUS_INVALID", "campaign definition is malformed");
  if (!ID.test(definition.id)) fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign id is invalid: ${String(definition.id)}`);
  if (!REQUIREMENT.test(definition.requirement))
    fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign ${definition.id} requirement is invalid`);
}

function assertDefinitionRefs(definition: CampaignDefinition): void {
  for (const [field, value] of [
    ["owner", definition.owner],
    ["fixtureRef", definition.fixtureRef],
    ["evidenceRef", definition.evidenceRef]
  ] as const) {
    if (typeof value !== "string" || value.length === 0)
      fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign ${definition.id} ${field} is invalid`);
  }
  if (!REF.test(definition.fixtureRef) || !REF.test(definition.evidenceRef))
    fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign ${definition.id} references are not path-safe tokens`);
}

function assertDefinitionNumbers(definition: CampaignDefinition): void {
  if (typeof definition.threshold !== "number" || definition.threshold < 0 || definition.threshold > 1)
    fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign ${definition.id} threshold must be in [0, 1]`);
  if (!Number.isSafeInteger(definition.sampleSize) || definition.sampleSize < 1)
    fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign ${definition.id} sample size must be a positive integer`);
}

function assertOneDefinition(definition: CampaignDefinition): void {
  assertDefinitionKeys(definition);
  assertDefinitionRefs(definition);
  assertDefinitionNumbers(definition);
}

// CAM-01/CAM-02: a closed, ordered set of at least MINIMUM_CAMPAIGNS, every
// field present and well-formed, no duplicate id.
export function assertCampaignCorpus(definitions: readonly CampaignDefinition[]): void {
  if (!Array.isArray(definitions)) fail("VES_CAMPAIGN_CORPUS_INVALID", "corpus is not a list");
  if (definitions.length < MINIMUM_CAMPAIGNS)
    fail(
      "VES_CAMPAIGN_CORPUS_INVALID",
      `corpus has ${definitions.length} campaigns; at least ${MINIMUM_CAMPAIGNS} are required`
    );
  const seen = new Set<string>();
  for (const definition of definitions) {
    assertOneDefinition(definition);
    if (seen.has(definition.id)) fail("VES_CAMPAIGN_CORPUS_INVALID", `duplicate campaign id ${definition.id}`);
    seen.add(definition.id);
  }
}

// CAM-01: a deterministic canonical serialization of the corpus. Hashing this
// detects any addition, removal, or edit; the runner seals it into a digest.
export function canonicalizeCorpus(definitions: readonly CampaignDefinition[]): string {
  assertCampaignCorpus(definitions);
  return JSON.stringify(
    definitions.map((definition) => ({
      evidenceRef: definition.evidenceRef,
      fixtureRef: definition.fixtureRef,
      id: definition.id,
      owner: definition.owner,
      requirement: definition.requirement,
      sampleSize: definition.sampleSize,
      threshold: definition.threshold
    }))
  );
}

export type CampaignVerdict = "PASS" | "FAIL";

export interface CampaignRunResult {
  readonly id: string;
  readonly samples: number;
  readonly passes: number;
  readonly passRate: number;
  readonly lowerConfidenceBound: number;
  readonly verdict: CampaignVerdict;
}

const Z_95 = 1.959963984540054;

// The Wilson score interval lower bound for a binomial proportion: robust for
// small samples and never above the point estimate, so a lucky streak cannot
// clear a threshold the true rate would miss.
function wilsonLowerBound(passes: number, samples: number): number {
  const proportion = passes / samples;
  const z2 = Z_95 * Z_95;
  const denominator = 1 + z2 / samples;
  const center = proportion + z2 / (2 * samples);
  const margin = Z_95 * Math.sqrt((proportion * (1 - proportion) + z2 / (4 * samples)) / samples);
  return Math.max(0, (center - margin) / denominator);
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

// CAM-03: the verdict uses the lower confidence bound, never a single run. A
// deterministic campaign (one sample) reports its exact outcome as the bound.
export function evaluateCampaign(definition: CampaignDefinition, outcomes: readonly boolean[]): CampaignRunResult {
  assertOneDefinition(definition);
  if (!Array.isArray(outcomes) || outcomes.length === 0)
    fail("VES_CAMPAIGN_CORPUS_INVALID", `campaign ${definition.id} produced no outcomes`);
  if (outcomes.length < definition.sampleSize)
    fail(
      "VES_CAMPAIGN_CORPUS_INVALID",
      `campaign ${definition.id} ran ${outcomes.length} of ${definition.sampleSize} samples`
    );
  const samples = outcomes.length;
  const passes = outcomes.filter((outcome) => outcome === true).length;
  const lowerConfidenceBound = samples === 1 ? passes : round(wilsonLowerBound(passes, samples));
  return Object.freeze({
    id: definition.id,
    samples,
    passes,
    passRate: round(passes / samples),
    lowerConfidenceBound,
    verdict: lowerConfidenceBound >= definition.threshold ? "PASS" : "FAIL"
  });
}

export type CampaignSummaryValue = string | number | boolean | readonly CampaignSummaryEntry[];

export interface CampaignSummaryEntry {
  readonly id: string;
  readonly requirement: string;
  readonly verdict: CampaignVerdict;
  readonly samples: number;
  readonly passRate: number;
  readonly lowerConfidenceBound: number;
}

export interface CampaignSummaryPayload {
  readonly corpusDigest: string;
  readonly campaignCount: number;
  readonly verdict: CampaignVerdict;
  readonly campaigns: readonly CampaignSummaryEntry[];
}

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

// CAM-05: the machine summary carries only registered, safe values — verdicts
// and distributions, never a path, secret, or provider payload.
function assertSummaryEntry(entry: CampaignSummaryEntry): void {
  if (!ID.test(entry.id) || !REQUIREMENT.test(entry.requirement))
    fail("VES_CAMPAIGN_SUMMARY_INVALID", "summary entry id or requirement is invalid");
  if (entry.verdict !== "PASS" && entry.verdict !== "FAIL")
    fail("VES_CAMPAIGN_SUMMARY_INVALID", `summary entry ${entry.id} verdict is invalid`);
  for (const rate of [entry.passRate, entry.lowerConfidenceBound])
    if (typeof rate !== "number" || rate < 0 || rate > 1)
      fail("VES_CAMPAIGN_SUMMARY_INVALID", `summary entry ${entry.id} rate is out of range`);
}

export function assertCampaignSummary(payload: CampaignSummaryPayload): void {
  if (payload === null || typeof payload !== "object") fail("VES_CAMPAIGN_SUMMARY_INVALID", "summary is malformed");
  if (!DIGEST.test(payload.corpusDigest)) fail("VES_CAMPAIGN_SUMMARY_INVALID", "summary corpus digest is invalid");
  if (payload.verdict !== "PASS" && payload.verdict !== "FAIL")
    fail("VES_CAMPAIGN_SUMMARY_INVALID", "summary verdict is invalid");
  if (!Array.isArray(payload.campaigns) || payload.campaigns.length !== payload.campaignCount)
    fail("VES_CAMPAIGN_SUMMARY_INVALID", "summary campaign count does not match its entries");
  for (const entry of payload.campaigns) assertSummaryEntry(entry);
}

// The corpus verdict is PASS only when every campaign passed: a public corpus
// does not average away a regression.
export function buildCampaignSummary(
  results: readonly CampaignRunResult[],
  corpusDigest: string,
  definitions: readonly CampaignDefinition[]
): CampaignSummaryPayload {
  const requirementOf = new Map(definitions.map((definition) => [definition.id, definition.requirement]));
  const payload: CampaignSummaryPayload = Object.freeze({
    corpusDigest,
    campaignCount: results.length,
    verdict: results.every((result) => result.verdict === "PASS") ? "PASS" : "FAIL",
    campaigns: Object.freeze(
      [...results]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((result) =>
          Object.freeze({
            id: result.id,
            requirement: requirementOf.get(result.id) ?? "UNKNOWN",
            verdict: result.verdict,
            samples: result.samples,
            passRate: result.passRate,
            lowerConfidenceBound: result.lowerConfidenceBound
          })
        )
    )
  });
  assertCampaignSummary(payload);
  return payload;
}
