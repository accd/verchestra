import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

type Classification = "public" | "internal" | "confidential" | "restricted" | "secret";
type SourceKind = "repository" | "tracker" | "knowledge" | "memory" | "database";
type SemanticMode = "disabled" | "preferred" | "required";
type SemanticStatus = "ready" | "disabled" | "unavailable" | "stale" | "corrupt";
type Row = Record<string, unknown>;

export interface MemoryRetrievalPolicy {
  readonly decision: "allow" | "deny";
  readonly policyRef: string;
  readonly evidenceDigest: string;
  readonly maximumClassification: Classification;
  readonly maximumAgeSeconds: number;
  readonly semanticMode: SemanticMode;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly purpose: string;
}

export interface MemoryRetrievalRecord {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly kind: SourceKind;
  readonly revision: string;
  readonly retrievedAt: string;
  readonly validUntil: string | null;
  readonly classification: Classification;
  readonly manifestRef: string;
  readonly content: string;
  readonly contentDigest: string;
  readonly state: "active" | "stale" | "deleted" | "superseded";
}

export interface MemoryLexicalCandidate {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly contentDigest: string;
  readonly rank: number;
  readonly lexicalScore: number;
}

export interface MemoryVectorCandidate {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly contentDigest: string;
  readonly rank: number;
  readonly distance: number;
}

export interface MemoryRetrievalInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly query: string;
  readonly purpose: string;
  readonly semanticQueryDigest?: string;
  readonly evaluatedAt: string;
  readonly limit: number;
  readonly policy: MemoryRetrievalPolicy;
  readonly records: readonly MemoryRetrievalRecord[];
  readonly lexical: {
    readonly generationId: string;
    readonly candidates: readonly MemoryLexicalCandidate[];
  };
  readonly vector?: {
    readonly status: SemanticStatus;
    readonly generationId?: string;
    readonly candidates: readonly MemoryVectorCandidate[];
  };
}

export interface MemoryRetrievalRequest {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly query: string;
  readonly purpose: string;
  readonly evaluatedAt: string;
  readonly limit: number;
  readonly embedding?: readonly number[];
}

export interface MemoryRetrievalPolicyPort {
  authorize(request: {
    readonly schemaVersion: 1;
    readonly workspaceId: string;
    readonly projectId: string;
    readonly purpose: string;
    readonly queryDigest: string;
    readonly evaluatedAt: string;
    readonly requestedLimit: number;
    readonly semanticRequested: boolean;
    readonly embeddingDigest?: string;
  }): Promise<unknown>;
}

export interface MemoryCandidateRequest {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly query: string;
  readonly queryDigest: string;
  readonly purpose: string;
  readonly evaluatedAt: string;
  readonly candidateLimit: number;
  readonly maximumClassification: Classification;
  readonly maximumAgeSeconds: number;
  readonly embedding?: readonly number[];
}

export interface MemoryLexicalSourcePort {
  retrieve(request: MemoryCandidateRequest): Promise<{
    readonly generationId: string;
    readonly records: readonly MemoryRetrievalRecord[];
    readonly candidates: readonly MemoryLexicalCandidate[];
  }>;
}

export interface MemoryVectorSourcePort {
  retrieve(request: MemoryCandidateRequest): Promise<{
    readonly status: SemanticStatus;
    readonly generationId?: string;
    readonly records: readonly MemoryRetrievalRecord[];
    readonly candidates: readonly MemoryVectorCandidate[];
  }>;
}

export interface MemorySearchHit {
  readonly rank: number;
  readonly fragmentId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string;
  readonly classification: Classification;
  readonly trust: "untrusted-data";
  readonly content: string;
  readonly contentDigest: string;
  readonly confidence: number;
  readonly provenance: {
    readonly sourceKind: SourceKind;
    readonly sourceId: string;
    readonly revision: string;
    readonly manifestRef: string;
    readonly retrievedAt: string;
    readonly validUntil: string | null;
    readonly contentDigest: string;
    readonly lexicalGenerationId: string | null;
    readonly vectorGenerationId: string | null;
  };
  readonly explanation: {
    readonly algorithm: "rrf-v1";
    readonly rrfConstant: number;
    readonly modalityRanks: { readonly lexical: number | null; readonly vector: number | null };
    readonly contributions: { readonly lexical: number; readonly vector: number };
    readonly providerSignals: { readonly lexicalScore: number | null; readonly vectorDistance: number | null };
    readonly rrfScore: number;
    readonly freshnessFactor: number;
    readonly finalScore: number;
    readonly tieBreaker: string;
  };
}

export interface MemorySearchOmission {
  readonly fragmentId: string;
  readonly priority: "normal";
  readonly reason: "result-limit";
  readonly estimatedSizeBytes: number;
  readonly affectsFreshness: false;
  readonly affectsConfidence: true;
}

export interface MemorySearchDegradation {
  readonly code: string;
  readonly affectsConfidence: true;
}

export interface MemorySearchExplanation {
  readonly algorithm: "policy-filter-rrf-v1";
  readonly policyRef: string;
  readonly policyEvidenceDigest: string;
  readonly classificationFilter: Classification;
  readonly maximumAgeSeconds: number;
  readonly scopeFilter: "workspace-project-exact";
  readonly inactiveAndStaleFilter: "enforced";
  readonly lexicalGenerationId: string;
  readonly vectorGenerationId: string | null;
  readonly semanticQueryDigest: string | null;
  readonly semanticStatus: SemanticStatus;
  readonly rrfConstant: number;
  readonly stableTieBreak: "fragment-id-ascending";
}

export interface MemorySearchResult {
  readonly schemaVersion: 1;
  readonly searchId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly queryDigest: string;
  readonly purpose: string;
  readonly evaluatedAt: string;
  readonly mode: "lexical" | "hybrid";
  readonly results: readonly MemorySearchHit[];
  readonly omissions: readonly MemorySearchOmission[];
  readonly degradations: readonly MemorySearchDegradation[];
  readonly explanation: MemorySearchExplanation;
}

type NormalizedPolicy = MemoryRetrievalPolicy;
interface NormalizedRecord extends MemoryRetrievalRecord {
  readonly logicalKey: string;
  readonly fragmentId: string;
  readonly retrievedAtMs: number;
  readonly validUntilMs: number | null;
}
interface NormalizedRank {
  readonly logicalKey: string;
  readonly contentDigest: string;
  readonly rank: number;
  readonly score: number;
}
interface FusionEntry {
  readonly record: NormalizedRecord;
  lexical?: NormalizedRank;
  vector?: NormalizedRank;
}

const CLASSIFICATIONS: readonly Classification[] = ["public", "internal", "confidential", "restricted", "secret"];
const SOURCE_KINDS: readonly SourceKind[] = ["repository", "tracker", "knowledge", "memory", "database"];
const STATES = ["active", "stale", "deleted", "superseded"] as const;
const SEMANTIC_MODES: readonly SemanticMode[] = ["disabled", "preferred", "required"];
const SEMANTIC_STATUSES: readonly SemanticStatus[] = ["ready", "disabled", "unavailable", "stale", "corrupt"];
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const RRF_CONSTANT = 60;
const MAX_CANDIDATES = 1_000;
const MAX_RECORDS = MAX_CANDIDATES * 2;
const MAX_CONTENT_BYTES = 10_000_000;

export class MemoryRetrievalError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MemoryRetrievalError";
    this.code = code;
  }
}

function fail(message: string): never {
  throw new MemoryRetrievalError("VES_MEMORY_RETRIEVAL_INVALID", message);
}

function integrity(message: string): never {
  throw new MemoryRetrievalError("VES_MEMORY_RETRIEVAL_INTEGRITY", message);
}

// This module's former private recursive serializer ordered object members
// with the ambient-locale `String.prototype.localeCompare`; `canonicalizeJsonV2`
// (RFC 8785, UTF-16 code-unit member order) replaces it at every call site
// below (issue #58). The logical key, the fragment ID and the search ID are all
// derived from these bytes, and a promoted memory artifact carries the fragment
// and search IDs into Git, so the encoder must not depend on the machine's
// collation.

// Code-unit comparison, not localeCompare: this is the stable tie-break the
// result explanation advertises as "fragment-id-ascending", so it fixes the
// emitted result ranks and therefore the searchId digest (issue #58).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sha256Bytes = (value: Uint8Array): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const rounded = (value: number, places: number): number => Number(value.toFixed(places));

function closed(value: unknown, name: string, keys: readonly string[]): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  const row = value as Row;
  const extras = Object.keys(row).filter((key) => !keys.includes(key));
  if (extras.length > 0) fail(`${name} contains unsupported fields: ${extras.sort().join(", ")}`);
  return row;
}

function safeId(value: unknown, name: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail(`${name} is invalid`);
  return value;
}

function qualifiedDigest(value: unknown, name: string): string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(`${name} is invalid`);
  return value;
}

function instant(value: unknown, name: string): { readonly value: string; readonly milliseconds: number } {
  if (typeof value !== "string") fail(`${name} is invalid`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(`${name} is invalid`);
  return { value, milliseconds };
}

function enumValue<T extends string>(value: unknown, values: readonly T[], name: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(`${name} is invalid`);
  return value as T;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${name} is invalid`);
  return value;
}

function logicalKey(value: {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly chunkId: string;
}): string {
  return canonicalizeJsonV2({
    workspaceId: value.workspaceId,
    projectId: value.projectId,
    sourceId: value.sourceId,
    chunkId: value.chunkId
  });
}

function normalizePolicy(value: unknown, workspaceId: string, projectId: string): NormalizedPolicy {
  const row = closed(value, "policy", [
    "decision",
    "policyRef",
    "evidenceDigest",
    "maximumClassification",
    "maximumAgeSeconds",
    "semanticMode",
    "workspaceId",
    "projectId",
    "purpose"
  ]);
  const decision = enumValue(row["decision"], ["allow", "deny"], "policy.decision");
  if (decision !== "allow" || row["workspaceId"] !== workspaceId || row["projectId"] !== projectId) {
    throw new MemoryRetrievalError("VES_MEMORY_POLICY_DENIED", "Memory retrieval policy denied the exact scope");
  }
  const maximumAgeSeconds = finite(row["maximumAgeSeconds"], "policy.maximumAgeSeconds");
  if (!Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 1 || maximumAgeSeconds > 31_536_000)
    fail("policy.maximumAgeSeconds is invalid");
  return Object.freeze({
    decision,
    policyRef: safeId(row["policyRef"], "policy.policyRef"),
    evidenceDigest: qualifiedDigest(row["evidenceDigest"], "policy.evidenceDigest"),
    maximumClassification: enumValue(row["maximumClassification"], CLASSIFICATIONS, "policy.maximumClassification"),
    maximumAgeSeconds,
    semanticMode: enumValue(row["semanticMode"], SEMANTIC_MODES, "policy.semanticMode"),
    workspaceId,
    projectId,
    purpose: safeId(row["purpose"], "policy.purpose")
  });
}

function scopeOf(value: unknown): { readonly row: Row; readonly workspaceId?: string; readonly projectId?: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return { row: {} };
  const row = value as Row;
  return {
    row,
    ...(typeof row["workspaceId"] === "string" ? { workspaceId: row["workspaceId"] } : {}),
    ...(typeof row["projectId"] === "string" ? { projectId: row["projectId"] } : {})
  };
}

function normalizeRecord(value: unknown): NormalizedRecord {
  const row = closed(value, "memory record", [
    "workspaceId",
    "projectId",
    "sourceId",
    "chunkId",
    "kind",
    "revision",
    "retrievedAt",
    "validUntil",
    "classification",
    "manifestRef",
    "content",
    "contentDigest",
    "state"
  ]);
  const workspaceId = safeId(row["workspaceId"], "record.workspaceId");
  const projectId = safeId(row["projectId"], "record.projectId");
  const sourceId = safeId(row["sourceId"], "record.sourceId");
  const chunkId = safeId(row["chunkId"], "record.chunkId");
  const retrievedAt = instant(row["retrievedAt"], "record.retrievedAt");
  const validUntil = row["validUntil"] === null ? null : instant(row["validUntil"], "record.validUntil");
  if (validUntil !== null && validUntil.milliseconds <= retrievedAt.milliseconds)
    fail("record.validUntil must be after retrievedAt");
  if (typeof row["content"] !== "string" || /\u0000/u.test(row["content"])) fail("record.content is invalid");
  const content = row["content"];
  if (Buffer.byteLength(content, "utf8") > MAX_CONTENT_BYTES) fail("record.content exceeds its bound");
  const normalized = {
    workspaceId,
    projectId,
    sourceId,
    chunkId,
    kind: enumValue(row["kind"], SOURCE_KINDS, "record.kind"),
    revision: safeId(row["revision"], "record.revision"),
    retrievedAt: retrievedAt.value,
    validUntil: validUntil?.value ?? null,
    classification: enumValue(row["classification"], CLASSIFICATIONS, "record.classification"),
    manifestRef: safeId(row["manifestRef"], "record.manifestRef"),
    content,
    contentDigest: qualifiedDigest(row["contentDigest"], "record.contentDigest"),
    state: enumValue(row["state"], STATES, "record.state"),
    logicalKey: logicalKey({ workspaceId, projectId, sourceId, chunkId }),
    fragmentId: sha256(
      canonicalizeJsonV2({ workspaceId, projectId, sourceId, chunkId, contentDigest: row["contentDigest"] })
    ),
    retrievedAtMs: retrievedAt.milliseconds,
    validUntilMs: validUntil?.milliseconds ?? null
  } satisfies NormalizedRecord;
  return Object.freeze(normalized);
}

function normalizeRank(
  value: unknown,
  modality: "lexical" | "vector",
  workspaceId: string,
  projectId: string
): NormalizedRank | undefined {
  const scoped = scopeOf(value);
  if (scoped.workspaceId !== workspaceId || scoped.projectId !== projectId) return undefined;
  const keys = ["workspaceId", "projectId", "sourceId", "chunkId", "contentDigest", "rank"];
  const row = closed(value, `${modality} candidate`, [...keys, modality === "lexical" ? "lexicalScore" : "distance"]);
  const sourceId = safeId(row["sourceId"], `${modality}.sourceId`);
  const chunkId = safeId(row["chunkId"], `${modality}.chunkId`);
  const rank = finite(row["rank"], `${modality}.rank`);
  if (!Number.isSafeInteger(rank) || rank < 1 || rank > MAX_CANDIDATES) fail(`${modality}.rank is invalid`);
  const score = finite(
    row[modality === "lexical" ? "lexicalScore" : "distance"],
    `${modality}.${modality === "lexical" ? "lexicalScore" : "distance"}`
  );
  if (modality === "vector" && score < 0) fail("vector.distance is invalid");
  return Object.freeze({
    logicalKey: logicalKey({ workspaceId, projectId, sourceId, chunkId }),
    rank,
    score,
    contentDigest: qualifiedDigest(row["contentDigest"], `${modality}.contentDigest`)
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const entry of Object.values(value as Row)) deepFreeze(entry);
    Object.freeze(value);
  }
  return value;
}

function normalizeRanks(
  values: unknown,
  modality: "lexical" | "vector",
  workspaceId: string,
  projectId: string,
  known: ReadonlySet<string>,
  eligible: ReadonlyMap<string, NormalizedRecord>
): readonly NormalizedRank[] {
  if (!Array.isArray(values) || values.length > MAX_CANDIDATES) fail(`${modality}.candidates is invalid`);
  const ranks = new Set<number>();
  const identities = new Set<string>();
  const normalized: NormalizedRank[] = [];
  for (const value of values) {
    const candidate = normalizeRank(value, modality, workspaceId, projectId);
    if (candidate === undefined) continue;
    if (!known.has(candidate.logicalKey)) integrity(`${modality} candidate has no authoritative memory record`);
    const record = eligible.get(candidate.logicalKey);
    if (record === undefined) continue;
    if (record.contentDigest !== candidate.contentDigest) integrity(`${modality} candidate content binding is invalid`);
    if (ranks.has(candidate.rank) || identities.has(candidate.logicalKey)) fail(`${modality} ranks are not unique`);
    ranks.add(candidate.rank);
    identities.add(candidate.logicalKey);
    normalized.push(candidate);
  }
  return Object.freeze(normalized.sort((left, right) => left.rank - right.rank));
}

function semanticDescriptor(
  value: unknown,
  policy: NormalizedPolicy
): {
  readonly status: SemanticStatus;
  readonly generationId: string | null;
  readonly candidates: unknown;
} {
  if (policy.semanticMode === "disabled") return { status: "disabled", generationId: null, candidates: [] };
  if (value === undefined) return { status: "unavailable", generationId: null, candidates: [] };
  const row = closed(value, "vector retrieval", ["status", "generationId", "candidates"]);
  const status = enumValue(row["status"], SEMANTIC_STATUSES, "vector.status");
  if (!Array.isArray(row["candidates"])) fail("vector.candidates is invalid");
  const generationId = status === "ready" ? qualifiedDigest(row["generationId"], "vector.generationId") : null;
  if (status !== "ready" && (row["generationId"] !== undefined || row["candidates"].length > 0))
    fail("unavailable vector retrieval cannot contain candidates");
  if (policy.semanticMode === "required" && status !== "ready")
    throw new MemoryRetrievalError(
      "VES_MEMORY_SEMANTIC_REQUIRED",
      "The selected profile requires a verified semantic generation"
    );
  return { status, generationId, candidates: row["candidates"] };
}

function degradation(status: SemanticStatus, policy: NormalizedPolicy): readonly MemorySearchDegradation[] {
  if (policy.semanticMode === "disabled" || status === "ready") return Object.freeze([]);
  return Object.freeze([Object.freeze({ code: `semantic-${status}`, affectsConfidence: true })]);
}

export class ExplainableMemoryRetriever {
  search(value: unknown): MemorySearchResult {
    const row = closed(value, "memory retrieval", [
      "schemaVersion",
      "workspaceId",
      "projectId",
      "query",
      "purpose",
      "semanticQueryDigest",
      "evaluatedAt",
      "limit",
      "policy",
      "records",
      "lexical",
      "vector"
    ]);
    if (row["schemaVersion"] !== 1) fail("schemaVersion must equal 1");
    const workspaceId = safeId(row["workspaceId"], "workspaceId");
    const projectId = safeId(row["projectId"], "projectId");
    if (typeof row["query"] !== "string" || row["query"].trim().length === 0 || row["query"].length > 8_192)
      fail("query is invalid");
    const query = row["query"];
    const purpose = safeId(row["purpose"], "purpose");
    const semanticQueryDigest =
      row["semanticQueryDigest"] === undefined
        ? undefined
        : qualifiedDigest(row["semanticQueryDigest"], "semanticQueryDigest");
    const evaluatedAt = instant(row["evaluatedAt"], "evaluatedAt");
    const limit = finite(row["limit"], "limit");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("limit is invalid");

    // Policy is deliberately resolved before any candidate content is interpreted.
    const policy = normalizePolicy(row["policy"], workspaceId, projectId);
    if (policy.purpose !== purpose)
      throw new MemoryRetrievalError("VES_MEMORY_POLICY_DENIED", "Memory retrieval policy denied the exact purpose");
    const semantic = semanticDescriptor(row["vector"], policy);
    const lexicalRow = closed(row["lexical"], "lexical retrieval", ["generationId", "candidates"]);
    const lexicalGenerationId = qualifiedDigest(lexicalRow["generationId"], "lexical.generationId");
    if (!Array.isArray(lexicalRow["candidates"])) fail("lexical.candidates is invalid");
    if (!Array.isArray(row["records"]) || row["records"].length > MAX_RECORDS) fail("records are invalid");

    const known = new Set<string>();
    const eligible = new Map<string, NormalizedRecord>();
    const maximumClassificationRank = CLASSIFICATIONS.indexOf(policy.maximumClassification);
    for (const value of row["records"]) {
      const scope = scopeOf(value);
      if (scope.workspaceId !== workspaceId || scope.projectId !== projectId) continue;
      const record = normalizeRecord(value);
      if (known.has(record.logicalKey)) fail("authoritative record identities must be unique");
      known.add(record.logicalKey);
      const ageMs = evaluatedAt.milliseconds - record.retrievedAtMs;
      const policyEligible =
        record.state === "active" &&
        ageMs >= 0 &&
        ageMs <= policy.maximumAgeSeconds * 1_000 &&
        (record.validUntilMs === null || record.validUntilMs > evaluatedAt.milliseconds) &&
        CLASSIFICATIONS.indexOf(record.classification) <= maximumClassificationRank;
      if (!policyEligible) continue;
      if (sha256(record.content) !== record.contentDigest) integrity("authoritative record content digest is invalid");
      eligible.set(record.logicalKey, record);
    }

    const lexical = normalizeRanks(lexicalRow["candidates"], "lexical", workspaceId, projectId, known, eligible);
    const vector =
      semantic.status === "ready"
        ? normalizeRanks(semantic.candidates, "vector", workspaceId, projectId, known, eligible)
        : Object.freeze([]);

    const fusion = new Map<string, FusionEntry>();
    for (const candidate of lexical) {
      const record = eligible.get(candidate.logicalKey);
      if (record !== undefined) fusion.set(candidate.logicalKey, { record, lexical: candidate });
    }
    for (const candidate of vector) {
      const record = eligible.get(candidate.logicalKey);
      if (record === undefined) continue;
      const current = fusion.get(candidate.logicalKey) ?? { record };
      current.vector = candidate;
      fusion.set(candidate.logicalKey, current);
    }

    const mode: "hybrid" | "lexical" = semantic.status === "ready" ? "hybrid" : "lexical";
    if (mode === "hybrid" && semanticQueryDigest === undefined) fail("semanticQueryDigest is required in hybrid mode");
    const activeSemanticQueryDigest = mode === "hybrid" ? (semanticQueryDigest as string) : null;
    const idealRrf = (mode === "hybrid" ? 2 : 1) / (RRF_CONSTANT + 1);
    const scored = [...fusion.values()].map((entry) => {
      const lexicalContribution = entry.lexical === undefined ? 0 : 1 / (RRF_CONSTANT + entry.lexical.rank);
      const vectorContribution = entry.vector === undefined ? 0 : 1 / (RRF_CONSTANT + entry.vector.rank);
      const rrfScore = lexicalContribution + vectorContribution;
      const ageRatio = Math.min(
        1,
        Math.max(0, (evaluatedAt.milliseconds - entry.record.retrievedAtMs) / (policy.maximumAgeSeconds * 1_000))
      );
      const freshnessFactor = 1 - ageRatio * 0.5;
      const confidence = rounded(Math.min(1, (rrfScore / idealRrf) * freshnessFactor), 6);
      return {
        ...entry,
        lexicalContribution,
        vectorContribution,
        rrfScore,
        freshnessFactor,
        confidence,
        finalScore: rrfScore * freshnessFactor
      };
    });
    scored.sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        right.rrfScore - left.rrfScore ||
        codeUnitCompare(left.record.logicalKey, right.record.logicalKey)
    );

    const materialize = (entry: (typeof scored)[number], rank: number) =>
      Object.freeze({
        rank,
        fragmentId: entry.record.fragmentId,
        workspaceId,
        projectId,
        sourceId: entry.record.sourceId,
        chunkId: entry.record.chunkId,
        classification: entry.record.classification,
        trust: "untrusted-data",
        content: entry.record.content,
        contentDigest: entry.record.contentDigest,
        confidence: entry.confidence,
        provenance: Object.freeze({
          sourceKind: entry.record.kind,
          sourceId: entry.record.sourceId,
          revision: entry.record.revision,
          manifestRef: entry.record.manifestRef,
          retrievedAt: entry.record.retrievedAt,
          validUntil: entry.record.validUntil,
          contentDigest: entry.record.contentDigest,
          lexicalGenerationId: entry.lexical === undefined ? null : lexicalGenerationId,
          vectorGenerationId: entry.vector === undefined ? null : semantic.generationId
        }),
        explanation: Object.freeze({
          algorithm: "rrf-v1",
          rrfConstant: RRF_CONSTANT,
          modalityRanks: Object.freeze({
            lexical: entry.lexical?.rank ?? null,
            vector: entry.vector?.rank ?? null
          }),
          contributions: Object.freeze({
            lexical: rounded(entry.lexicalContribution, 12),
            vector: rounded(entry.vectorContribution, 12)
          }),
          providerSignals: Object.freeze({
            lexicalScore: entry.lexical?.score ?? null,
            vectorDistance: entry.vector?.score ?? null
          }),
          rrfScore: rounded(entry.rrfScore, 12),
          freshnessFactor: rounded(entry.freshnessFactor, 6),
          finalScore: rounded(entry.finalScore, 12),
          tieBreaker: entry.record.fragmentId
        })
      });

    const results = Object.freeze(scored.slice(0, limit).map((entry, index) => materialize(entry, index + 1)));
    const omissions = Object.freeze(
      scored.slice(limit).map((entry) =>
        Object.freeze({
          fragmentId: entry.record.fragmentId,
          priority: "normal",
          reason: "result-limit",
          estimatedSizeBytes: Buffer.byteLength(entry.record.content, "utf8"),
          affectsFreshness: false,
          affectsConfidence: true
        })
      )
    );
    const degradations = degradation(semantic.status, policy);
    const explanation = Object.freeze({
      algorithm: "policy-filter-rrf-v1",
      policyRef: policy.policyRef,
      policyEvidenceDigest: policy.evidenceDigest,
      classificationFilter: policy.maximumClassification,
      maximumAgeSeconds: policy.maximumAgeSeconds,
      scopeFilter: "workspace-project-exact",
      inactiveAndStaleFilter: "enforced",
      lexicalGenerationId,
      vectorGenerationId: mode === "hybrid" ? semantic.generationId : null,
      semanticQueryDigest: activeSemanticQueryDigest,
      semanticStatus: semantic.status,
      rrfConstant: RRF_CONSTANT,
      stableTieBreak: "fragment-id-ascending"
    });
    const payload = {
      schemaVersion: 1 as const,
      workspaceId,
      projectId,
      queryDigest: sha256(query),
      purpose,
      evaluatedAt: evaluatedAt.value,
      mode,
      results,
      omissions,
      degradations,
      explanation
    };
    return deepFreeze({ ...payload, searchId: sha256(canonicalizeJsonV2(payload)) });
  }
}

function normalizeRequest(value: unknown): MemoryRetrievalRequest {
  const row = closed(value, "memory retrieval request", [
    "schemaVersion",
    "workspaceId",
    "projectId",
    "query",
    "purpose",
    "evaluatedAt",
    "limit",
    "embedding"
  ]);
  if (row["schemaVersion"] !== 1) fail("schemaVersion must equal 1");
  if (typeof row["query"] !== "string" || row["query"].trim().length === 0 || row["query"].length > 8_192)
    fail("query is invalid");
  const limit = finite(row["limit"], "limit");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("limit is invalid");
  let embedding: readonly number[] | undefined;
  if (row["embedding"] !== undefined) {
    if (!Array.isArray(row["embedding"]) || row["embedding"].length < 1 || row["embedding"].length > 4_096)
      fail("embedding is invalid");
    embedding = Object.freeze(
      row["embedding"].map((entry) => {
        const normalized = Math.fround(finite(entry, "embedding value"));
        if (!Number.isFinite(normalized)) fail("embedding value is invalid");
        return normalized;
      })
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    workspaceId: safeId(row["workspaceId"], "workspaceId"),
    projectId: safeId(row["projectId"], "projectId"),
    query: row["query"],
    purpose: safeId(row["purpose"], "purpose"),
    evaluatedAt: instant(row["evaluatedAt"], "evaluatedAt").value,
    limit,
    ...(embedding === undefined ? {} : { embedding })
  });
}

function digestEmbedding(values: readonly number[]): string {
  const bytes = new Uint8Array(values.length * Float32Array.BYTES_PER_ELEMENT);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, value, true));
  return sha256Bytes(bytes);
}

function sourceError(): MemoryRetrievalError {
  return new MemoryRetrievalError(
    "VES_MEMORY_RETRIEVAL_SOURCE",
    "A memory candidate source failed without producing retrieval output"
  );
}

function normalizeLexicalResponse(value: unknown): {
  readonly generationId: string;
  readonly records: readonly MemoryRetrievalRecord[];
  readonly candidates: readonly MemoryLexicalCandidate[];
} {
  const row = closed(value, "lexical source response", ["generationId", "records", "candidates"]);
  if (
    !Array.isArray(row["records"]) ||
    row["records"].length > MAX_CANDIDATES ||
    !Array.isArray(row["candidates"]) ||
    row["candidates"].length > MAX_CANDIDATES
  )
    fail("lexical source response is invalid");
  return Object.freeze({
    generationId: qualifiedDigest(row["generationId"], "lexical source generationId"),
    records: Object.freeze([...row["records"]]) as readonly MemoryRetrievalRecord[],
    candidates: Object.freeze([...row["candidates"]]) as readonly MemoryLexicalCandidate[]
  });
}

function normalizeVectorResponse(value: unknown): {
  readonly status: SemanticStatus;
  readonly generationId?: string;
  readonly records: readonly MemoryRetrievalRecord[];
  readonly candidates: readonly MemoryVectorCandidate[];
} {
  const row = closed(value, "vector source response", ["status", "generationId", "records", "candidates"]);
  const status = enumValue(row["status"], SEMANTIC_STATUSES, "vector source status");
  if (
    !Array.isArray(row["records"]) ||
    row["records"].length > MAX_CANDIDATES ||
    !Array.isArray(row["candidates"]) ||
    row["candidates"].length > MAX_CANDIDATES
  )
    fail("vector source response is invalid");
  if (
    status !== "ready" &&
    (row["generationId"] !== undefined || row["records"].length > 0 || row["candidates"].length > 0)
  )
    fail("unavailable vector source returned candidate material");
  return Object.freeze({
    status,
    ...(status === "ready" ? { generationId: qualifiedDigest(row["generationId"], "vector source generationId") } : {}),
    records: Object.freeze([...row["records"]]) as readonly MemoryRetrievalRecord[],
    candidates: Object.freeze([...row["candidates"]]) as readonly MemoryVectorCandidate[]
  });
}

function mergeSourceRecords(
  lexical: readonly MemoryRetrievalRecord[],
  vector: readonly MemoryRetrievalRecord[]
): readonly MemoryRetrievalRecord[] {
  const merged: MemoryRetrievalRecord[] = [];
  const fingerprints = new Map<string, string>();
  for (const value of [...lexical, ...vector]) {
    const scope = scopeOf(value);
    const row = scope.row;
    if (
      scope.workspaceId === undefined ||
      scope.projectId === undefined ||
      typeof row["sourceId"] !== "string" ||
      typeof row["chunkId"] !== "string"
    ) {
      merged.push(value);
      continue;
    }
    const key = logicalKey({
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      sourceId: row["sourceId"],
      chunkId: row["chunkId"]
    });
    // A source port's record is untrusted and not yet validated here.
    // `canonicalizeJsonV2` rejects material the old serializer silently
    // encoded (an `undefined` member, a cycle, a non-plain prototype); such a
    // record is kept rather than deduplicated, so the strict record
    // normalization downstream still reports it under this module's own error
    // codes instead of a canonicalization failure escaping the merge.
    let fingerprint: string;
    try {
      fingerprint = canonicalizeJsonV2(value);
    } catch {
      merged.push(value);
      continue;
    }
    if (fingerprints.get(key) === fingerprint) continue;
    fingerprints.set(key, fingerprint);
    merged.push(value);
  }
  return Object.freeze(merged);
}

export class PolicyFilteredMemoryRetrievalService {
  readonly #policy: MemoryRetrievalPolicyPort;
  readonly #lexical: MemoryLexicalSourcePort;
  readonly #vector: MemoryVectorSourcePort | undefined;
  readonly #ranker = new ExplainableMemoryRetriever();

  constructor(options: {
    readonly policy: MemoryRetrievalPolicyPort;
    readonly lexical: MemoryLexicalSourcePort;
    readonly vector?: MemoryVectorSourcePort;
  }) {
    this.#policy = options.policy;
    this.#lexical = options.lexical;
    this.#vector = options.vector;
  }

  async search(value: unknown): Promise<MemorySearchResult> {
    const request = normalizeRequest(value);
    const queryDigest = sha256(request.query);
    const semanticQueryDigest = request.embedding === undefined ? undefined : digestEmbedding(request.embedding);
    const policyRequest = deepFreeze({
      schemaVersion: 1 as const,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      purpose: request.purpose,
      queryDigest,
      evaluatedAt: request.evaluatedAt,
      requestedLimit: request.limit,
      semanticRequested: request.embedding !== undefined,
      ...(semanticQueryDigest === undefined ? {} : { embeddingDigest: semanticQueryDigest })
    });

    let policy: NormalizedPolicy;
    try {
      policy = normalizePolicy(await this.#policy.authorize(policyRequest), request.workspaceId, request.projectId);
      if (policy.purpose !== request.purpose)
        throw new MemoryRetrievalError("VES_MEMORY_POLICY_DENIED", "Memory retrieval policy denied the exact purpose");
    } catch {
      throw new MemoryRetrievalError("VES_MEMORY_POLICY_DENIED", "Memory retrieval policy denied the request");
    }

    const candidateRequest = deepFreeze({
      schemaVersion: 1 as const,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      query: request.query,
      queryDigest,
      purpose: request.purpose,
      evaluatedAt: request.evaluatedAt,
      candidateLimit: MAX_CANDIDATES,
      maximumClassification: policy.maximumClassification,
      maximumAgeSeconds: policy.maximumAgeSeconds,
      ...(request.embedding === undefined ? {} : { embedding: request.embedding })
    });

    let lexical: ReturnType<typeof normalizeLexicalResponse>;
    try {
      lexical = normalizeLexicalResponse(await this.#lexical.retrieve(candidateRequest));
    } catch {
      throw sourceError();
    }

    let vector: ReturnType<typeof normalizeVectorResponse> | undefined;
    if (policy.semanticMode !== "disabled") {
      if (request.embedding === undefined || this.#vector === undefined) {
        vector = Object.freeze({ status: "unavailable", records: Object.freeze([]), candidates: Object.freeze([]) });
      } else {
        try {
          vector = normalizeVectorResponse(await this.#vector.retrieve(candidateRequest));
        } catch {
          vector = Object.freeze({ status: "unavailable", records: Object.freeze([]), candidates: Object.freeze([]) });
        }
      }
    }

    return this.#ranker.search({
      schemaVersion: 1,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      query: request.query,
      purpose: request.purpose,
      ...(semanticQueryDigest === undefined ? {} : { semanticQueryDigest }),
      evaluatedAt: request.evaluatedAt,
      limit: request.limit,
      policy,
      records: mergeSourceRecords(lexical.records, vector?.records ?? []),
      lexical: { generationId: lexical.generationId, candidates: lexical.candidates },
      ...(vector === undefined
        ? {}
        : {
            vector: {
              status: vector.status,
              ...(vector.generationId === undefined ? {} : { generationId: vector.generationId }),
              candidates: vector.candidates
            }
          })
    });
  }
}
