import { StableId, normalizeDeclaredSet } from "@verchestra/domain";

import type { MachinePassportIndex, PassportRecord } from "./passport-registry.ts";

const CAPABILITY = /^[a-z][a-z0-9:._-]{0,126}$/u;
const RISK = ["low", "medium", "high"] as const;
const TRANSPORT = ["local-cli", "local-api", "remote-api"] as const;
const RETENTION = ["none", "transient", "provider-policy"] as const;

export interface ModelPassportResolverPort {
  machineIndex(machineId: string): Promise<MachinePassportIndex | undefined>;
  current(passportId: string): Promise<PassportRecord | undefined>;
}

export interface ModelRoleRequirement {
  readonly roleId: string;
  readonly requiredCapabilities: readonly string[];
  readonly riskTier: (typeof RISK)[number];
  readonly minimumInputTokens: number;
  readonly minimumOutputTokens: number;
  readonly allowedTransports: readonly (typeof TRANSPORT)[number][];
  readonly dataHandling: {
    readonly requireTrainingDisabled: boolean;
    readonly allowedRetention: readonly (typeof RETENTION)[number][];
    readonly allowedRegions: readonly string[];
  };
  readonly independence: {
    readonly mode: "none" | "preferred" | "required";
    readonly fromRole?: string;
  };
  readonly preferredProviders: readonly string[];
  readonly preferredModels: readonly string[];
  readonly allowDegraded?: boolean;
  readonly minimumConfidence?: number;
}

export interface ModelExclusion {
  readonly passportId: string;
  readonly reasons: readonly string[];
}

export class ModelRouterError extends Error {
  readonly code: string;
  readonly roleId: string | undefined;
  readonly exclusions: readonly ModelExclusion[];

  constructor(
    code: string,
    message: string,
    details: { readonly roleId?: string; readonly exclusions?: readonly ModelExclusion[] } = {}
  ) {
    super(message);
    this.name = "ModelRouterError";
    this.code = code;
    this.roleId = details.roleId;
    this.exclusions = details.exclusions ?? [];
  }
}

export interface ModelRouteSelection {
  readonly roleId: string;
  readonly passportId: string;
  readonly revision: number;
  readonly endpointModelIdentityDigest: string;
  readonly independence: "not-required" | "satisfied" | "degraded";
  readonly ranking: readonly (number | string)[];
  readonly exclusions: readonly ModelExclusion[];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function invalid(message: string): never {
  throw new ModelRouterError("VES_MODEL_ROUTE_INVALID", message);
}

function safeList(value: unknown, label: string, pattern = CAPABILITY): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry: unknown) => typeof entry !== "string" || !pattern.test(entry)) ||
    new Set(value).size !== value.length
  )
    invalid(`${label} is invalid`);
  return value as readonly string[];
}

function validate(input: { readonly machineId: string; readonly roles: readonly ModelRoleRequirement[] }): void {
  try {
    StableId.parse(input.machineId, "machine");
  } catch {
    invalid("Machine identity is invalid");
  }
  if (!Array.isArray(input.roles) || input.roles.length === 0) invalid("Role requirements are invalid");
  const prior = new Set<string>();
  for (const role of input.roles) {
    if (!CAPABILITY.test(role.roleId) || prior.has(role.roleId)) invalid("Role identity is invalid or duplicated");
    safeList(role.requiredCapabilities, "Required capabilities");
    if (!RISK.includes(role.riskTier)) invalid("Risk tier is invalid");
    if (!Number.isSafeInteger(role.minimumInputTokens) || role.minimumInputTokens <= 0)
      invalid("Input capacity is invalid");
    if (!Number.isSafeInteger(role.minimumOutputTokens) || role.minimumOutputTokens <= 0)
      invalid("Output capacity is invalid");
    if (
      !Array.isArray(role.allowedTransports) ||
      role.allowedTransports.length === 0 ||
      role.allowedTransports.some((entry: (typeof TRANSPORT)[number]) => !TRANSPORT.includes(entry))
    )
      invalid("Allowed transports are invalid");
    if (typeof role.dataHandling.requireTrainingDisabled !== "boolean") invalid("Training requirement is invalid");
    if (
      !Array.isArray(role.dataHandling.allowedRetention) ||
      role.dataHandling.allowedRetention.length === 0 ||
      role.dataHandling.allowedRetention.some((entry: (typeof RETENTION)[number]) => !RETENTION.includes(entry))
    )
      invalid("Retention requirements are invalid");
    safeList(role.dataHandling.allowedRegions, "Allowed regions", /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u);
    if (!new Set(["none", "preferred", "required"]).has(role.independence.mode))
      invalid("Independence mode is invalid");
    if (role.independence.mode === "none" && role.independence.fromRole !== undefined)
      invalid("Independence reference is unexpected");
    if (role.independence.mode !== "none" && !prior.has(role.independence.fromRole ?? ""))
      invalid("Independence reference must name an earlier role");
    if (!Array.isArray(role.preferredProviders) || !Array.isArray(role.preferredModels))
      invalid("Model preferences are invalid");
    for (const value of [...role.preferredProviders, ...role.preferredModels]) {
      if (typeof value !== "string" || value.length === 0 || value.length > 256) invalid("Model preference is invalid");
    }
    if (role.allowDegraded !== undefined && typeof role.allowDegraded !== "boolean")
      invalid("Degraded status policy is invalid");
    if (
      role.minimumConfidence !== undefined &&
      (!Number.isFinite(role.minimumConfidence) || role.minimumConfidence < 0 || role.minimumConfidence > 1)
    )
      invalid("Minimum confidence is invalid");
    prior.add(role.roleId);
  }
}

function preference(value: string, preferred: readonly string[]): number {
  if (preferred.length === 0) return 0;
  const index = preferred.indexOf(value);
  return index < 0 ? preferred.length + 1 : index;
}

// Issue #58: a routing decision is a trust-relevant identity here. The final
// rank component is the Passport ID, so this comparison is what picks a model
// when two Passports tie on independence, status, preference, confidence and
// capacity -- ambient `localeCompare` let two machines route the same roles to
// different providers from the same Local Machine Profile, and the resulting
// `ranking` is reported as the explanation for the choice. UTF-16 code-unit
// order makes the decision a property of the IDs alone.
function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareRank(left: readonly (number | string)[], right: readonly (number | string)[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (typeof a === "number" && typeof b === "number" && a !== b) return a - b;
    if (typeof a === "string" && typeof b === "string" && a !== b) return compareCodeUnits(a, b);
  }
  return 0;
}

export class CapabilityModelRouter {
  readonly #passports: ModelPassportResolverPort;

  constructor(options: { readonly passports: ModelPassportResolverPort }) {
    this.#passports = options.passports;
  }

  async route(input: { readonly machineId: string; readonly roles: readonly ModelRoleRequirement[] }) {
    validate(input);
    const index = await this.#passports.machineIndex(input.machineId);
    if (index === undefined)
      throw new ModelRouterError("VES_MODEL_PROFILE_UNAVAILABLE", "Local Machine Profile is unavailable");
    if (
      index.machineId !== input.machineId ||
      new Set(index.passports.map((entry) => entry.passportId)).size !== index.passports.length ||
      index.passports.some((entry) => !Number.isSafeInteger(entry.revision) || entry.revision <= 0)
    )
      throw new ModelRouterError("VES_MODEL_PROFILE_INVALID", "Local Machine Profile is invalid");
    // The Machine Profile lists Passports as a declared set; this order becomes
    // the candidate order, and candidate order is the tie-break the eligible
    // sort inherits for equal ranks (issue #58).
    const resolved = await Promise.all(
      normalizeDeclaredSet(index.passports, (entry) => entry.passportId).map(async (reference) => ({
        reference,
        passport: await this.#passports.current(reference.passportId)
      }))
    );
    const candidates = resolved
      .filter(
        (
          entry
        ): entry is {
          readonly reference: { readonly passportId: string; readonly revision: number };
          readonly passport: PassportRecord;
        } => entry.passport !== undefined && entry.passport.revision === entry.reference.revision
      )
      .map((entry) => entry.passport);
    const profileExclusions = resolved
      .filter((entry) => entry.passport === undefined || entry.passport.revision !== entry.reference.revision)
      .map((entry) =>
        deepFreeze({
          passportId: entry.reference.passportId,
          reasons: deepFreeze([entry.passport === undefined ? "not-current" : "profile-revision-mismatch"])
        })
      );
    const selections: ModelRouteSelection[] = [];
    const selected = new Map<string, PassportRecord>();

    for (const role of input.roles) {
      const reference = role.independence.fromRole === undefined ? undefined : selected.get(role.independence.fromRole);
      const exclusions: ModelExclusion[] = [...profileExclusions];
      const eligible: { readonly passport: PassportRecord; readonly rank: readonly (number | string)[] }[] = [];
      for (const passport of candidates) {
        const reasons = this.#hardExclusions(role, passport, reference);
        if (reasons.length > 0) {
          exclusions.push(deepFreeze({ passportId: passport.passportId, reasons }));
          continue;
        }
        const independent = reference === undefined || passport.independenceClass !== reference.independenceClass;
        const rank = deepFreeze([
          role.independence.mode === "preferred" && !independent ? 1 : 0,
          passport.status === "degraded" ? 1 : 0,
          preference(passport.endpointIdentity.providerId, role.preferredProviders),
          preference(passport.resolvedModelId, role.preferredModels),
          -passport.confidence,
          -passport.contextCapacity.maximumInputTokens,
          passport.passportId
        ]);
        eligible.push({ passport, rank });
      }
      eligible.sort((a, b) => compareRank(a.rank, b.rank));
      const winner = eligible[0];
      if (winner === undefined)
        throw new ModelRouterError("VES_MODEL_NO_ELIGIBLE", "No Model Passport satisfies hard requirements", {
          roleId: role.roleId,
          // The reported exclusion list is the machine-readable explanation of
          // a refusal; two machines must present it in the same order (#58).
          exclusions: deepFreeze(normalizeDeclaredSet(exclusions, (entry) => entry.passportId))
        });
      const independent = reference === undefined || winner.passport.independenceClass !== reference.independenceClass;
      const independence = role.independence.mode === "none" ? "not-required" : independent ? "satisfied" : "degraded";
      selections.push(
        deepFreeze({
          roleId: role.roleId,
          passportId: winner.passport.passportId,
          revision: winner.passport.revision,
          endpointModelIdentityDigest: winner.passport.endpointModelIdentityDigest,
          independence,
          ranking: winner.rank,
          exclusions: deepFreeze(normalizeDeclaredSet(exclusions, (entry) => entry.passportId))
        })
      );
      selected.set(role.roleId, winner.passport);
    }
    return deepFreeze({ schemaVersion: 1 as const, machineId: input.machineId, selections });
  }

  #hardExclusions(
    role: ModelRoleRequirement,
    passport: PassportRecord,
    reference: PassportRecord | undefined
  ): readonly string[] {
    const reasons: string[] = [];
    const capabilities = new Set(
      passport.observedCapabilities.filter((entry) => entry.supported).map((entry) => entry.capability)
    );
    if (role.requiredCapabilities.some((entry) => !capabilities.has(entry))) reasons.push("missing-capability");
    if (!passport.eligibleRiskTiers.includes(role.riskTier)) reasons.push("risk-tier");
    if (passport.contextCapacity.maximumInputTokens < role.minimumInputTokens) reasons.push("input-capacity");
    if (passport.contextCapacity.maximumOutputTokens < role.minimumOutputTokens) reasons.push("output-capacity");
    if (role.dataHandling.requireTrainingDisabled && passport.dataHandling.training !== "disabled")
      reasons.push("training-policy");
    if (!role.dataHandling.allowedRetention.includes(passport.dataHandling.retention)) reasons.push("retention-policy");
    if (!role.dataHandling.allowedRegions.includes(passport.dataHandling.region)) reasons.push("region");
    if (!role.allowedTransports.includes(passport.endpointIdentity.transport)) reasons.push("transport");
    if (role.allowDegraded === false && passport.status === "degraded") reasons.push("degraded-status");
    if (passport.confidence < (role.minimumConfidence ?? 0)) reasons.push("minimum-confidence");
    if (
      role.independence.mode === "required" &&
      reference !== undefined &&
      passport.independenceClass === reference.independenceClass
    )
      reasons.push("independence");
    return deepFreeze(reasons.sort());
  }
}
