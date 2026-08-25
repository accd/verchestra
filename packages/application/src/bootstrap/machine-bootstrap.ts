import { DataClassification, IsoInstant, StableId, canonicalizeJsonV2, normalizeDeclaredSet } from "@verchestra/domain";

import { BootstrapError } from "./bootstrap-errors.ts";

export interface RoleRequirement {
  readonly roleId: string;
  readonly requiredCapabilities: readonly string[];
  readonly independence: "none" | "preferred" | "required";
  readonly independentFromRole?: string;
}

export interface CanonicalSecretRequirement {
  readonly logicalName: string;
  readonly purpose: string;
  readonly blockedCapability: string;
  readonly required: boolean;
}

export interface CanonicalDatabaseRegistration {
  readonly databaseId: string;
  readonly engine: "postgresql" | "mysql" | "sql-server" | "oracle" | "sqlite";
  readonly logicalEnvironment: string;
  readonly approvedSchemas: readonly string[];
  readonly classification: "public" | "internal" | "confidential" | "restricted" | "secret";
  readonly schemaSources: readonly string[];
  readonly purposes: readonly string[];
  readonly credentialLogicalNames: readonly string[];
}

export interface CanonicalBootstrapConfig {
  readonly schemaVersion: 1;
  readonly configVersion: number;
  readonly minimumCliVersion: string;
  readonly workspaceId: string;
  readonly roles: readonly RoleRequirement[];
  readonly requiredSecrets: readonly CanonicalSecretRequirement[];
  readonly databases: readonly CanonicalDatabaseRegistration[];
}

export interface LocalModelPassport {
  readonly passportId: string;
  readonly revision: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly capabilities: readonly string[];
  readonly qualificationStatus: "qualified" | "unqualified" | "quarantined";
  readonly validUntil: string;
}

export interface LocalDriverCandidate {
  readonly driverId: string;
  readonly driverVersion: string;
  readonly command: string;
  readonly passport: LocalModelPassport;
}

export interface DriverDiscoveryPort {
  discover(): Promise<readonly LocalDriverCandidate[]>;
}

export interface SecretBindingRequest {
  readonly workspaceId: string;
  readonly logicalName: string;
  readonly purpose: string;
  readonly blockedCapability: string;
  readonly expectedStore: string;
}

export interface SecretBindingInspectorPort {
  readonly expectedStore: string;
  isBound(binding: SecretBindingRequest): Promise<boolean>;
}

export interface RoleBindingResult {
  readonly roleId: string;
  readonly status: "ready" | "degraded-independence" | "blocked";
  readonly eligiblePassportIds: readonly string[];
  readonly failedRequirements: readonly string[];
}

export interface MachineProfile {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly machineId: string;
  readonly cliVersion: string;
  readonly configVersion: number;
  readonly drivers: readonly LocalDriverCandidate[];
  readonly roles: readonly RoleBindingResult[];
  readonly secretBindings: readonly {
    readonly logicalName: string;
    readonly status: "bound" | "missing";
    readonly required: boolean;
    readonly expectedStore: string;
  }[];
}

export interface MachineProfileSaveReceipt {
  readonly changed: boolean;
  readonly profileDigest: string;
}

export interface MachineProfileStorePort {
  save(profile: MachineProfile): Promise<MachineProfileSaveReceipt>;
}

export interface MissingBinding {
  readonly logicalName: string;
  readonly expectedStore: string;
  readonly purpose: string;
  readonly blockedCapability: string;
  readonly required: boolean;
}

export interface BootstrapResult {
  readonly schemaVersion: 1;
  readonly status: "ready" | "degraded" | "blocked";
  readonly detectedDriverIds: readonly string[];
  readonly roles: readonly RoleBindingResult[];
  readonly missingBindings: readonly MissingBinding[];
  readonly profileDigest: string;
  readonly profileChanged: boolean;
}

const IDENTIFIER = /^[a-z][a-z0-9.-]{0,126}[a-z0-9]$/u;
const CAPABILITY = /^[a-z][a-z0-9:._-]{0,126}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

// Code-unit comparison, not localeCompare: every ordering in this file lands
// in the Machine Profile that `MachineProfileStorePort.save` persists and
// digests (`BootstrapResult.profileDigest`), so the order two machines produce
// for the same discovery result has to be a property of the identifiers, not
// of the ambient locale. Identifiers here are `IDENTIFIER`/`CAPABILITY`
// tokens whose ASCII punctuation (`.`, `-`, `_`, `:`) is exactly what
// locale-aware collation is free to reorder or treat as ignorable (issue #58,
// AD-018).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function fail(message: string, cause?: unknown): never {
  throw new BootstrapError("VES_BOOTSTRAP_INPUT_INVALID", message, {}, cause === undefined ? undefined : { cause });
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields are invalid`);
  }
}

function stringValue(value: unknown, label: string, pattern = IDENTIFIER): string {
  if (typeof value !== "string" || value.length > 512 || /[\u0000-\u001f]/u.test(value) || !pattern.test(value)) {
    fail(`${label} is invalid`);
  }
  return value;
}

function stringList(value: unknown, label: string, pattern = CAPABILITY): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) fail(`${label} is invalid`);
  const values = value.map((item) => stringValue(item, label, pattern));
  if (new Set(values).size !== values.length) fail(`${label} contains duplicates`);
  return Object.freeze(normalizeDeclaredSet(values, (item) => item));
}

function semver(value: unknown, label: string): readonly [number, number, number] {
  if (typeof value !== "string") fail(`${label} is invalid`);
  const match = SEMVER.exec(value);
  if (match === null) fail(`${label} is invalid`);
  return Object.freeze([Number(match[1]), Number(match[2]), Number(match[3])]);
}

function compareSemver(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] as number) - (right[index] as number);
    if (difference !== 0) return difference;
  }
  return 0;
}

function validateConfig(raw: CanonicalBootstrapConfig): CanonicalBootstrapConfig {
  if (typeof raw !== "object" || raw === null) fail("Bootstrap configuration is invalid");
  exactKeys(
    raw,
    ["schemaVersion", "configVersion", "minimumCliVersion", "workspaceId", "roles", "requiredSecrets", "databases"],
    "Bootstrap configuration"
  );
  if (raw.schemaVersion !== 1 || !Number.isSafeInteger(raw.configVersion) || raw.configVersion < 1) {
    fail("Bootstrap configuration version is invalid");
  }
  semver(raw.minimumCliVersion, "Minimum CLI version");
  try {
    StableId.parse(raw.workspaceId, "workspace");
  } catch (error) {
    fail("Workspace identity is invalid", error);
  }
  if (!Array.isArray(raw.roles) || raw.roles.length === 0) fail("Role requirements are invalid");
  const roleIds = new Set<string>();
  for (const role of raw.roles) {
    const keys = ["roleId", "requiredCapabilities", "independence"];
    if (role.independentFromRole !== undefined) keys.push("independentFromRole");
    exactKeys(role, keys, "Role requirement");
    stringValue(role.roleId, "Role identity");
    stringList(role.requiredCapabilities, "Required capability");
    if (!["none", "preferred", "required"].includes(role.independence)) fail("Role independence is invalid");
    if (roleIds.has(role.roleId)) fail("Role identity is duplicated");
    roleIds.add(role.roleId);
  }
  for (const role of raw.roles) {
    if (role.independence === "none" && role.independentFromRole !== undefined)
      fail("Unexpected independence reference");
    if (role.independence !== "none" && !roleIds.has(role.independentFromRole ?? "")) {
      fail("Independent role reference is invalid");
    }
  }
  if (!Array.isArray(raw.requiredSecrets) || !Array.isArray(raw.databases)) fail("Binding declarations are invalid");
  for (const secret of raw.requiredSecrets) {
    exactKeys(secret, ["logicalName", "purpose", "blockedCapability", "required"], "Secret requirement");
    stringValue(secret.logicalName, "Logical secret name");
    stringValue(secret.purpose, "Secret purpose", /^.{1,512}$/u);
    stringValue(secret.blockedCapability, "Blocked capability", CAPABILITY);
    if (typeof secret.required !== "boolean") fail("Secret requirement flag is invalid");
  }
  for (const database of raw.databases) validateDatabase(database);
  return raw;
}

function validateDatabase(database: CanonicalDatabaseRegistration): void {
  exactKeys(
    database,
    [
      "databaseId",
      "engine",
      "logicalEnvironment",
      "approvedSchemas",
      "classification",
      "schemaSources",
      "purposes",
      "credentialLogicalNames"
    ],
    "Database registration"
  );
  stringValue(database.databaseId, "Database identity");
  if (!["postgresql", "mysql", "sql-server", "oracle", "sqlite"].includes(database.engine)) {
    fail("Database engine is invalid");
  }
  stringValue(database.logicalEnvironment, "Database environment");
  stringList(database.approvedSchemas, "Approved database schema");
  stringList(database.schemaSources, "Database schema source", /^[^\u0000-\u001f]{1,512}$/u);
  stringList(database.purposes, "Database purpose");
  stringList(database.credentialLogicalNames, "Database credential logical name", IDENTIFIER);
  try {
    DataClassification.parse(database.classification);
  } catch (error) {
    fail("Database classification is invalid", error);
  }
}

function validateCandidates(
  raw: readonly LocalDriverCandidate[],
  now: string
): {
  readonly detectedDriverIds: readonly string[];
  readonly eligible: readonly LocalDriverCandidate[];
} {
  if (!Array.isArray(raw)) fail("Driver discovery result is invalid");
  const passportIds = new Set<string>();
  const detected = new Set<string>();
  const candidates = raw.map((candidate) => {
    exactKeys(candidate, ["driverId", "driverVersion", "command", "passport"], "Driver candidate");
    stringValue(candidate.driverId, "Driver identity");
    semver(candidate.driverVersion, "Driver version");
    stringValue(candidate.command, "Driver command", /^[^\u0000-\u001f]{1,512}$/u);
    exactKeys(
      candidate.passport,
      ["passportId", "revision", "providerId", "modelId", "capabilities", "qualificationStatus", "validUntil"],
      "Model Passport"
    );
    try {
      StableId.parse(candidate.passport.passportId, "passport");
      IsoInstant.parse(candidate.passport.validUntil);
    } catch (error) {
      fail("Model Passport identity or validity is invalid", error);
    }
    stringValue(candidate.passport.revision, "Passport revision", /^[A-Za-z0-9._-]{1,128}$/u);
    stringValue(candidate.passport.providerId, "Provider identity");
    stringValue(candidate.passport.modelId, "Model identity");
    stringList(candidate.passport.capabilities, "Passport capability");
    if (!["qualified", "unqualified", "quarantined"].includes(candidate.passport.qualificationStatus)) {
      fail("Passport qualification status is invalid");
    }
    if (passportIds.has(candidate.passport.passportId)) fail("Passport identity is duplicated");
    passportIds.add(candidate.passport.passportId);
    detected.add(candidate.driverId);
    return candidate;
  });
  const eligible = candidates
    .filter(
      (candidate) => candidate.passport.qualificationStatus === "qualified" && candidate.passport.validUntil > now
    )
    .map((candidate) =>
      Object.freeze({
        ...candidate,
        passport: Object.freeze({
          ...candidate.passport,
          capabilities: Object.freeze(normalizeDeclaredSet<string>(candidate.passport.capabilities, (name) => name))
        })
      })
    );
  return Object.freeze({
    detectedDriverIds: Object.freeze(normalizeDeclaredSet([...detected], (driverId) => driverId)),
    eligible: Object.freeze(
      normalizeDeclaredSet(eligible, (candidate) => `${candidate.driverId}\0${candidate.passport.passportId}`)
    )
  });
}

function resolveRoles(
  roles: readonly RoleRequirement[],
  drivers: readonly LocalDriverCandidate[]
): readonly RoleBindingResult[] {
  const eligibleByRole = new Map<string, readonly LocalDriverCandidate[]>();
  for (const role of roles) {
    eligibleByRole.set(
      role.roleId,
      drivers.filter((driver) =>
        role.requiredCapabilities.every((capability) => driver.passport.capabilities.includes(capability))
      )
    );
  }
  return Object.freeze(
    normalizeDeclaredSet(roles, (role) => role.roleId).map((role) => {
      const eligible = eligibleByRole.get(role.roleId) as readonly LocalDriverCandidate[];
      const failures: string[] = [];
      let status: RoleBindingResult["status"] = "ready";
      if (eligible.length === 0) {
        status = "blocked";
        failures.push(...role.requiredCapabilities.map((capability) => `capability:${capability}`));
      } else if (role.independence !== "none") {
        const other = eligibleByRole.get(role.independentFromRole as string) ?? [];
        const distinct = eligible.some((candidate) =>
          other.some((otherCandidate) => candidate.passport.providerId !== otherCandidate.passport.providerId)
        );
        if (!distinct) {
          failures.push(`${role.independence}-independence:${role.independentFromRole as string}`);
          status = role.independence === "required" ? "blocked" : "degraded-independence";
        }
      }
      return Object.freeze({
        roleId: role.roleId,
        status,
        eligiblePassportIds: Object.freeze(
          eligible.map((candidate) => candidate.passport.passportId).sort(codeUnitCompare)
        ),
        failedRequirements: Object.freeze(failures.sort(codeUnitCompare))
      });
    })
  );
}

function secretRequirements(config: CanonicalBootstrapConfig): readonly CanonicalSecretRequirement[] {
  const byName = new Map<string, CanonicalSecretRequirement>();
  const values: CanonicalSecretRequirement[] = [...config.requiredSecrets];
  for (const database of config.databases) {
    for (const logicalName of database.credentialLogicalNames) {
      values.push(
        Object.freeze({
          logicalName,
          purpose: `Read-only Data Probe for ${database.databaseId}`,
          blockedCapability: `data-probe:${database.databaseId}`,
          required: true
        })
      );
    }
  }
  for (const value of values) {
    const existing = byName.get(value.logicalName);
    // Canonical encoding, not JSON.stringify: one of the two declarations is
    // built here and the other is parsed from canonical configuration, so
    // member insertion order is not something either side controls. Comparing
    // raw JSON.stringify output made the same declaration read as a conflict
    // whenever the two happened to carry their members in a different order.
    if (existing !== undefined && canonicalizeJsonV2(existing) !== canonicalizeJsonV2(value)) {
      fail("Logical secret has conflicting declarations");
    }
    byName.set(value.logicalName, Object.freeze({ ...value }));
  }
  return Object.freeze(normalizeDeclaredSet([...byName.values()], (entry) => entry.logicalName));
}

export class MachineBootstrapService {
  readonly #discovery: DriverDiscoveryPort;
  readonly #secrets: SecretBindingInspectorPort;
  readonly #profiles: MachineProfileStorePort;
  readonly #now: () => string;

  constructor(options: {
    readonly discovery: DriverDiscoveryPort;
    readonly secrets: SecretBindingInspectorPort;
    readonly profiles: MachineProfileStorePort;
    readonly now: () => string;
  }) {
    this.#discovery = options.discovery;
    this.#secrets = options.secrets;
    this.#profiles = options.profiles;
    this.#now = options.now;
  }

  async execute(input: {
    readonly config: CanonicalBootstrapConfig;
    readonly installedCliVersion: string;
    readonly machineId: string;
  }): Promise<BootstrapResult> {
    const config = validateConfig(input.config);
    let installed: readonly number[];
    try {
      StableId.parse(input.machineId, "machine");
      installed = semver(input.installedCliVersion, "Installed CLI version");
    } catch (error) {
      fail("Local bootstrap identity is invalid", error);
    }
    const minimum = semver(config.minimumCliVersion, "Minimum CLI version");
    if (config.configVersion !== 1 || compareSemver(installed, minimum) < 0) {
      throw new BootstrapError("VES_BOOTSTRAP_CONFIG_INCOMPATIBLE", "Canonical configuration is incompatible", {
        configVersion: config.configVersion,
        minimumCliVersion: config.minimumCliVersion
      });
    }
    let discovered: readonly LocalDriverCandidate[];
    try {
      discovered = await this.#discovery.discover();
    } catch (error) {
      throw new BootstrapError("VES_BOOTSTRAP_DISCOVERY_FAILED", "Local Driver discovery failed", {}, { cause: error });
    }
    const candidates = validateCandidates(discovered, this.#now());
    const roles = resolveRoles(config.roles, candidates.eligible);
    const missing: MissingBinding[] = [];
    const bindings: MachineProfile["secretBindings"][number][] = [];
    try {
      for (const requirement of secretRequirements(config)) {
        const request = Object.freeze({
          workspaceId: config.workspaceId,
          logicalName: requirement.logicalName,
          purpose: requirement.purpose,
          blockedCapability: requirement.blockedCapability,
          expectedStore: this.#secrets.expectedStore
        });
        const bound = await this.#secrets.isBound(request);
        bindings.push(
          Object.freeze({
            logicalName: requirement.logicalName,
            status: bound ? "bound" : "missing",
            required: requirement.required,
            expectedStore: this.#secrets.expectedStore
          })
        );
        if (!bound) {
          missing.push(
            Object.freeze({
              logicalName: request.logicalName,
              expectedStore: request.expectedStore,
              purpose: request.purpose,
              blockedCapability: request.blockedCapability,
              required: requirement.required
            })
          );
        }
      }
    } catch (error) {
      throw new BootstrapError(
        "VES_BOOTSTRAP_PROFILE_FAILED",
        "Local secret binding inspection failed",
        {},
        { cause: error }
      );
    }
    const profile: MachineProfile = Object.freeze({
      schemaVersion: 1,
      workspaceId: config.workspaceId,
      machineId: input.machineId,
      cliVersion: input.installedCliVersion,
      configVersion: config.configVersion,
      drivers: candidates.eligible,
      roles,
      secretBindings: Object.freeze(bindings)
    });
    let receipt: MachineProfileSaveReceipt;
    try {
      receipt = await this.#profiles.save(profile);
    } catch (error) {
      if (error instanceof BootstrapError) throw error;
      throw new BootstrapError(
        "VES_BOOTSTRAP_PROFILE_FAILED",
        "Machine Profile persistence failed",
        {},
        { cause: error }
      );
    }
    const blocked = roles.some((role) => role.status === "blocked") || missing.some((binding) => binding.required);
    const degraded = roles.some((role) => role.status === "degraded-independence");
    return Object.freeze({
      schemaVersion: 1,
      status: blocked ? "blocked" : degraded ? "degraded" : "ready",
      detectedDriverIds: candidates.detectedDriverIds,
      roles,
      missingBindings: Object.freeze(missing),
      profileDigest: receipt.profileDigest,
      profileChanged: receipt.changed
    });
  }
}
