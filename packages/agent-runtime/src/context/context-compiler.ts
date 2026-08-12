import type { DataEgressFirewall, TrustEnvelope } from "@verchestra/application";
import { DataClassification, IsoInstant, StableId, canonicalizeJsonV2 } from "@verchestra/domain";

import {
  contextRecipeDigest,
  type ContextDigestPort,
  type ContextRecipe,
  type ContextSnapshot,
  type ContextSourceSelector,
  type ResolvedContextFragment,
  type ResolvedContextSource
} from "./source-snapshots.ts";
import { estimateQualifiedTokens, QUALIFIED_TOKEN_ESTIMATOR, type TokenEstimatorIdentity } from "./token-estimator.ts";

const PRIORITY_RANK = { mandatory: 0, high: 1, medium: 2, low: 3 } as const;
const TRUST_RANK = { authority: 0, "verified-evidence": 1, "untrusted-data": 2, "generated-content": 3 } as const;
const SOURCE_STATUSES = ["available", "missing", "unavailable", "stale", "outside-scope", "revision-mismatch"] as const;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
type Priority = keyof typeof PRIORITY_RANK;

// An injected estimator the caller did not name. Recording it as unknown is the
// honest reading: the manifest states that these counts did not come from the
// qualified estimator, without claiming to know what did produce them.
const UNQUALIFIED_TOKENIZER: TokenEstimatorIdentity = Object.freeze({ name: "caller-injected", version: "unknown" });

export class ContextCompilerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContextCompilerError";
    this.code = code;
  }
}

export interface ContextManifestSignerPort {
  sign(manifest: Readonly<Record<string, unknown>>): Promise<{
    readonly keyId: string;
    readonly signature: string;
  }>;
}

export interface CompiledContextFragment extends ResolvedContextFragment {
  readonly priority: Priority;
  readonly estimatedTokens: number;
}

export interface ContextOmission {
  readonly fragmentId: string;
  readonly priority: Priority;
  readonly reason: "duplicate" | "stale" | "priority-budget" | "model-capacity";
  readonly estimatedTokens: number;
  readonly affectsFreshness: boolean;
  readonly affectsConfidence: boolean;
}

export interface ContextManifest {
  readonly schemaVersion: 1;
  readonly manifestId: string;
  // Which estimator produced every token count below. Without it two manifests
  // that disagree can only be observed to differ, never explained — and the
  // omission decisions the counts drove are exactly what a reader needs to
  // reproduce (AD-015, TOK-02).
  readonly tokenizer: TokenEstimatorIdentity;
  readonly workspaceId: string;
  readonly runId: string;
  readonly recipeId: string;
  readonly recipeDigest: string;
  readonly snapshotId: string;
  readonly fragments: readonly CompiledContextFragment[];
  readonly omissions: readonly ContextOmission[];
  readonly sourceFindings: ContextSnapshot["findings"];
  readonly contradictions: ContextSnapshot["contradictions"];
  readonly retrievalGenerationRefs: readonly string[];
  readonly policyDecisionRefs: readonly string[];
  readonly estimatedTokens: number;
  readonly mandatoryTokens: number;
  readonly semanticObligations: readonly string[];
  readonly semanticObligationsDigest: string;
  readonly serializedMeaningDigest: string;
  readonly egressDigest: string;
  readonly compiledAt: string;
  readonly keyId: string;
  readonly signature: string;
}

// Code-unit comparison, not localeCompare: several of these sorts are not
// just digest input order -- rank() feeds the greedy budget-inclusion loop
// below, so a locale divergence could change WHICH fragments are included
// under a tight capacity, not just how they are serialized (AD-015, issue
// #58).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: string, message: string): never {
  throw new ContextCompilerError(code, message);
}

function priorityFor(selector: ContextSourceSelector, required: boolean): Priority {
  return selector.priority ?? (required ? "mandatory" : "medium");
}

function rank(left: CompiledContextFragment, right: CompiledContextFragment): number {
  return (
    PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
    TRUST_RANK[left.trust] - TRUST_RANK[right.trust] ||
    codeUnitCompare(left.source.identity, right.source.identity) ||
    codeUnitCompare(left.source.revision, right.source.revision) ||
    codeUnitCompare(left.fragmentId, right.fragmentId) ||
    codeUnitCompare(left.contentDigest, right.contentDigest)
  );
}

function canonicalSnapshotMaterial(snapshot: ContextSnapshot) {
  const sources = [...snapshot.sources]
    .sort((a, b) => codeUnitCompare(a.selectorId, b.selectorId))
    .map((source) => ({
      ...source,
      fragments: [...source.fragments].sort((a, b) => codeUnitCompare(a.fragmentId, b.fragmentId))
    }));
  const findings = [...snapshot.findings].sort((a, b) => codeUnitCompare(a.findingId, b.findingId));
  const contradictions = [...snapshot.contradictions].sort((a, b) =>
    codeUnitCompare(a.contradictionId, b.contradictionId)
  );
  return {
    workspaceId: snapshot.workspaceId,
    recipeDigest: snapshot.recipeDigest,
    evaluatedAt: snapshot.evaluatedAt,
    sources,
    findings,
    contradictions
  };
}

export class DeterministicContextCompiler {
  readonly #digest: ContextDigestPort;
  readonly #egress: Pick<DataEgressFirewall, "authorize">;
  readonly #signer: ContextManifestSignerPort;
  readonly #estimate: (content: string) => number;
  readonly #tokenizer: TokenEstimatorIdentity;

  constructor(options: {
    readonly digest: ContextDigestPort;
    readonly egress: Pick<DataEgressFirewall, "authorize">;
    readonly signer: ContextManifestSignerPort;
    // An override, not a requirement (TOK-04). A product run must never depend
    // on the caller supplying an estimator: an omitted one used to leave
    // `#estimate` undefined and fail only at first use, which is
    // environment-dependent behaviour dressed as a contract.
    readonly estimateTokens?: (content: string) => number;
    // Callers that override the estimator must say which one they used, so the
    // manifest never attributes their counts to the qualified estimator.
    readonly tokenizer?: TokenEstimatorIdentity;
  }) {
    this.#digest = options.digest;
    this.#egress = options.egress;
    this.#signer = options.signer;
    this.#estimate = options.estimateTokens ?? estimateQualifiedTokens;
    this.#tokenizer =
      options.tokenizer ?? (options.estimateTokens === undefined ? QUALIFIED_TOKEN_ESTIMATOR : UNQUALIFIED_TOKENIZER);
  }

  async compile(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly recipe: ContextRecipe;
    readonly snapshot: ContextSnapshot;
    readonly capacityTokens: number;
    readonly networkMode: "online" | "offline" | "no-egress";
    readonly destinationId: string;
    readonly retention: string;
    readonly approvalRef: string;
    readonly capabilityRef: string;
  }): Promise<ContextManifest> {
    try {
      StableId.parse(input.workspaceId, "workspace");
      StableId.parse(input.runId, "run");
    } catch {
      fail("VES_CONTEXT_INPUT_INVALID", "Compiler identity is invalid");
    }
    if (!Number.isSafeInteger(input.capacityTokens) || input.capacityTokens <= 0)
      fail("VES_CONTEXT_INPUT_INVALID", "Context capacity is invalid");
    const recipeDigest = contextRecipeDigest(input.recipe, this.#digest);
    this.#validateSnapshot(input, recipeDigest);

    const required = new Set(input.recipe.requiredSources.map((entry) => entry.selectorId));
    const selectors = new Map(
      [...input.recipe.requiredSources, ...input.recipe.optionalSources].map((entry) => [entry.selectorId, entry])
    );
    const unavailable = input.snapshot.sources.find(
      (source) => required.has(source.selectorId) && source.status !== "available"
    );
    if (unavailable !== undefined)
      fail("VES_CONTEXT_REQUIRED_SOURCE_UNAVAILABLE", "A required Context Source is unavailable");

    const candidates: CompiledContextFragment[] = [];
    const omissions: ContextOmission[] = [];
    for (const source of input.snapshot.sources) {
      const selector = selectors.get(source.selectorId);
      if (selector === undefined) fail("VES_CONTEXT_SNAPSHOT_INVALID", "Snapshot selector is unknown");
      const priority = priorityFor(selector, required.has(source.selectorId));
      for (const fragment of source.fragments) {
        const estimatedTokens = this.#tokens(fragment.content);
        const candidate = deepFreeze({ ...fragment, priority, estimatedTokens });
        if (source.status === "stale") {
          omissions.push(this.#omission(candidate, "stale", source));
        } else if (source.status === "available") candidates.push(candidate);
      }
    }

    const deduplicated: CompiledContextFragment[] = [];
    const byContent = new Map<string, CompiledContextFragment[]>();
    for (const candidate of candidates) {
      const group = byContent.get(candidate.contentDigest) ?? [];
      group.push(candidate);
      byContent.set(candidate.contentDigest, group);
    }
    for (const group of byContent.values()) {
      group.sort(rank);
      const winner = group[0];
      if (winner === undefined) continue;
      deduplicated.push(winner);
      for (const duplicate of group.slice(1))
        omissions.push(this.#omission(duplicate, "duplicate", this.#source(input.snapshot, duplicate)));
    }
    deduplicated.sort(rank);

    const budgets = new Map(input.recipe.priorityBudgets.map((entry) => [entry.priority, entry.maximumTokens]));
    const mandatory = deduplicated.filter((entry) => entry.priority === "mandatory");
    const mandatoryTokens = mandatory.reduce((sum, entry) => sum + entry.estimatedTokens, 0);
    if (mandatoryTokens > input.capacityTokens || mandatoryTokens > (budgets.get("mandatory") ?? Infinity))
      fail("VES_CONTEXT_CAPACITY_INELIGIBLE", "Mandatory context exceeds verified capacity");

    const included = [...mandatory];
    let total = mandatoryTokens;
    const used = new Map<Priority, number>([["mandatory", mandatoryTokens]]);
    for (const candidate of deduplicated.filter((entry) => entry.priority !== "mandatory")) {
      const priorityUsed = used.get(candidate.priority) ?? 0;
      const priorityBudget = budgets.get(candidate.priority) ?? 0;
      const source = this.#source(input.snapshot, candidate);
      if (priorityUsed + candidate.estimatedTokens > priorityBudget) {
        omissions.push(this.#omission(candidate, "priority-budget", source));
      } else if (total + candidate.estimatedTokens > input.capacityTokens) {
        omissions.push(this.#omission(candidate, "model-capacity", source));
      } else {
        included.push(candidate);
        total += candidate.estimatedTokens;
        used.set(candidate.priority, priorityUsed + candidate.estimatedTokens);
      }
    }
    included.sort(rank);
    omissions.sort(
      (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || codeUnitCompare(a.fragmentId, b.fragmentId)
    );
    if (included.length === 0) fail("VES_CONTEXT_REQUIRED_SOURCE_UNAVAILABLE", "No authorized context remains");

    let egress: Readonly<Record<string, unknown>> & { readonly allowed: boolean; readonly code: string };
    try {
      egress = await this.#egress.authorize({
        workspaceId: input.workspaceId,
        runId: input.runId,
        mode: input.networkMode,
        fragments: included as readonly TrustEnvelope[],
        purpose: input.recipe.egressPurpose,
        destinationId: input.destinationId,
        retention: input.retention,
        approvalRef: input.approvalRef,
        capabilityRef: input.capabilityRef
      });
    } catch {
      fail("VES_CONTEXT_EGRESS_DENIED", "Context egress authorization failed");
    }
    if (!egress.allowed) fail("VES_CONTEXT_EGRESS_DENIED", "Context egress was denied");
    if (
      typeof egress["egressDigest"] !== "string" ||
      typeof egress["policyEvidenceDigest"] !== "string" ||
      !DIGEST.test(egress["egressDigest"]) ||
      !DIGEST.test(egress["policyEvidenceDigest"])
    )
      fail("VES_CONTEXT_EGRESS_DENIED", "Context egress evidence is incomplete");

    const semanticObligations = [...input.recipe.semanticObligations].sort();
    const semanticObligationsDigest = this.#digest.sha256(canonicalizeJsonV2(semanticObligations));
    const serializedMeaningDigest = this.#digest.sha256(
      canonicalizeJsonV2({
        semanticObligations,
        fragments: included.map((entry) => ({
          fragmentId: entry.fragmentId,
          source: entry.source,
          classification: entry.classification,
          trust: entry.trust,
          contentDigest: entry.contentDigest,
          content: entry.content
        }))
      })
    );
    const unsigned = deepFreeze({
      schemaVersion: 1 as const,
      workspaceId: input.workspaceId,
      runId: input.runId,
      recipeId: input.recipe.recipeId,
      recipeDigest,
      snapshotId: input.snapshot.snapshotId,
      fragments: included,
      omissions,
      sourceFindings: input.snapshot.findings,
      contradictions: input.snapshot.contradictions,
      retrievalGenerationRefs: [
        ...new Set(
          input.snapshot.sources.flatMap((entry) =>
            entry.sourceRevision === undefined ? [] : [`${entry.sourceId}@${entry.sourceRevision}`]
          )
        )
      ].sort(),
      policyDecisionRefs: [egress["policyEvidenceDigest"]],
      estimatedTokens: total,
      mandatoryTokens,
      tokenizer: this.#tokenizer,
      semanticObligations,
      semanticObligationsDigest,
      serializedMeaningDigest,
      egressDigest: egress["egressDigest"],
      compiledAt: input.snapshot.evaluatedAt
    });
    const manifestId = this.#digest.sha256(canonicalizeJsonV2(unsigned));
    let signed;
    try {
      signed = await this.#signer.sign(deepFreeze({ manifestId, ...unsigned }));
    } catch {
      fail("VES_CONTEXT_SIGNING_FAILED", "Context manifest signing failed");
    }
    if (signed.keyId.length === 0 || signed.signature.length === 0)
      fail("VES_CONTEXT_SIGNING_FAILED", "Context manifest signature is invalid");
    return deepFreeze({ ...unsigned, manifestId, keyId: signed.keyId, signature: signed.signature });
  }

  #validateSnapshot(
    input: { readonly workspaceId: string; readonly recipe: ContextRecipe; readonly snapshot: ContextSnapshot },
    recipeDigest: string
  ): void {
    if (
      input.snapshot.schemaVersion !== 1 ||
      input.snapshot.workspaceId !== input.workspaceId ||
      input.snapshot.recipeId !== input.recipe.recipeId ||
      input.snapshot.recipeDigest !== recipeDigest ||
      input.snapshot.snapshotId !== this.#digest.sha256(canonicalizeJsonV2(canonicalSnapshotMaterial(input.snapshot)))
    )
      fail("VES_CONTEXT_SNAPSHOT_INVALID", "Context Snapshot binding is invalid");
    const ids = new Set<string>();
    const required = new Set(input.recipe.requiredSources.map((entry) => entry.selectorId));
    const selectors = new Map(
      [...input.recipe.requiredSources, ...input.recipe.optionalSources].map((entry) => [entry.selectorId, entry])
    );
    for (const source of input.snapshot.sources) {
      const selector = selectors.get(source.selectorId);
      if (
        selector === undefined ||
        source.sourceKind !== selector.sourceKind ||
        source.sourceId !== selector.sourceId ||
        source.required !== required.has(source.selectorId) ||
        !SOURCE_STATUSES.includes(source.status) ||
        (source.retrievedAt !== undefined && IsoInstant.parse(source.retrievedAt).value !== source.retrievedAt)
      )
        fail("VES_CONTEXT_SNAPSHOT_INVALID", "Context source provenance is invalid");
      for (const fragment of source.fragments) {
        const classification = DataClassification.parse(fragment.classification);
        const minimum = DataClassification.parse(selector.classification);
        if (
          ids.has(fragment.fragmentId) ||
          fragment.workspaceId !== input.workspaceId ||
          fragment.source.kind !== source.sourceKind ||
          fragment.source.identity !== source.sourceId ||
          fragment.source.revision !== source.sourceRevision ||
          fragment.retrievedAt !== source.retrievedAt ||
          classification.rank < minimum.rank ||
          (fragment.trust !== "verified-evidence" && fragment.trust !== "untrusted-data") ||
          fragment.contentDigest !== this.#digest.sha256(fragment.content)
        )
          fail("VES_CONTEXT_SNAPSHOT_INVALID", "Context fragment provenance is invalid");
        ids.add(fragment.fragmentId);
      }
    }
  }

  #tokens(content: string): number {
    let value: number;
    try {
      value = this.#estimate(content);
    } catch {
      fail("VES_CONTEXT_ESTIMATE_INVALID", "Context token estimate failed");
    }
    if (!Number.isSafeInteger(value) || value <= 0)
      fail("VES_CONTEXT_ESTIMATE_INVALID", "Context token estimate is invalid");
    return value;
  }

  #source(snapshot: ContextSnapshot, fragment: ResolvedContextFragment): ResolvedContextSource {
    const source = snapshot.sources.find((entry) =>
      entry.fragments.some((item) => item.fragmentId === fragment.fragmentId)
    );
    if (source === undefined) fail("VES_CONTEXT_SNAPSHOT_INVALID", "Fragment source is unavailable");
    return source;
  }

  #omission(
    fragment: CompiledContextFragment,
    reason: ContextOmission["reason"],
    source: ResolvedContextSource
  ): ContextOmission {
    return deepFreeze({
      fragmentId: fragment.fragmentId,
      priority: fragment.priority,
      reason,
      estimatedTokens: fragment.estimatedTokens,
      affectsFreshness: reason === "stale" || source.affectsFreshness,
      affectsConfidence: source.affectsConfidence || reason !== "duplicate"
    });
  }
}
