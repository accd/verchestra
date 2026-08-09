import type { ContextDigestPort } from "./source-snapshots.ts";
import type { ContextManifest } from "./context-compiler.ts";
import { estimateQualifiedTokens } from "./token-estimator.ts";

const TARGETS = ["pi", "claude-code", "codex", "opencode"] as const;
const PREFIX = "VERCHESTRA_CONTEXT_V1\n";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TRUST = ["authority", "verified-evidence", "untrusted-data", "generated-content"] as const;

export type ContextBackendTarget = (typeof TARGETS)[number];

export class ContextSerializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContextSerializationError";
    this.code = code;
  }
}

export interface ContextCapacityEstimatorPort {
  estimate(target: ContextBackendTarget, serialized: Readonly<Record<string, unknown>>): number;
}

// The second estimation surface, on the same qualified primitive. Two surfaces
// with independent heuristics is how the repository ended up with three
// different token counts for the same text (AD-015); this leaves exactly one.
// The target does not change the estimate: a serialized context costs what its
// bytes cost, and a per-target divergence would reintroduce the very
// machine-dependence the qualified estimator exists to remove.
export const qualifiedCapacityEstimator: ContextCapacityEstimatorPort = Object.freeze({
  estimate(_target: ContextBackendTarget, serialized: Readonly<Record<string, unknown>>): number {
    return estimateQualifiedTokens(JSON.stringify(serialized));
  }
});

export interface NeutralSemanticTree {
  readonly semanticObligations: readonly string[];
  readonly fragments: readonly {
    readonly fragmentId: string;
    readonly source: { readonly kind: string; readonly identity: string; readonly revision: string };
    readonly classification: string;
    readonly trust: (typeof TRUST)[number];
    readonly contentDigest: string;
    readonly content: string;
  }[];
}

export interface SerializedContext {
  readonly schemaVersion: 1;
  readonly target: ContextBackendTarget;
  readonly manifestId: string;
  readonly meaningDigest: string;
  readonly estimatedTokens: number;
  readonly transport: Readonly<Record<string, unknown>>;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: string, message: string): never {
  throw new ContextSerializationError(code, message);
}

function treeFor(manifest: ContextManifest): NeutralSemanticTree {
  return deepFreeze({
    semanticObligations: [...manifest.semanticObligations],
    fragments: manifest.fragments.map((entry) => ({
      fragmentId: entry.fragmentId,
      source: { ...entry.source },
      classification: entry.classification,
      trust: entry.trust,
      contentDigest: entry.contentDigest,
      content: entry.content
    }))
  });
}

function transportFor(target: ContextBackendTarget, text: string): Readonly<Record<string, unknown>> {
  switch (target) {
    case "pi":
      return deepFreeze({
        systemPrompt: "",
        prompt: text
      });
    case "claude-code":
      return deepFreeze({
        streamJson: {
          type: "user",
          message: { role: "user", content: [{ type: "text", text }] }
        }
      });
    case "codex":
      return deepFreeze({ input: [{ type: "text", text }] });
    case "opencode":
      return deepFreeze({ parts: [{ type: "text", text }] });
  }
}

function exactText(serialized: SerializedContext): string {
  const transport = serialized.transport;
  switch (serialized.target) {
    case "pi": {
      if (
        Object.keys(transport).sort().join(",") !== "prompt,systemPrompt" ||
        typeof transport["prompt"] !== "string" ||
        transport["systemPrompt"] !== ""
      )
        fail("VES_CONTEXT_SERIALIZATION_INVALID", "Pi context envelope is invalid");
      return transport["prompt"];
    }
    case "claude-code": {
      const stream = transport["streamJson"] as Readonly<Record<string, unknown>> | undefined;
      const message = stream?.["message"] as Readonly<Record<string, unknown>> | undefined;
      const content = message?.["content"] as readonly Readonly<Record<string, unknown>>[] | undefined;
      if (
        Object.keys(transport).join(",") !== "streamJson" ||
        stream?.["type"] !== "user" ||
        message?.["role"] !== "user" ||
        content?.length !== 1 ||
        content[0]?.["type"] !== "text" ||
        typeof content[0]?.["text"] !== "string"
      )
        fail("VES_CONTEXT_SERIALIZATION_INVALID", "Claude Code context envelope is invalid");
      return content[0]["text"] as string;
    }
    case "codex": {
      const input = transport["input"] as readonly Readonly<Record<string, unknown>>[] | undefined;
      if (
        Object.keys(transport).join(",") !== "input" ||
        input?.length !== 1 ||
        input[0]?.["type"] !== "text" ||
        typeof input[0]?.["text"] !== "string"
      )
        fail("VES_CONTEXT_SERIALIZATION_INVALID", "Codex context envelope is invalid");
      return input[0]["text"] as string;
    }
    case "opencode": {
      const parts = transport["parts"] as readonly Readonly<Record<string, unknown>>[] | undefined;
      if (
        Object.keys(transport).join(",") !== "parts" ||
        parts?.length !== 1 ||
        parts[0]?.["type"] !== "text" ||
        typeof parts[0]?.["text"] !== "string"
      )
        fail("VES_CONTEXT_SERIALIZATION_INVALID", "OpenCode context envelope is invalid");
      return parts[0]["text"] as string;
    }
  }
}

function validateTree(value: unknown, digest: ContextDigestPort): NeutralSemanticTree {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_CONTEXT_SERIALIZATION_INVALID", "Semantic tree is invalid");
  const tree = value as Partial<NeutralSemanticTree>;
  if (
    Object.keys(tree).sort().join(",") !== "fragments,semanticObligations" ||
    !Array.isArray(tree.semanticObligations) ||
    !Array.isArray(tree.fragments)
  )
    fail("VES_CONTEXT_SERIALIZATION_INVALID", "Semantic tree is incomplete");
  if (tree.semanticObligations.some((entry) => typeof entry !== "string" || entry.length === 0))
    fail("VES_CONTEXT_SERIALIZATION_INVALID", "Semantic obligations are invalid");
  const ids = new Set<string>();
  for (const fragment of tree.fragments) {
    if (
      fragment === null ||
      typeof fragment !== "object" ||
      Object.keys(fragment).sort().join(",") !== "classification,content,contentDigest,fragmentId,source,trust" ||
      typeof fragment.fragmentId !== "string" ||
      ids.has(fragment.fragmentId) ||
      fragment.source === null ||
      typeof fragment.source !== "object" ||
      Object.keys(fragment.source).sort().join(",") !== "identity,kind,revision" ||
      typeof fragment.source.kind !== "string" ||
      typeof fragment.source.identity !== "string" ||
      typeof fragment.source.revision !== "string" ||
      typeof fragment.classification !== "string" ||
      !TRUST.includes(fragment.trust) ||
      typeof fragment.content !== "string" ||
      !DIGEST.test(fragment.contentDigest) ||
      fragment.contentDigest !== digest.sha256(fragment.content)
    )
      fail("VES_CONTEXT_SERIALIZATION_INVALID", "Semantic fragment is invalid");
    ids.add(fragment.fragmentId);
  }
  return deepFreeze(value as NeutralSemanticTree);
}

export class BackendContextSerializer {
  readonly #digest: ContextDigestPort;
  readonly #capacity: ContextCapacityEstimatorPort;

  constructor(options: { readonly digest: ContextDigestPort; readonly capacity?: ContextCapacityEstimatorPort }) {
    this.#digest = options.digest;
    // Same rule as the compiler's estimator: an override, never a requirement.
    this.#capacity = options.capacity ?? qualifiedCapacityEstimator;
  }

  serialize(input: {
    readonly manifest: ContextManifest;
    readonly target: ContextBackendTarget;
    readonly maximumInputTokens: number;
  }): SerializedContext {
    if (!TARGETS.includes(input.target))
      fail("VES_CONTEXT_SERIALIZATION_TARGET_UNSUPPORTED", "Context backend target is unsupported");
    if (!Number.isSafeInteger(input.maximumInputTokens) || input.maximumInputTokens <= 0)
      fail("VES_CONTEXT_CAPACITY_ESTIMATE_INVALID", "Qualified context capacity is invalid");
    const tree = treeFor(input.manifest);
    const meaningDigest = this.#digest.sha256(canonicalJson(tree));
    if (meaningDigest !== input.manifest.serializedMeaningDigest)
      fail("VES_CONTEXT_SERIALIZATION_INVALID", "Manifest meaning digest is invalid");
    const transport = transportFor(input.target, `${PREFIX}${canonicalJson(tree)}`);
    let estimatedTokens: number;
    try {
      estimatedTokens = this.#capacity.estimate(input.target, transport);
    } catch {
      fail("VES_CONTEXT_CAPACITY_ESTIMATE_INVALID", "Context capacity estimate failed");
    }
    if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens <= 0)
      fail("VES_CONTEXT_CAPACITY_ESTIMATE_INVALID", "Context capacity estimate is invalid");
    if (estimatedTokens > input.maximumInputTokens)
      fail("VES_CONTEXT_SERIALIZATION_INELIGIBLE", "Serialized context exceeds qualified capacity");
    return deepFreeze({
      schemaVersion: 1,
      target: input.target,
      manifestId: input.manifest.manifestId,
      meaningDigest,
      estimatedTokens,
      transport
    });
  }
}

export class SemanticEquivalenceOracle {
  readonly #digest: ContextDigestPort;

  constructor(options: { readonly digest: ContextDigestPort }) {
    this.#digest = options.digest;
  }

  extract(serialized: SerializedContext): NeutralSemanticTree {
    if (serialized.schemaVersion !== 1 || !TARGETS.includes(serialized.target))
      fail("VES_CONTEXT_SERIALIZATION_INVALID", "Serialized context identity is invalid");
    const text = exactText(serialized);
    if (!text.startsWith(PREFIX)) fail("VES_CONTEXT_SERIALIZATION_INVALID", "Structured context boundary is missing");
    const payload = text.slice(PREFIX.length);
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      fail("VES_CONTEXT_SERIALIZATION_INVALID", "Structured context JSON is invalid");
    }
    const tree = validateTree(parsed, this.#digest);
    if (payload !== canonicalJson(tree))
      fail("VES_CONTEXT_SERIALIZATION_INVALID", "Structured context is not canonical");
    if (serialized.meaningDigest !== this.#digest.sha256(canonicalJson(tree)))
      fail("VES_CONTEXT_SERIALIZATION_INVALID", "Serialized meaning digest is invalid");
    return tree;
  }

  verify(serialized: SerializedContext, expectedMeaningDigest: string) {
    try {
      const tree = this.extract(serialized);
      const meaningDigest = this.#digest.sha256(canonicalJson(tree));
      return deepFreeze({ equivalent: meaningDigest === expectedMeaningDigest, meaningDigest });
    } catch {
      return deepFreeze({ equivalent: false, meaningDigest: "invalid" });
    }
  }

  compare(left: SerializedContext, right: SerializedContext) {
    const leftDigest = this.#digest.sha256(canonicalJson(this.extract(left)));
    const rightDigest = this.#digest.sha256(canonicalJson(this.extract(right)));
    return deepFreeze({ equivalent: leftDigest === rightDigest, meaningDigest: leftDigest });
  }
}
