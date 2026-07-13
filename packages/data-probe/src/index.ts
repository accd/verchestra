import { createHash } from "node:crypto";

export const packageName = "@verchestra/data-probe" as const;

const ENGINES = ["postgresql", "mysql", "mariadb", "sqlserver", "oracle", "sqlite", "mongodb"] as const;
const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const IDENTIFIER = /^[a-z][a-z0-9._-]{0,126}[a-z0-9]$/u;
const WORKSPACE_ID = /^workspace_[a-z0-9-]{20,128}$/u;
const SOURCE_REF = /^[a-z][a-z0-9-]{0,31}:[^\u0000-\u001f]{1,480}$/u;
const PROTECTED_REF = /^protected-request:[a-z0-9-]{16,128}$/u;

type Engine = (typeof ENGINES)[number];
type Classification = (typeof CLASSIFICATIONS)[number];
interface UnknownRecord extends Record<string, unknown> {
  schemaVersion?: unknown;
  workspaceId?: unknown;
  requestId?: unknown;
  databaseId?: unknown;
  engine?: unknown;
  logicalEnvironment?: unknown;
  classification?: unknown;
  approvedSchemas?: unknown;
  schemaSourceRefs?: unknown;
  allowedPurposes?: unknown;
  logicalCredentialName?: unknown;
  production?: unknown;
  policyRef?: unknown;
  purpose?: unknown;
  operation?: unknown;
  bounds?: unknown;
  grantRef?: unknown;
  kind?: unknown;
  statementCount?: unknown;
  protectedRequestRef?: unknown;
  objects?: unknown;
  functions?: unknown;
  parameterClassifications?: unknown;
  schema?: unknown;
  name?: unknown;
  type?: unknown;
  allowedObjects?: unknown;
  allowedFunctions?: unknown;
  deniedFunctions?: unknown;
  allowCatalogAccess?: unknown;
  maxTimeoutMs?: unknown;
  maxRows?: unknown;
  maxBytes?: unknown;
  maxConcurrency?: unknown;
  timeoutMs?: unknown;
  rowLimit?: unknown;
  byteLimit?: unknown;
  concurrencyLimit?: unknown;
}

export class DatabaseProbeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DatabaseProbeError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new DatabaseProbeError(code, message);
}

function record(value: unknown, code: string, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(code, `${label} is invalid`);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], code: string, label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${label} fields are invalid`);
  }
}

function textValue(value: unknown, pattern: RegExp, code: string, label: string): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(code, `${label} is invalid`);
  return value;
}

function positiveInteger(value: unknown, code: string, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(code, `${label} is invalid`);
  return value as number;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const input = value as UnknownRecord;
  return `{${Object.keys(input)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(input[key])}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const child of Object.values(value as UnknownRecord)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function uniqueSorted(values: unknown, pattern: RegExp, code: string, label: string, allowEmpty = false): string[] {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) || values.length > 256) {
    fail(code, `${label} is invalid`);
  }
  return [...new Set(values.map((value) => textValue(value, pattern, code, label)))].sort();
}

export interface DatabaseRegistrationInput {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly databaseId: string;
  readonly engine: Engine;
  readonly logicalEnvironment: string;
  readonly classification: Classification;
  readonly approvedSchemas: readonly string[];
  readonly schemaSourceRefs: readonly string[];
  readonly allowedPurposes: readonly string[];
  readonly logicalCredentialName: string;
  readonly production: boolean;
  readonly policyRef: string;
}

export interface DatabaseRegistration extends DatabaseRegistrationInput {
  readonly registrationDigest: string;
}

export function normalizeDatabaseRegistration(value: unknown): DatabaseRegistration {
  const input = record(value, "VES_DATABASE_REGISTRATION_INVALID", "Database registration");
  exactKeys(
    input,
    [
      "schemaVersion",
      "workspaceId",
      "databaseId",
      "engine",
      "logicalEnvironment",
      "classification",
      "approvedSchemas",
      "schemaSourceRefs",
      "allowedPurposes",
      "logicalCredentialName",
      "production",
      "policyRef"
    ],
    "VES_DATABASE_REGISTRATION_INVALID",
    "Database registration"
  );
  if (input.schemaVersion !== 1) fail("VES_DATABASE_REGISTRATION_INVALID", "Database schema version is invalid");
  const workspaceId = textValue(
    input.workspaceId,
    WORKSPACE_ID,
    "VES_DATABASE_REGISTRATION_INVALID",
    "Workspace identity"
  );
  const databaseId = textValue(input.databaseId, IDENTIFIER, "VES_DATABASE_REGISTRATION_INVALID", "Database identity");
  if (typeof input.engine !== "string" || !ENGINES.includes(input.engine as Engine)) {
    fail("VES_DATABASE_ENGINE_UNSUPPORTED", "Database engine is unsupported");
  }
  if (typeof input.classification !== "string" || !CLASSIFICATIONS.includes(input.classification as Classification)) {
    fail("VES_DATABASE_REGISTRATION_INVALID", "Database classification is invalid");
  }
  if (typeof input.production !== "boolean") {
    fail("VES_DATABASE_REGISTRATION_INVALID", "Database production flag is invalid");
  }
  const material: DatabaseRegistrationInput = {
    schemaVersion: 1,
    workspaceId,
    databaseId,
    engine: input.engine as Engine,
    logicalEnvironment: textValue(
      input.logicalEnvironment,
      IDENTIFIER,
      "VES_DATABASE_REGISTRATION_INVALID",
      "Logical environment"
    ),
    classification: input.classification as Classification,
    approvedSchemas: uniqueSorted(
      input.approvedSchemas,
      IDENTIFIER,
      "VES_DATABASE_REGISTRATION_INVALID",
      "Approved schemas"
    ),
    schemaSourceRefs: uniqueSorted(
      input.schemaSourceRefs,
      SOURCE_REF,
      "VES_DATABASE_REGISTRATION_INVALID",
      "Schema source references"
    ),
    allowedPurposes: uniqueSorted(
      input.allowedPurposes,
      IDENTIFIER,
      "VES_DATABASE_REGISTRATION_INVALID",
      "Allowed purposes"
    ),
    logicalCredentialName: textValue(
      input.logicalCredentialName,
      IDENTIFIER,
      "VES_DATABASE_REGISTRATION_INVALID",
      "Logical credential name"
    ),
    production: input.production,
    policyRef: textValue(input.policyRef, IDENTIFIER, "VES_DATABASE_REGISTRATION_INVALID", "Policy reference")
  };
  return deepFreeze({ ...material, registrationDigest: digest(material) }) as DatabaseRegistration;
}

export interface DatabaseRegistrationStorePort {
  save(registration: DatabaseRegistration): Promise<{ readonly created: boolean }>;
  load(workspaceId: string, databaseId: string): Promise<DatabaseRegistration | undefined>;
  list(workspaceId: string): Promise<readonly DatabaseRegistration[]>;
}

export class MemoryDatabaseRegistrationStore implements DatabaseRegistrationStorePort {
  readonly #registrations = new Map<string, DatabaseRegistration>();

  async save(registration: DatabaseRegistration): Promise<{ readonly created: boolean }> {
    const key = `${registration.workspaceId}\0${registration.databaseId}`;
    const current = this.#registrations.get(key);
    if (current !== undefined && current.registrationDigest !== registration.registrationDigest) {
      fail("VES_DATABASE_REGISTRATION_CONFLICT", "Database registration identity already has different content");
    }
    if (current !== undefined) return Object.freeze({ created: false });
    this.#registrations.set(key, registration);
    return Object.freeze({ created: true });
  }

  async load(workspaceId: string, databaseId: string): Promise<DatabaseRegistration | undefined> {
    return this.#registrations.get(`${workspaceId}\0${databaseId}`);
  }

  async list(workspaceId: string): Promise<readonly DatabaseRegistration[]> {
    return Object.freeze(
      [...this.#registrations.values()]
        .filter((item) => item.workspaceId === workspaceId)
        .sort((left, right) => left.databaseId.localeCompare(right.databaseId))
    );
  }
}

export class DatabaseRegistry {
  readonly #store: DatabaseRegistrationStorePort;

  constructor(options: { readonly store: DatabaseRegistrationStorePort }) {
    this.#store = options.store;
  }

  async register(input: unknown): Promise<{ readonly created: boolean; readonly registration: DatabaseRegistration }> {
    const registration = normalizeDatabaseRegistration(input);
    const receipt = await this.#store.save(registration);
    return Object.freeze({ ...receipt, registration });
  }

  async resolve(workspaceId: string, databaseId: string): Promise<DatabaseRegistration> {
    const registration = await this.#store.load(workspaceId, databaseId);
    if (registration === undefined) fail("VES_DATABASE_NOT_FOUND", "Database registration was not found");
    return registration;
  }

  async list(workspaceId: string): Promise<readonly DatabaseRegistration[]> {
    return this.#store.list(workspaceId);
  }
}

export interface NormalizedDatabaseObject {
  readonly schema: string;
  readonly name: string;
  readonly type: "table" | "view" | "catalog";
}

export interface NormalizedReadOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly NormalizedDatabaseObject[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

export interface ProbeBounds {
  readonly timeoutMs: number;
  readonly rowLimit: number;
  readonly byteLimit: number;
  readonly concurrencyLimit: number;
}

export interface DatabaseAccessPolicy {
  readonly policyRef: string;
  readonly allowedObjects: readonly string[];
  readonly allowedFunctions: readonly string[];
  readonly deniedFunctions: readonly string[];
  readonly allowCatalogAccess: boolean;
  readonly maxTimeoutMs: number;
  readonly maxRows: number;
  readonly maxBytes: number;
  readonly maxConcurrency: number;
}

export interface ProbeViolation {
  readonly code: string;
  readonly message: string;
}

export interface DatabaseEngineAdapterPort {
  readonly engine: Engine;
  validateNormalizedOperation(
    operation: NormalizedReadOperation,
    registration: DatabaseRegistration
  ): readonly ProbeViolation[];
}

function normalizeOperation(value: unknown): NormalizedReadOperation {
  const input = record(value, "VES_PROBE_OPERATION_INVALID", "Read operation");
  exactKeys(
    input,
    ["kind", "statementCount", "protectedRequestRef", "objects", "functions", "parameterClassifications"],
    "VES_PROBE_OPERATION_INVALID",
    "Read operation"
  );
  if (input.kind !== "select" && input.kind !== "introspect") {
    fail("VES_PROBE_WRITE_DENIED", "Only normalized read operations are permitted");
  }
  if (input.statementCount !== 1) fail("VES_PROBE_MULTI_STATEMENT_DENIED", "Exactly one read statement is permitted");
  const protectedRequestRef = textValue(
    input.protectedRequestRef,
    PROTECTED_REF,
    "VES_PROBE_OPERATION_INVALID",
    "Protected request reference"
  );
  if (!Array.isArray(input.objects) || input.objects.length === 0 || input.objects.length > 128) {
    fail("VES_PROBE_OPERATION_INVALID", "Database objects are invalid");
  }
  const objectMap = new Map<string, NormalizedDatabaseObject>();
  for (const rawObject of input.objects) {
    const object = record(rawObject, "VES_PROBE_OPERATION_INVALID", "Database object");
    exactKeys(object, ["schema", "name", "type"], "VES_PROBE_OPERATION_INVALID", "Database object");
    if (!(["table", "view", "catalog"] as const).includes(object.type as "table")) {
      fail("VES_PROBE_OPERATION_INVALID", "Database object type is invalid");
    }
    const normalized = {
      schema: textValue(object.schema, IDENTIFIER, "VES_PROBE_OPERATION_INVALID", "Database schema"),
      name: textValue(object.name, IDENTIFIER, "VES_PROBE_OPERATION_INVALID", "Database object name"),
      type: object.type as "table" | "view" | "catalog"
    };
    objectMap.set(`${normalized.schema}.${normalized.name}.${normalized.type}`, normalized);
  }
  const parameterClassifications = uniqueSorted(
    input.parameterClassifications,
    /^[a-z]+$/u,
    "VES_PROBE_OPERATION_INVALID",
    "Parameter classifications",
    true
  );
  if (parameterClassifications.some((item) => !CLASSIFICATIONS.includes(item as Classification))) {
    fail("VES_PROBE_OPERATION_INVALID", "Parameter classification is invalid");
  }
  return deepFreeze({
    kind: input.kind,
    statementCount: 1,
    protectedRequestRef,
    objects: [...objectMap.values()].sort((left, right) =>
      `${left.schema}.${left.name}.${left.type}`.localeCompare(`${right.schema}.${right.name}.${right.type}`)
    ),
    functions: uniqueSorted(
      Array.isArray(input.functions)
        ? input.functions.map((item) => (typeof item === "string" ? item.toLowerCase() : item))
        : input.functions,
      IDENTIFIER,
      "VES_PROBE_OPERATION_INVALID",
      "Database functions",
      true
    ).map((item) => item.toLowerCase()),
    parameterClassifications: parameterClassifications as Classification[]
  }) as NormalizedReadOperation;
}

function normalizePolicy(value: unknown): DatabaseAccessPolicy {
  const input = record(value, "VES_PROBE_POLICY_INVALID", "Database access policy");
  exactKeys(
    input,
    [
      "policyRef",
      "allowedObjects",
      "allowedFunctions",
      "deniedFunctions",
      "allowCatalogAccess",
      "maxTimeoutMs",
      "maxRows",
      "maxBytes",
      "maxConcurrency"
    ],
    "VES_PROBE_POLICY_INVALID",
    "Database access policy"
  );
  if (typeof input.allowCatalogAccess !== "boolean") fail("VES_PROBE_POLICY_INVALID", "Catalog policy is invalid");
  return deepFreeze({
    policyRef: textValue(input.policyRef, IDENTIFIER, "VES_PROBE_POLICY_INVALID", "Policy reference"),
    allowedObjects: uniqueSorted(
      input.allowedObjects,
      /^[a-z][a-z0-9_-]{0,126}\.[a-z][a-z0-9_-]{0,126}$/u,
      "VES_PROBE_POLICY_INVALID",
      "Allowed objects"
    ),
    allowedFunctions: uniqueSorted(
      input.allowedFunctions,
      IDENTIFIER,
      "VES_PROBE_POLICY_INVALID",
      "Allowed functions",
      true
    ).map((item) => item.toLowerCase()),
    deniedFunctions: uniqueSorted(
      input.deniedFunctions,
      IDENTIFIER,
      "VES_PROBE_POLICY_INVALID",
      "Denied functions",
      true
    ).map((item) => item.toLowerCase()),
    allowCatalogAccess: input.allowCatalogAccess,
    maxTimeoutMs: positiveInteger(input.maxTimeoutMs, "VES_PROBE_POLICY_INVALID", "Maximum timeout"),
    maxRows: positiveInteger(input.maxRows, "VES_PROBE_POLICY_INVALID", "Maximum rows"),
    maxBytes: positiveInteger(input.maxBytes, "VES_PROBE_POLICY_INVALID", "Maximum bytes"),
    maxConcurrency: positiveInteger(input.maxConcurrency, "VES_PROBE_POLICY_INVALID", "Maximum concurrency")
  }) as DatabaseAccessPolicy;
}

function normalizeBounds(value: unknown, policy: DatabaseAccessPolicy): ProbeBounds {
  const input = record(value, "VES_PROBE_BOUNDS_DENIED", "Probe bounds");
  exactKeys(
    input,
    ["timeoutMs", "rowLimit", "byteLimit", "concurrencyLimit"],
    "VES_PROBE_BOUNDS_DENIED",
    "Probe bounds"
  );
  const bounds = {
    timeoutMs: positiveInteger(input.timeoutMs, "VES_PROBE_BOUNDS_DENIED", "Statement timeout"),
    rowLimit: positiveInteger(input.rowLimit, "VES_PROBE_BOUNDS_DENIED", "Row limit"),
    byteLimit: positiveInteger(input.byteLimit, "VES_PROBE_BOUNDS_DENIED", "Byte limit"),
    concurrencyLimit: positiveInteger(input.concurrencyLimit, "VES_PROBE_BOUNDS_DENIED", "Concurrency limit")
  };
  if (
    bounds.timeoutMs > policy.maxTimeoutMs ||
    bounds.rowLimit > policy.maxRows ||
    bounds.byteLimit > policy.maxBytes ||
    bounds.concurrencyLimit > policy.maxConcurrency
  ) {
    fail("VES_PROBE_BOUNDS_DENIED", "Probe bounds exceed policy");
  }
  return deepFreeze(bounds) as ProbeBounds;
}

export interface ProbePlan {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly requestId: string;
  readonly databaseId: string;
  readonly registrationDigest: string;
  readonly engine: Engine;
  readonly logicalEnvironment: string;
  readonly classification: Classification;
  readonly production: boolean;
  readonly purpose: string;
  readonly policyRef: string;
  readonly logicalCredentialName: string;
  readonly operation: NormalizedReadOperation;
  readonly statementFingerprint: string;
  readonly bounds: ProbeBounds;
  readonly concurrencyKey: string;
  readonly requiredIdentityChecks: readonly ["database-principal-read-only", "engine-session-read-only"];
  readonly resultHandling: "local-untrusted-evidence-pending-promotion";
  readonly grantRef: string;
  readonly planDigest: string;
}

export class ProbePlanner {
  readonly #registry: DatabaseRegistry;
  readonly #adapters = new Map<Engine, DatabaseEngineAdapterPort>();

  constructor(options: {
    readonly registry: DatabaseRegistry;
    readonly adapters: readonly DatabaseEngineAdapterPort[];
  }) {
    this.#registry = options.registry;
    for (const adapter of options.adapters) {
      if (
        typeof adapter !== "object" ||
        adapter === null ||
        !ENGINES.includes(adapter.engine) ||
        typeof adapter.validateNormalizedOperation !== "function" ||
        this.#adapters.has(adapter.engine)
      ) {
        fail("VES_PROBE_ADAPTER_INVALID", "Database engine adapter is invalid or duplicated");
      }
      this.#adapters.set(adapter.engine, adapter);
    }
  }

  async plan(rawRequest: unknown, rawPolicy: unknown): Promise<ProbePlan> {
    const request = record(rawRequest, "VES_PROBE_REQUEST_INVALID", "Probe request");
    exactKeys(
      request,
      ["schemaVersion", "workspaceId", "requestId", "databaseId", "purpose", "operation", "bounds", "grantRef"],
      "VES_PROBE_REQUEST_INVALID",
      "Probe request"
    );
    if (request.schemaVersion !== 1) fail("VES_PROBE_REQUEST_INVALID", "Probe request version is invalid");
    const workspaceId = textValue(request.workspaceId, WORKSPACE_ID, "VES_PROBE_REQUEST_INVALID", "Workspace identity");
    const databaseId = textValue(request.databaseId, IDENTIFIER, "VES_PROBE_REQUEST_INVALID", "Database identity");
    const registration = await this.#registry.resolve(workspaceId, databaseId);
    const adapter = this.#adapters.get(registration.engine);
    if (adapter === undefined) fail("VES_PROBE_ENGINE_UNAVAILABLE", "Qualified database engine adapter is unavailable");
    const policy = normalizePolicy(rawPolicy);
    if (policy.policyRef !== registration.policyRef)
      fail("VES_PROBE_POLICY_MISMATCH", "Database policy reference differs");
    const purpose = textValue(request.purpose, IDENTIFIER, "VES_PROBE_REQUEST_INVALID", "Probe purpose");
    if (!registration.allowedPurposes.includes(purpose))
      fail("VES_PROBE_PURPOSE_DENIED", "Probe purpose is not approved");
    const operation = normalizeOperation(request.operation);
    const bounds = normalizeBounds(request.bounds, policy);
    for (const object of operation.objects) {
      if (!registration.approvedSchemas.includes(object.schema)) {
        fail("VES_PROBE_SCHEMA_DENIED", "Database schema is not registered");
      }
      if (object.type === "catalog" && !policy.allowCatalogAccess) {
        fail("VES_PROBE_CATALOG_DENIED", "Database catalog access is denied");
      }
      if (!policy.allowedObjects.includes(`${object.schema}.${object.name}`)) {
        fail("VES_PROBE_OBJECT_DENIED", "Database object is not approved");
      }
    }
    for (const fn of operation.functions) {
      if (policy.deniedFunctions.includes(fn) || !policy.allowedFunctions.includes(fn)) {
        fail("VES_PROBE_FUNCTION_DENIED", "Database function is not approved");
      }
    }
    const violations = adapter.validateNormalizedOperation(operation, registration);
    if (!Array.isArray(violations) || violations.length > 0) {
      fail("VES_PROBE_ENGINE_POLICY_DENIED", "Engine-specific validation denied the read operation");
    }
    const material = {
      schemaVersion: 1 as const,
      workspaceId,
      requestId: textValue(request.requestId, IDENTIFIER, "VES_PROBE_REQUEST_INVALID", "Probe request identity"),
      databaseId,
      registrationDigest: registration.registrationDigest,
      engine: registration.engine,
      logicalEnvironment: registration.logicalEnvironment,
      classification: registration.classification,
      production: registration.production,
      purpose,
      policyRef: policy.policyRef,
      logicalCredentialName: registration.logicalCredentialName,
      operation,
      statementFingerprint: digest(operation),
      bounds,
      concurrencyKey: `${workspaceId}:${databaseId}`,
      requiredIdentityChecks: ["database-principal-read-only", "engine-session-read-only"] as const,
      resultHandling: "local-untrusted-evidence-pending-promotion" as const,
      grantRef: textValue(request.grantRef, IDENTIFIER, "VES_PROBE_REQUEST_INVALID", "Capability Grant reference")
    };
    return deepFreeze({ ...material, planDigest: digest(material) }) as ProbePlan;
  }
}
