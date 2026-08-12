import {
  TrustEnvelopeService,
  type ContextSourceKind,
  type ContextSourceObservation,
  type ContextSourcePort,
  type ContextSourceQuery,
  type TrustClass,
  type TrustEnvelope
} from "@verchestra/application";
import {
  DataClassification,
  IsoInstant,
  StableId,
  canonicalizeJsonV2,
  type DataClassificationValue
} from "@verchestra/domain";

import { codeUnitCompare } from "./code-unit-compare.ts";

const SOURCE_KINDS = ["repository", "tracker", "knowledge", "memory"] as const;
const PRIORITIES = ["mandatory", "high", "medium", "low"] as const;
const SAFE_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,511}$/u;
const TRUST_CLASSES = ["verified-evidence", "untrusted-data"] as const;

export type ContextSourceStatus =
  "available" | "missing" | "unavailable" | "stale" | "outside-scope" | "revision-mismatch";

export class ContextSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContextSourceError";
    this.code = code;
  }
}

export interface ContextDigestPort {
  sha256(value: string): string;
}

export interface ContextSourceSelector {
  readonly selectorId: string;
  readonly sourceKind: ContextSourceKind;
  readonly sourceId: string;
  readonly query: Readonly<Record<string, unknown>>;
  readonly maximumAgeSeconds?: number;
  readonly expectedRevision?: string;
  readonly classification: DataClassificationValue;
  readonly priority?: "mandatory" | "high" | "medium" | "low";
}

export interface ContextRecipe {
  readonly schemaVersion: 1;
  readonly recipeId: string;
  readonly taskId: string;
  readonly requiredSources: readonly ContextSourceSelector[];
  readonly optionalSources: readonly ContextSourceSelector[];
  readonly semanticObligations: readonly string[];
  readonly priorityBudgets: readonly {
    readonly priority: (typeof PRIORITIES)[number];
    readonly maximumTokens: number;
  }[];
  readonly freshnessPolicy: { readonly defaultMaximumAgeSeconds: number };
  readonly trustPolicyRef: string;
  readonly egressPurpose: string;
}

export type {
  ContextClaimInput,
  ContextFragmentInput,
  ContextSourceKind,
  ContextSourceObservation,
  ContextSourcePort,
  ContextSourceQuery
} from "@verchestra/application";

export interface ContextSourcePorts {
  readonly repository: ContextSourcePort;
  readonly tracker: ContextSourcePort;
  readonly knowledge: ContextSourcePort;
  readonly memory: ContextSourcePort;
}

export interface ResolvedContextFragment extends TrustEnvelope {
  readonly claims: readonly {
    readonly factKey: string;
    readonly value: string;
    readonly valueDigest: string;
  }[];
}

export interface ResolvedContextSource {
  readonly selectorId: string;
  readonly sourceKind: ContextSourceKind;
  readonly sourceId: string;
  readonly required: boolean;
  readonly status: ContextSourceStatus;
  readonly affectsFreshness: boolean;
  readonly affectsConfidence: boolean;
  readonly fragments: readonly ResolvedContextFragment[];
  readonly sourceRevision?: string;
  readonly actualRevision?: string;
  readonly retrievedAt?: string;
  readonly ageSeconds?: number;
}

export interface ContextSnapshot {
  readonly schemaVersion: 1;
  readonly snapshotId: string;
  readonly workspaceId: string;
  readonly recipeId: string;
  readonly recipeDigest: string;
  readonly evaluatedAt: string;
  readonly sources: readonly ResolvedContextSource[];
  readonly findings: readonly {
    readonly findingId: string;
    readonly kind: Exclude<ContextSourceStatus, "available">;
    readonly selectorId: string;
    readonly required: boolean;
    readonly affectsFreshness: boolean;
    readonly affectsConfidence: boolean;
  }[];
  readonly contradictions: readonly {
    readonly contradictionId: string;
    readonly factKey: string;
    readonly alternatives: readonly {
      readonly valueDigest: string;
      readonly fragmentIds: readonly string[];
    }[];
  }[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(message: string): never {
  throw new ContextSourceError("VES_CONTEXT_RECIPE_INVALID", message);
}

function safe(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_VALUE.test(value)) invalid(`${field} is invalid`);
}

function positiveInteger(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) invalid(`${field} is invalid`);
}

function validateJson(value: unknown, field: string): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0)
    invalid(`${field} is invalid`);
  try {
    const visit = (entry: unknown): void => {
      if (
        entry === undefined ||
        typeof entry === "function" ||
        typeof entry === "symbol" ||
        typeof entry === "bigint" ||
        (typeof entry === "number" && !Number.isFinite(entry))
      )
        invalid(`${field} is invalid`);
      if (Array.isArray(entry)) for (const item of entry) visit(item);
      else if (entry !== null && typeof entry === "object")
        for (const [key, item] of Object.entries(entry as Readonly<Record<string, unknown>>)) {
          safe(key, `${field} key`);
          visit(item);
        }
    };
    visit(value);
    const serialized = canonicalizeJsonV2(value);
    if (serialized.length > 100_000) invalid(`${field} is invalid`);
  } catch {
    invalid(`${field} is invalid`);
  }
}

function normalizeSelector(selector: ContextSourceSelector): ContextSourceSelector {
  try {
    StableId.parse(selector.selectorId, "selector");
    safe(selector.sourceId, "sourceId");
    if (!SOURCE_KINDS.includes(selector.sourceKind)) invalid("sourceKind is invalid");
    validateJson(selector.query, "query");
    DataClassification.parse(selector.classification);
    if (selector.priority !== undefined && !PRIORITIES.includes(selector.priority)) invalid("priority is invalid");
    if (selector.maximumAgeSeconds !== undefined) positiveInteger(selector.maximumAgeSeconds, "maximumAgeSeconds");
    if (selector.expectedRevision !== undefined) safe(selector.expectedRevision, "expectedRevision");
  } catch (error) {
    if (error instanceof ContextSourceError) throw error;
    invalid("selector is invalid");
  }
  return deepFreeze({
    ...selector,
    query: JSON.parse(canonicalizeJsonV2(selector.query)) as Readonly<Record<string, unknown>>
  });
}

export function contextRecipeDigest(recipe: ContextRecipe, digest: ContextDigestPort): string {
  return digest.sha256(canonicalizeJsonV2(normalizeRecipe(recipe)));
}

function normalizeRecipe(recipe: ContextRecipe): ContextRecipe {
  try {
    if (recipe.schemaVersion !== 1) invalid("schemaVersion is invalid");
    StableId.parse(recipe.recipeId, "recipe");
    StableId.parse(recipe.taskId, "task");
    if (!Array.isArray(recipe.requiredSources) || recipe.requiredSources.length === 0)
      invalid("requiredSources is invalid");
    if (!Array.isArray(recipe.optionalSources)) invalid("optionalSources is invalid");
    const requiredSources = recipe.requiredSources
      .map(normalizeSelector)
      .sort((a, b) => codeUnitCompare(a.selectorId, b.selectorId));
    const optionalSources = recipe.optionalSources
      .map(normalizeSelector)
      .sort((a, b) => codeUnitCompare(a.selectorId, b.selectorId));
    const all = [...requiredSources, ...optionalSources];
    if (new Set(all.map((entry) => entry.selectorId)).size !== all.length) invalid("selector IDs must be unique");
    if (!Array.isArray(recipe.semanticObligations) || recipe.semanticObligations.length === 0)
      invalid("semanticObligations is invalid");
    for (const obligation of recipe.semanticObligations) safe(obligation, "semanticObligation");
    const obligations = [...recipe.semanticObligations].sort();
    if (new Set(obligations).size !== obligations.length) invalid("semanticObligations must be unique");
    if (!Array.isArray(recipe.priorityBudgets) || recipe.priorityBudgets.length === 0)
      invalid("priorityBudgets is invalid");
    for (const budget of recipe.priorityBudgets) {
      if (!PRIORITIES.includes(budget.priority)) invalid("priority is invalid");
      positiveInteger(budget.maximumTokens, "maximumTokens");
    }
    const budgets = [...recipe.priorityBudgets].sort((a, b) => codeUnitCompare(a.priority, b.priority));
    if (new Set(budgets.map((entry) => entry.priority)).size !== budgets.length)
      invalid("priorityBudgets must be unique");
    positiveInteger(recipe.freshnessPolicy.defaultMaximumAgeSeconds, "defaultMaximumAgeSeconds");
    safe(recipe.trustPolicyRef, "trustPolicyRef");
    safe(recipe.egressPurpose, "egressPurpose");
    return deepFreeze({
      ...recipe,
      requiredSources,
      optionalSources,
      semanticObligations: obligations,
      priorityBudgets: budgets.map((entry) => ({ ...entry })),
      freshnessPolicy: { ...recipe.freshnessPolicy }
    });
  } catch (error) {
    if (error instanceof ContextSourceError) throw error;
    invalid("recipe is invalid");
  }
}

function statusFlags(status: ContextSourceStatus, required: boolean) {
  return {
    affectsFreshness: status === "stale" || status === "missing" || status === "unavailable",
    affectsConfidence: status !== "available" && (required || status !== "missing")
  };
}

export class ContextSnapshotResolver {
  readonly #digest: ContextDigestPort;
  readonly #sources: ContextSourcePorts;
  readonly #envelopes: TrustEnvelopeService;

  constructor(options: { readonly digest: ContextDigestPort; readonly sources: ContextSourcePorts }) {
    this.#digest = options.digest;
    this.#sources = options.sources;
    this.#envelopes = new TrustEnvelopeService({ digest: options.digest });
  }

  async resolve(input: {
    readonly workspaceId: string;
    readonly recipe: ContextRecipe;
    readonly evaluatedAt: string;
  }): Promise<ContextSnapshot> {
    let evaluated: IsoInstant;
    try {
      StableId.parse(input.workspaceId, "workspace");
      evaluated = IsoInstant.parse(input.evaluatedAt);
    } catch {
      invalid("Workspace or evaluation instant is invalid");
    }
    const recipe = normalizeRecipe(input.recipe);
    const recipeDigest = contextRecipeDigest(recipe, this.#digest);
    const requiredIds = new Set(recipe.requiredSources.map((entry) => entry.selectorId));
    const selectors = [...recipe.requiredSources, ...recipe.optionalSources];
    const sources: ResolvedContextSource[] = [];

    for (const selector of selectors) {
      const required = requiredIds.has(selector.selectorId);
      const query = deepFreeze({
        workspaceId: input.workspaceId,
        selectorId: selector.selectorId,
        sourceKind: selector.sourceKind,
        sourceId: selector.sourceId,
        query: selector.query,
        ...(selector.expectedRevision === undefined ? {} : { expectedRevision: selector.expectedRevision })
      });
      let observation: ContextSourceObservation | undefined;
      try {
        observation = await this.#sources[selector.sourceKind].resolve(query);
      } catch {
        sources.push(
          deepFreeze({
            selectorId: selector.selectorId,
            sourceKind: selector.sourceKind,
            sourceId: selector.sourceId,
            required,
            status: "unavailable",
            ...statusFlags("unavailable", required),
            fragments: []
          })
        );
        continue;
      }
      if (observation === undefined) {
        sources.push(
          deepFreeze({
            selectorId: selector.selectorId,
            sourceKind: selector.sourceKind,
            sourceId: selector.sourceId,
            required,
            status: "missing",
            ...statusFlags("missing", required),
            fragments: []
          })
        );
        continue;
      }
      sources.push(this.#resolveObservation(input.workspaceId, evaluated, recipe, selector, required, observation));
    }

    const contradictions = this.#contradictions(sources);
    const findings = sources
      .filter((entry) => entry.status !== "available")
      .map((entry) =>
        deepFreeze({
          findingId: this.#digest.sha256(canonicalizeJsonV2({ selectorId: entry.selectorId, status: entry.status })),
          kind: entry.status as Exclude<ContextSourceStatus, "available">,
          selectorId: entry.selectorId,
          required: entry.required,
          affectsFreshness: entry.affectsFreshness,
          affectsConfidence: entry.affectsConfidence
        })
      );
    const material = {
      workspaceId: input.workspaceId,
      recipeDigest,
      evaluatedAt: input.evaluatedAt,
      sources,
      findings,
      contradictions
    };
    return deepFreeze({
      schemaVersion: 1,
      snapshotId: this.#digest.sha256(canonicalizeJsonV2(material)),
      workspaceId: input.workspaceId,
      recipeId: recipe.recipeId,
      recipeDigest,
      evaluatedAt: input.evaluatedAt,
      sources,
      findings,
      contradictions
    });
  }

  #resolveObservation(
    workspaceId: string,
    evaluated: IsoInstant,
    recipe: ContextRecipe,
    selector: ContextSourceSelector,
    required: boolean,
    observation: ContextSourceObservation
  ): ResolvedContextSource {
    try {
      if (
        observation.source.kind !== selector.sourceKind ||
        observation.source.identity !== selector.sourceId ||
        !SAFE_VALUE.test(observation.source.revision)
      )
        throw new Error("identity");
      const retrieved = IsoInstant.parse(observation.retrievedAt);
      const ageSeconds = (Date.parse(evaluated.value) - Date.parse(retrieved.value)) / 1000;
      if (!Number.isSafeInteger(ageSeconds) || ageSeconds < 0) throw new Error("time");
      if (observation.scope !== selector.query["scope"]) {
        return deepFreeze({
          selectorId: selector.selectorId,
          sourceKind: selector.sourceKind,
          sourceId: selector.sourceId,
          required,
          status: "outside-scope",
          ...statusFlags("outside-scope", required),
          fragments: [],
          sourceRevision: observation.source.revision,
          retrievedAt: observation.retrievedAt,
          ageSeconds
        });
      }
      if (selector.expectedRevision !== undefined && selector.expectedRevision !== observation.source.revision) {
        return deepFreeze({
          selectorId: selector.selectorId,
          sourceKind: selector.sourceKind,
          sourceId: selector.sourceId,
          required,
          status: "revision-mismatch",
          ...statusFlags("revision-mismatch", required),
          fragments: [],
          sourceRevision: observation.source.revision,
          actualRevision: observation.source.revision,
          retrievedAt: observation.retrievedAt,
          ageSeconds
        });
      }
      const seen = new Set<string>();
      const fragments = observation.fragments
        .map((fragment) => {
          StableId.parse(fragment.fragmentId, "fragment");
          if (seen.has(fragment.fragmentId)) throw new Error("duplicate fragment");
          seen.add(fragment.fragmentId);
          if (!TRUST_CLASSES.includes(fragment.trust)) throw new Error("trust");
          const classification = DataClassification.mostRestrictive([
            DataClassification.parse(selector.classification),
            DataClassification.parse(fragment.classification)
          ]).value;
          const claims = (fragment.claims ?? []).map((claim) => {
            safe(claim.factKey, "factKey");
            if (
              typeof claim.value !== "string" ||
              claim.value.length === 0 ||
              claim.value.length > 10_000 ||
              /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(claim.value)
            )
              throw new Error("claim value");
            return { factKey: claim.factKey, value: claim.value, valueDigest: this.#digest.sha256(claim.value) };
          });
          const envelope = this.#envelopes.source({
            fragmentId: fragment.fragmentId,
            workspaceId,
            source: observation.source,
            retrievedAt: observation.retrievedAt,
            classification,
            trust: fragment.trust as TrustClass,
            content: fragment.content
          });
          return deepFreeze({
            ...envelope,
            claims: claims.sort(
              (a, b) => codeUnitCompare(a.factKey, b.factKey) || codeUnitCompare(a.valueDigest, b.valueDigest)
            )
          });
        })
        .sort((a, b) => codeUnitCompare(a.fragmentId, b.fragmentId));
      const maximumAge = selector.maximumAgeSeconds ?? recipe.freshnessPolicy.defaultMaximumAgeSeconds;
      const status: ContextSourceStatus = ageSeconds > maximumAge ? "stale" : "available";
      return deepFreeze({
        selectorId: selector.selectorId,
        sourceKind: selector.sourceKind,
        sourceId: selector.sourceId,
        required,
        status,
        ...statusFlags(status, required),
        fragments,
        sourceRevision: observation.source.revision,
        retrievedAt: observation.retrievedAt,
        ageSeconds
      });
    } catch {
      return deepFreeze({
        selectorId: selector.selectorId,
        sourceKind: selector.sourceKind,
        sourceId: selector.sourceId,
        required,
        status: "unavailable",
        ...statusFlags("unavailable", required),
        fragments: []
      });
    }
  }

  #contradictions(sources: readonly ResolvedContextSource[]): ContextSnapshot["contradictions"] {
    const facts = new Map<string, Map<string, string[]>>();
    for (const source of sources) {
      for (const fragment of source.fragments) {
        for (const claim of fragment.claims) {
          const values = facts.get(claim.factKey) ?? new Map<string, string[]>();
          const fragments = values.get(claim.valueDigest) ?? [];
          fragments.push(fragment.fragmentId);
          values.set(claim.valueDigest, fragments);
          facts.set(claim.factKey, values);
        }
      }
    }
    return [...facts.entries()]
      .filter(([, values]) => values.size > 1)
      .sort(([left], [right]) => codeUnitCompare(left, right))
      .map(([factKey, values]) => {
        const alternatives = [...values.entries()]
          .sort(([left], [right]) => codeUnitCompare(left, right))
          .map(([valueDigest, fragmentIds]) => deepFreeze({ valueDigest, fragmentIds: [...fragmentIds].sort() }));
        return deepFreeze({
          contradictionId: this.#digest.sha256(canonicalizeJsonV2({ factKey, alternatives })),
          factKey,
          alternatives
        });
      });
  }
}

export class FixtureContextSource implements ContextSourcePort {
  readonly #kind: ContextSourceKind;
  readonly #observations: ReadonlyMap<string, ContextSourceObservation>;

  constructor(options: {
    readonly kind: ContextSourceKind;
    readonly observations: Readonly<Record<string, ContextSourceObservation>>;
  }) {
    if (!SOURCE_KINDS.includes(options.kind)) invalid("fixture source kind is invalid");
    this.#kind = options.kind;
    this.#observations = new Map(
      Object.entries(options.observations).map(([sourceId, observation]) => {
        safe(sourceId, "fixture sourceId");
        return [sourceId, deepFreeze(structuredClone(observation))] as const;
      })
    );
  }

  async resolve(query: ContextSourceQuery): Promise<ContextSourceObservation | undefined> {
    if (query.sourceKind !== this.#kind)
      throw new ContextSourceError("VES_CONTEXT_SOURCE_KIND_MISMATCH", "Fixture source kind does not match query");
    return this.#observations.get(query.sourceId);
  }
}
