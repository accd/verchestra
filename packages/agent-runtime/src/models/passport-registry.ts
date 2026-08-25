import {
  IsoInstant,
  StableId,
  canonicalizeJsonV2,
  dropUndefinedMembers,
  normalizeDeclaredSet
} from "@verchestra/domain";

import type { ContextDigestPort } from "../context/source-snapshots.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9.-]{0,126}[a-z0-9]$/u;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,255}$/u;
const TRANSPORTS = ["local-cli", "local-api", "remote-api"] as const;
const RISK_TIERS = ["low", "medium", "high"] as const;

export class ModelPassportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ModelPassportError";
    this.code = code;
  }
}

export interface PassportCandidate {
  readonly passportId: string;
  readonly endpointIdentity: {
    readonly endpointId: string;
    readonly providerId: string;
    readonly driverId: string;
    readonly transport: (typeof TRANSPORTS)[number];
    readonly locationDigest: string;
  };
  readonly requestedModelId: string;
  readonly resolvedModelId: string;
  readonly providerRevision?: string;
  readonly dataHandling: {
    readonly training: "disabled" | "provider-policy";
    readonly retention: "none" | "transient" | "provider-policy";
    readonly region: string;
  };
  readonly observedCapabilities: readonly {
    readonly capability: string;
    readonly supported: boolean;
    readonly evidenceRef: string;
  }[];
  readonly contextCapacity: {
    readonly maximumInputTokens: number;
    readonly maximumOutputTokens: number;
    readonly evidenceRef: string;
  };
  readonly driverContractEvidence: readonly string[];
  readonly evaluationCampaignRef: string;
  readonly eligibleRiskTiers: readonly (typeof RISK_TIERS)[number][];
  readonly independenceClass: string;
  readonly confidence: number;
  readonly status: "qualified" | "degraded" | "quarantined";
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface PassportRecord extends PassportCandidate {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly endpointModelIdentityDigest: string;
  readonly candidateDigest: string;
  readonly drift?: {
    readonly kind: "resolved-model" | "provider-revision" | "evaluation-evidence";
    readonly observedDigest: string;
  };
  readonly status: "qualified" | "degraded" | "quarantined";
  readonly keyId: string;
  readonly signature: string;
}

export interface PassportSignerPort {
  sign(payload: Readonly<Record<string, unknown>>): Promise<{ readonly keyId: string; readonly signature: string }>;
  verify(record: PassportRecord): Promise<boolean>;
}

export interface PassportStorePort {
  history(passportId: string): Promise<readonly PassportRecord[]>;
  all(): Promise<readonly PassportRecord[]>;
  append(record: PassportRecord): Promise<void>;
  loadMachineIndex(machineId: string): Promise<MachinePassportIndex | undefined>;
  saveMachineIndex(index: MachinePassportIndex): Promise<void>;
}

export interface MachinePassportIndex {
  readonly schemaVersion: 1;
  readonly machineId: string;
  readonly passports: readonly { readonly passportId: string; readonly revision: number }[];
}

function canonicalV2(value: unknown): string {
  return canonicalizeJsonV2(dropUndefinedMembers(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Readonly<Record<string, unknown>>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: string, message: string): never {
  throw new ModelPassportError(code, message);
}

function safe(value: unknown, label: string, pattern = ID): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) fail("VES_PASSPORT_INPUT_INVALID", `${label} is invalid`);
}

function digest(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_PASSPORT_INPUT_INVALID", `${label} is invalid`);
}

function positive(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail("VES_PASSPORT_INPUT_INVALID", `${label} is invalid`);
}

function normalize(input: PassportCandidate, now: string, allowExpired: boolean): PassportCandidate {
  try {
    StableId.parse(input.passportId, "passport");
    StableId.parse(input.endpointIdentity.endpointId, "endpoint");
    safe(input.endpointIdentity.providerId, "providerId");
    safe(input.endpointIdentity.driverId, "driverId");
    if (!TRANSPORTS.includes(input.endpointIdentity.transport))
      fail("VES_PASSPORT_INPUT_INVALID", "transport is invalid");
    digest(input.endpointIdentity.locationDigest, "locationDigest");
    safe(input.requestedModelId, "requestedModelId", MODEL);
    safe(input.resolvedModelId, "resolvedModelId", MODEL);
    if (input.providerRevision !== undefined) safe(input.providerRevision, "providerRevision", MODEL);
    if (input.dataHandling.training !== "disabled" && input.dataHandling.training !== "provider-policy")
      fail("VES_PASSPORT_INPUT_INVALID", "training policy is invalid");
    if (!["none", "transient", "provider-policy"].includes(input.dataHandling.retention))
      fail("VES_PASSPORT_INPUT_INVALID", "retention policy is invalid");
    safe(input.dataHandling.region, "region", MODEL);
    if (!Array.isArray(input.observedCapabilities) || input.observedCapabilities.length === 0)
      fail("VES_PASSPORT_INPUT_INVALID", "capabilities are invalid");
    const names = new Set<string>();
    for (const capability of input.observedCapabilities) {
      safe(capability.capability, "capability");
      if (names.has(capability.capability) || typeof capability.supported !== "boolean")
        fail("VES_PASSPORT_INPUT_INVALID", "capability is duplicated or invalid");
      names.add(capability.capability);
      digest(capability.evidenceRef, "capability evidence");
    }
    positive(input.contextCapacity.maximumInputTokens, "maximumInputTokens");
    positive(input.contextCapacity.maximumOutputTokens, "maximumOutputTokens");
    digest(input.contextCapacity.evidenceRef, "capacity evidence");
    if (!Array.isArray(input.driverContractEvidence) || input.driverContractEvidence.length === 0)
      fail("VES_PASSPORT_INPUT_INVALID", "driver evidence is invalid");
    for (const evidence of input.driverContractEvidence) digest(evidence, "driver evidence");
    digest(input.evaluationCampaignRef, "evaluation campaign");
    if (
      !Array.isArray(input.eligibleRiskTiers) ||
      input.eligibleRiskTiers.length === 0 ||
      input.eligibleRiskTiers.some((entry) => !RISK_TIERS.includes(entry))
    )
      fail("VES_PASSPORT_INPUT_INVALID", "risk tiers are invalid");
    safe(input.independenceClass, "independenceClass");
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)
      fail("VES_PASSPORT_INPUT_INVALID", "confidence is invalid");
    if (input.status !== "qualified" && input.status !== "degraded")
      fail("VES_PASSPORT_INPUT_INVALID", "status is invalid");
    const issued = IsoInstant.parse(input.issuedAt);
    const expires = IsoInstant.parse(input.expiresAt);
    if (issued.compare(expires) >= 0 || (!allowExpired && expires.compare(IsoInstant.parse(now)) <= 0))
      fail("VES_PASSPORT_INPUT_INVALID", "expiry is invalid");
  } catch (error) {
    if (error instanceof ModelPassportError) throw error;
    fail("VES_PASSPORT_INPUT_INVALID", "Passport candidate is invalid");
  }
  return deepFreeze({
    ...input,
    endpointIdentity: { ...input.endpointIdentity },
    dataHandling: { ...input.dataHandling },
    // A declared set, not a caller-meaningful order: it is folded into
    // `candidateDigest`, so ambient collation here decided Passport identity.
    // Capability names admit `.` and `-`, which many collations treat as
    // ignorable, so this is not a case-only divergence (issue #58).
    observedCapabilities: normalizeDeclaredSet(
      input.observedCapabilities.map((entry) => ({ ...entry })),
      (entry) => entry.capability
    ),
    contextCapacity: { ...input.contextCapacity },
    driverContractEvidence: [...new Set(input.driverContractEvidence)].sort(),
    eligibleRiskTiers: [...new Set(input.eligibleRiskTiers)].sort()
  });
}

export class InMemoryPassportStore implements PassportStorePort {
  readonly #records = new Map<string, PassportRecord[]>();
  readonly #machineIndexes = new Map<string, MachinePassportIndex>();

  async history(passportId: string): Promise<readonly PassportRecord[]> {
    return this.#records.get(passportId) ?? [];
  }

  async all(): Promise<readonly PassportRecord[]> {
    return [...this.#records.values()].flat();
  }

  async append(record: PassportRecord): Promise<void> {
    const history = this.#records.get(record.passportId) ?? [];
    if (record.revision !== history.length + 1)
      fail("VES_PASSPORT_REVISION_CONFLICT", "Passport revision is not atomic");
    history.push(record);
    this.#records.set(record.passportId, history);
  }

  async loadMachineIndex(machineId: string): Promise<MachinePassportIndex | undefined> {
    return this.#machineIndexes.get(machineId);
  }

  async saveMachineIndex(index: MachinePassportIndex): Promise<void> {
    this.#machineIndexes.set(index.machineId, index);
  }

  unsafeReplace(passportId: string, record: PassportRecord): void {
    const history = this.#records.get(passportId) ?? [];
    if (history.length === 0) throw new Error("missing fixture record");
    history[history.length - 1] = record;
  }
}

export class ModelPassportRegistry {
  readonly #digest: ContextDigestPort;
  readonly #signer: PassportSignerPort;
  readonly #store: PassportStorePort;
  readonly #now: () => string;

  constructor(options: {
    readonly digest: ContextDigestPort;
    readonly signer: PassportSignerPort;
    readonly store: PassportStorePort;
    readonly now?: () => string;
  }) {
    this.#digest = options.digest;
    this.#signer = options.signer;
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  async qualify(
    input: PassportCandidate,
    options: { readonly allowExpiredEvidence?: boolean } = {}
  ): Promise<PassportRecord> {
    const candidate = normalize(input, this.#now(), options.allowExpiredEvidence === true);
    const history = await this.#store.history(candidate.passportId);
    const all = await this.#store.all();
    const current = history.at(-1);
    if (current !== undefined && canonicalV2(current.endpointIdentity) !== canonicalV2(candidate.endpointIdentity))
      fail("VES_PASSPORT_IDENTITY_CONFLICT", "Passport identity is bound to another endpoint");
    if (current !== undefined && current.resolvedModelId !== candidate.resolvedModelId)
      fail("VES_PASSPORT_IDENTITY_CONFLICT", "Passport identity is bound to another resolved model");
    const endpointPeer = all.find(
      (entry) => entry.endpointIdentity.endpointId === candidate.endpointIdentity.endpointId
    );
    if (
      endpointPeer !== undefined &&
      canonicalV2(endpointPeer.endpointIdentity) !== canonicalV2(candidate.endpointIdentity)
    )
      fail("VES_PASSPORT_ENDPOINT_CONFLICT", "Endpoint identity metadata conflicts with history");
    const endpointModelIdentityDigest = this.#digest.sha256(
      canonicalV2({
        endpointIdentity: candidate.endpointIdentity,
        resolvedModelId: candidate.resolvedModelId
      })
    );
    const candidateDigest = this.#digest.sha256(canonicalV2(candidate));
    if (current?.candidateDigest === candidateDigest) {
      await this.#verified(current);
      return current;
    }
    const payload = deepFreeze({
      schemaVersion: 1 as const,
      ...candidate,
      revision: history.length + 1,
      endpointModelIdentityDigest,
      candidateDigest
    });
    return this.#appendSigned(payload);
  }

  async observe(
    passportId: string,
    observation: {
      readonly resolvedModelId: string;
      readonly providerRevision?: string;
      readonly evidenceDigest: string;
    }
  ): Promise<PassportRecord> {
    const history = await this.#store.history(passportId);
    const current = history.at(-1);
    if (current === undefined) fail("VES_PASSPORT_NOT_FOUND", "Passport is unavailable");
    await this.#verified(current);
    digest(observation.evidenceDigest, "observation evidence");
    let kind: "resolved-model" | "provider-revision" | "evaluation-evidence";
    if (observation.resolvedModelId !== current.resolvedModelId) kind = "resolved-model";
    else if (observation.providerRevision !== current.providerRevision) kind = "provider-revision";
    else if (observation.evidenceDigest !== current.evaluationCampaignRef) kind = "evaluation-evidence";
    else return current;
    const { keyId: _keyId, signature: _signature, drift: _drift, ...base } = current;
    void _keyId;
    void _signature;
    void _drift;
    const payload = deepFreeze({
      ...base,
      revision: current.revision + 1,
      status: "quarantined" as const,
      issuedAt: this.#now(),
      drift: { kind, observedDigest: this.#digest.sha256(canonicalV2(observation)) },
      candidateDigest: this.#digest.sha256(canonicalV2({ previous: current.candidateDigest, kind, observation }))
    });
    return this.#appendSigned(payload);
  }

  async current(passportId: string): Promise<PassportRecord | undefined> {
    const record = (await this.#store.history(passportId)).at(-1);
    if (record === undefined) return undefined;
    await this.#verified(record);
    if (record.status === "quarantined" || record.expiresAt <= this.#now()) return undefined;
    return record;
  }

  async history(passportId: string): Promise<readonly PassportRecord[]> {
    const values = await this.#store.history(passportId);
    for (const value of values) await this.#verified(value);
    return deepFreeze([...values].sort((a, b) => a.revision - b.revision));
  }

  async indexMachine(machineId: string, passportIds: readonly string[]) {
    try {
      StableId.parse(machineId, "machine");
    } catch {
      fail("VES_PASSPORT_INPUT_INVALID", "Machine identity is invalid");
    }
    const passports = [];
    for (const passportId of [...new Set(passportIds)].sort()) {
      const current = await this.current(passportId);
      if (current !== undefined) passports.push({ passportId, revision: current.revision });
    }
    const index = deepFreeze({ schemaVersion: 1 as const, machineId, passports });
    await this.#store.saveMachineIndex(index);
    return index;
  }

  async machineIndex(machineId: string): Promise<MachinePassportIndex | undefined> {
    try {
      StableId.parse(machineId, "machine");
    } catch {
      fail("VES_PASSPORT_INPUT_INVALID", "Machine identity is invalid");
    }
    return this.#store.loadMachineIndex(machineId);
  }

  async #appendSigned(payload: Omit<PassportRecord, "keyId" | "signature">): Promise<PassportRecord> {
    let signed;
    try {
      signed = await this.#signer.sign(payload);
    } catch {
      fail("VES_PASSPORT_SIGNING_FAILED", "Passport signing failed");
    }
    const record = deepFreeze({ ...payload, keyId: signed.keyId, signature: signed.signature }) as PassportRecord;
    await this.#store.append(record);
    return record;
  }

  async #verified(record: PassportRecord): Promise<void> {
    let valid = false;
    try {
      valid = await this.#signer.verify(record);
    } catch {
      valid = false;
    }
    if (!valid) fail("VES_PASSPORT_TAMPERED", "Passport signature is invalid");
  }
}
