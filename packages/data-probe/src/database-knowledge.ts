import { codeUnitCompare, digest } from "./canonical-material.ts";

const SOURCE_KINDS = ["er", "ddl", "migration", "orm", "introspection"] as const;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,126}$/u;
const STABLE_ID = /^[a-z][a-z0-9._-]{2,127}$/u;
const LOGICAL_REF = /^[a-z][a-z0-9._:/-]{2,255}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVIEW_REF = /^human-review-[a-z0-9._-]{3,127}$/u;
const RUN_ID = /^run-[a-z0-9-]{16,128}$/u;
const REQUIREMENT_ID = /^VES-[A-Z0-9]{2,8}-[0-9]{3}$/u;
const CRITERION_ID = /^AC-[A-Z0-9-]{3,64}$/u;
const ENTITY_REF = /^[a-z][a-z0-9_]{0,126}\.[a-z][a-z0-9_]{0,126}$/u;
const FACT_KEY = /^[a-z][a-z0-9_.]{2,255}$/u;
const GENERATORS = new Set(["boolean", "decimal", "email", "enum", "integer", "timestamp", "uuid", "words"]);
const SENSITIVE_CLAIM_VALUE =
  /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:password|credential|secret|token|api[_-]?key)\b\s*[=:]|\bbearer\s+[a-z0-9._-]+|\b(?:gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-[a-z0-9_-]{20,}|xox[baprs]-[a-z0-9-]{10,}|akia[a-z0-9]{16}|eyj[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})\b|\b(?:postgres(?:ql)?|mysql|mongodb|mariadb|sqlserver|oracle):\/\/|:\/\/[^\s/]+@)/iu;
type UnknownRecord = Readonly<Record<string, unknown>>;
type SourceKind = (typeof SOURCE_KINDS)[number];

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as UnknownRecord)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export class DatabaseKnowledgeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DatabaseKnowledgeError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new DatabaseKnowledgeError(code, message);
}
function record(value: unknown, code: string, message: string): UnknownRecord {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail(code, message);
  return value as UnknownRecord;
}
function exactKeys(value: UnknownRecord, keys: readonly string[], code: string, message: string) {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail(code, message);
}
function text(value: unknown, pattern: RegExp, code: string, message: string): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(code, message);
  return value;
}
function instant(value: unknown, code: string, message: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    fail(code, message);
  return value;
}
function positive(value: unknown, code: string, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) fail(code, message);
  return value as number;
}
function isEmailValue(value: string): boolean {
  let at = -1;
  let dotAfterAt = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] as string;
    if (/\s/u.test(character)) return false;
    if (character === "@") {
      if (at !== -1 || index === 0) return false;
      at = index;
      continue;
    }
    if (character === "." && at !== -1 && dotAfterAt === -1) dotAfterAt = index;
  }
  return at > 0 && dotAfterAt > at + 1 && dotAfterAt < value.length - 1;
}

interface SchemaColumn {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
}
interface SchemaEntity {
  readonly schema: string;
  readonly name: string;
  readonly type: "table" | "view";
  readonly columns: readonly SchemaColumn[];
}
export interface DatabaseSchemaSource {
  readonly schemaVersion: 1;
  readonly sourceId: string;
  readonly kind: SourceKind;
  readonly databaseId: string;
  readonly revision: string;
  readonly capturedAt: string;
  readonly logicalRef: string;
  readonly coverage: "complete" | "partial";
  readonly entities: readonly SchemaEntity[];
  readonly sourceDigest: string;
}

function importSchemaSource(value: unknown, expectedKind: SourceKind): DatabaseSchemaSource {
  const code = "VES_DATABASE_SCHEMA_SOURCE_INVALID";
  const input = record(value, code, "Database schema source is invalid");
  exactKeys(
    input,
    ["schemaVersion", "sourceId", "kind", "databaseId", "revision", "capturedAt", "logicalRef", "coverage", "entities"],
    code,
    "Database schema source is invalid"
  );
  if (input["schemaVersion"] !== 1) fail(code, "Database schema source version is invalid");
  if (input["kind"] !== expectedKind)
    fail("VES_DATABASE_SCHEMA_SOURCE_KIND_INVALID", "Database schema source kind is invalid");
  if (input["coverage"] !== "complete" && input["coverage"] !== "partial")
    fail(code, "Database schema source coverage is invalid");
  const logicalRef = text(input["logicalRef"], LOGICAL_REF, code, "Database schema source reference is invalid");
  if (logicalRef.includes("://") || /(?:password|credential|token|secret)/iu.test(logicalRef))
    fail(code, "Database schema source reference is invalid");
  if (!Array.isArray(input["entities"]) || input["entities"].length === 0 || input["entities"].length > 512)
    fail(code, "Database schema entities are invalid");
  const entities = new Map<string, SchemaEntity>();
  for (const rawEntity of input["entities"]) {
    const entity = record(rawEntity, code, "Database schema entity is invalid");
    exactKeys(entity, ["schema", "name", "type", "columns"], code, "Database schema entity is invalid");
    const schema = text(entity["schema"], IDENTIFIER, code, "Database schema entity is invalid");
    const name = text(entity["name"], IDENTIFIER, code, "Database schema entity is invalid");
    if (entity["type"] !== "table" && entity["type"] !== "view") fail(code, "Database schema entity type is invalid");
    if (!Array.isArray(entity["columns"]) || entity["columns"].length === 0 || entity["columns"].length > 1024)
      fail(code, "Database schema columns are invalid");
    const columns = new Map<string, SchemaColumn>();
    for (const rawColumn of entity["columns"]) {
      const column = record(rawColumn, code, "Database schema column is invalid");
      exactKeys(
        column,
        ["name", "dataType", "nullable", "primaryKey", "unique"],
        code,
        "Database schema column is invalid"
      );
      const columnName = text(
        column["name"],
        /^(?:_id|[a-z][a-z0-9_]{0,126})$/u,
        code,
        "Database schema column is invalid"
      );
      if (typeof column["dataType"] !== "string" || !/^[a-z][a-z0-9_(), ]{0,126}$/iu.test(column["dataType"]))
        fail(code, "Database schema data type is invalid");
      if ([column["nullable"], column["primaryKey"], column["unique"]].some((item) => typeof item !== "boolean"))
        fail(code, "Database schema constraints are invalid");
      if (columns.has(columnName)) fail(code, "Database schema column is duplicated");
      columns.set(columnName, {
        name: columnName,
        dataType: column["dataType"].trim().replace(/\s+/gu, " ").toLowerCase(),
        nullable: column["nullable"] as boolean,
        primaryKey: column["primaryKey"] as boolean,
        unique: column["unique"] as boolean
      });
    }
    const key = `${schema}.${name}`;
    if (entities.has(key)) fail(code, "Database schema entity is duplicated");
    entities.set(key, {
      schema,
      name,
      type: entity["type"],
      columns: [...columns.values()].sort((a, b) => codeUnitCompare(a.name, b.name))
    });
  }
  const material = {
    schemaVersion: 1 as const,
    sourceId: text(input["sourceId"], STABLE_ID, code, "Database schema source identity is invalid"),
    kind: expectedKind,
    databaseId: text(input["databaseId"], STABLE_ID, code, "Database schema database identity is invalid"),
    revision: text(input["revision"], STABLE_ID, code, "Database schema source revision is invalid"),
    capturedAt: instant(input["capturedAt"], code, "Database schema capture time is invalid"),
    logicalRef,
    coverage: input["coverage"] as "complete" | "partial",
    entities: [...entities.values()].sort((a, b) => codeUnitCompare(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`))
  };
  return deepFreeze({ ...material, sourceDigest: digest(material) });
}
export const importErSchemaSource = (value: unknown) => importSchemaSource(value, "er");
export const importDdlSchemaSource = (value: unknown) => importSchemaSource(value, "ddl");
export const importMigrationSchemaSource = (value: unknown) => importSchemaSource(value, "migration");
export const importOrmSchemaSource = (value: unknown) => importSchemaSource(value, "orm");
export const importIntrospectionSchemaSource = (value: unknown) => importSchemaSource(value, "introspection");

interface FactAlternative {
  readonly value: string | boolean;
  readonly valueDigest: string;
  readonly sourceIds: readonly string[];
}
interface KnowledgeFact {
  readonly factKey: string;
  readonly status: "agreed" | "contradictory";
  readonly alternatives: readonly FactAlternative[];
}
interface Contradiction {
  readonly contradictionId: string;
  readonly factKey: string;
  readonly alternatives: readonly FactAlternative[];
  readonly status: "unresolved" | "resolved";
  readonly requiredResolution: true;
  readonly resolution?: {
    readonly selectedValueDigest: string;
    readonly humanReviewRef: string;
    readonly resolvedAt: string;
  };
}
export interface DatabaseKnowledgePackage {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly databaseId: string;
  readonly generation: number;
  readonly sources: readonly DatabaseSchemaSource[];
  readonly facts: readonly KnowledgeFact[];
  readonly contradictions: readonly Contradiction[];
  readonly packageDigest: string;
}
function packageWithDigest(material: Omit<DatabaseKnowledgePackage, "packageDigest">): DatabaseKnowledgePackage {
  return deepFreeze({ ...material, packageDigest: digest(material) });
}
function packageDigestOf(packageValue: DatabaseKnowledgePackage): string {
  return digest({
    schemaVersion: packageValue.schemaVersion,
    workspaceId: packageValue.workspaceId,
    databaseId: packageValue.databaseId,
    generation: packageValue.generation,
    sources: packageValue.sources,
    facts: packageValue.facts,
    contradictions: packageValue.contradictions
  });
}
export function buildDatabaseKnowledgePackage(value: unknown): DatabaseKnowledgePackage {
  const code = "VES_DATABASE_KNOWLEDGE_INVALID";
  const input = record(value, code, "Database Knowledge Package is invalid");
  exactKeys(
    input,
    ["schemaVersion", "workspaceId", "databaseId", "generation", "sources"],
    code,
    "Database Knowledge Package is invalid"
  );
  if (
    input["schemaVersion"] !== 1 ||
    !Array.isArray(input["sources"]) ||
    input["sources"].length === 0 ||
    input["sources"].length > 128
  )
    fail(code, "Database Knowledge Package is invalid");
  const workspaceId = text(
    input["workspaceId"],
    /^workspace_[a-f0-9-]{36}$/u,
    code,
    "Database Knowledge Workspace is invalid"
  );
  const databaseId = text(input["databaseId"], STABLE_ID, code, "Database Knowledge database is invalid");
  const generation = positive(input["generation"], code, "Database Knowledge generation is invalid");
  const sourcesById = new Map<string, DatabaseSchemaSource>();
  for (const rawSource of input["sources"] as DatabaseSchemaSource[]) {
    if (!SOURCE_KINDS.includes(rawSource.kind)) fail(code, "Database Knowledge source is invalid");
    const normalized = importSchemaSource(
      {
        schemaVersion: rawSource.schemaVersion,
        sourceId: rawSource.sourceId,
        kind: rawSource.kind,
        databaseId: rawSource.databaseId,
        revision: rawSource.revision,
        capturedAt: rawSource.capturedAt,
        logicalRef: rawSource.logicalRef,
        coverage: rawSource.coverage,
        entities: rawSource.entities
      },
      rawSource.kind
    );
    if (
      normalized.databaseId !== databaseId ||
      !DIGEST.test(rawSource.sourceDigest) ||
      normalized.sourceDigest !== rawSource.sourceDigest
    )
      fail(code, "Database Knowledge source is invalid");
    const current = sourcesById.get(normalized.sourceId);
    if (current !== undefined && current.sourceDigest !== normalized.sourceDigest)
      fail("VES_DATABASE_SCHEMA_SOURCE_CONFLICT", "Database schema source identity has conflicting evidence");
    sourcesById.set(normalized.sourceId, normalized);
  }
  const sources = [...sourcesById.values()].sort(
    (a, b) => codeUnitCompare(a.kind, b.kind) || codeUnitCompare(a.sourceId, b.sourceId)
  );
  const claims = new Map<string, Map<string, { value: string | boolean; sourceIds: Set<string> }>>();
  const add = (factKey: string, value: string | boolean, sourceId: string) => {
    const alternatives = claims.get(factKey) ?? new Map();
    const valueDigest = digest(value);
    const alternative = alternatives.get(valueDigest) ?? { value, sourceIds: new Set<string>() };
    alternative.sourceIds.add(sourceId);
    alternatives.set(valueDigest, alternative);
    claims.set(factKey, alternatives);
  };
  const entityUniverse = new Map<string, Set<string>>();
  for (const source of sources)
    for (const entity of source.entities) {
      const key = `${entity.schema}.${entity.name}`;
      const columns = entityUniverse.get(key) ?? new Set<string>();
      for (const column of entity.columns) columns.add(column.name);
      entityUniverse.set(key, columns);
    }
  for (const source of sources) {
    const sourceEntities = new Map(source.entities.map((entity) => [`${entity.schema}.${entity.name}`, entity]));
    for (const [entityKey, universeColumns] of entityUniverse) {
      const entity = sourceEntities.get(entityKey);
      if (source.coverage === "complete") add(`${entityKey}.present`, entity !== undefined, source.sourceId);
      if (entity === undefined) continue;
      add(`${entityKey}.entity_type`, entity.type, source.sourceId);
      const sourceColumns = new Map(entity.columns.map((column) => [column.name, column]));
      for (const columnName of universeColumns) {
        const column = sourceColumns.get(columnName);
        if (source.coverage === "complete")
          add(`${entityKey}.column.${columnName}.present`, column !== undefined, source.sourceId);
        if (column === undefined) continue;
        const prefix = `${entityKey}.column.${column.name}`;
        add(`${prefix}.data_type`, column.dataType, source.sourceId);
        add(`${prefix}.nullable`, column.nullable, source.sourceId);
        add(`${prefix}.primary_key`, column.primaryKey, source.sourceId);
        add(`${prefix}.unique`, column.unique, source.sourceId);
      }
    }
  }
  const facts: KnowledgeFact[] = [...claims.entries()]
    .sort(([a], [b]) => codeUnitCompare(a, b))
    .map(([factKey, values]) => {
      const alternatives = [...values.entries()]
        .sort(([a], [b]) => codeUnitCompare(a, b))
        .map(([valueDigest, item]) => ({ value: item.value, valueDigest, sourceIds: [...item.sourceIds].sort() }));
      return { factKey, status: alternatives.length === 1 ? "agreed" : "contradictory", alternatives };
    });
  const contradictions: Contradiction[] = facts
    .filter((fact) => fact.status === "contradictory")
    .map((fact) => ({
      contradictionId: digest({ factKey: fact.factKey, alternatives: fact.alternatives }),
      factKey: fact.factKey,
      alternatives: fact.alternatives,
      status: "unresolved",
      requiredResolution: true
    }));
  return packageWithDigest({ schemaVersion: 1, workspaceId, databaseId, generation, sources, facts, contradictions });
}

export function resolveDatabaseContradiction(
  packageValue: DatabaseKnowledgePackage,
  value: unknown
): DatabaseKnowledgePackage {
  const code = "VES_DATABASE_CONTRADICTION_RESOLUTION_INVALID";
  if (packageDigestOf(packageValue) !== packageValue.packageDigest)
    fail(code, "Database Knowledge Package digest is invalid");
  const input = record(value, code, "Database contradiction resolution is invalid");
  exactKeys(
    input,
    ["contradictionId", "selectedValueDigest", "humanReviewRef", "resolvedAt"],
    code,
    "Database contradiction resolution is invalid"
  );
  const contradictionId = text(input["contradictionId"], DIGEST, code, "Database contradiction identity is invalid");
  const selectedValueDigest = text(
    input["selectedValueDigest"],
    DIGEST,
    code,
    "Database contradiction selection is invalid"
  );
  const humanReviewRef = text(input["humanReviewRef"], REVIEW_REF, code, "Database contradiction review is invalid");
  const resolvedAt = instant(input["resolvedAt"], code, "Database contradiction resolution time is invalid");
  const current = packageValue.contradictions.find((item) => item.contradictionId === contradictionId);
  if (current === undefined || !current.alternatives.some((item) => item.valueDigest === selectedValueDigest))
    fail(code, "Database contradiction selection is invalid");
  if (current.status === "resolved") {
    if (
      current.resolution?.selectedValueDigest === selectedValueDigest &&
      current.resolution.humanReviewRef === humanReviewRef &&
      current.resolution.resolvedAt === resolvedAt
    )
      return packageValue;
    fail(code, "Database contradiction already has a different resolution");
  }
  const contradictions = packageValue.contradictions.map((item): Contradiction =>
    item.contradictionId === contradictionId
      ? {
          ...item,
          status: "resolved",
          resolution: { selectedValueDigest, humanReviewRef, resolvedAt }
        }
      : item
  );
  return packageWithDigest({
    schemaVersion: 1,
    workspaceId: packageValue.workspaceId,
    databaseId: packageValue.databaseId,
    generation: packageValue.generation + 1,
    sources: packageValue.sources,
    facts: packageValue.facts,
    contradictions
  });
}

interface PromotedProbeEvidence {
  readonly schemaVersion: 2;
  readonly workspaceId: string;
  readonly databaseId: string;
  readonly registrationDigest: string;
  readonly schemaIdentity: { readonly version: string; readonly fingerprint: string };
  readonly queryFingerprint: string;
  readonly parameterClassifications: readonly string[];
  readonly producedAt: string;
  readonly bounds: {
    readonly timeoutMs: number;
    readonly rowLimit: number;
    readonly byteLimit: number;
    readonly concurrencyLimit: number;
  };
  readonly rowCount: number;
  readonly byteCount: number;
  readonly resultDigest: string;
  readonly producingRunId: string;
  readonly redaction: UnknownRecord;
  readonly sanitizedClaims: readonly UnknownRecord[];
  readonly promotionStatus: "accepted-sanitized";
  readonly evidenceDigest: string;
}
function promotedEvidenceDigestOf(evidence: PromotedProbeEvidence): string {
  return digest(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== "evidenceDigest")));
}
export function promoteProbeEvidence(value: unknown): PromotedProbeEvidence {
  const code = "VES_PROBE_PROMOTION_INVALID";
  const input = record(value, code, "Probe evidence promotion is invalid");
  exactKeys(
    input,
    ["schemaVersion", "result", "schemaIdentity", "producingRunId", "redaction", "sanitizedClaims"],
    code,
    "Probe evidence promotion is invalid"
  );
  if (input["schemaVersion"] !== 1) fail(code, "Probe evidence promotion version is invalid");
  const result = record(input["result"], code, "Probe result evidence is invalid");
  exactKeys(
    result,
    [
      "schemaVersion",
      "status",
      "workspaceId",
      "databaseId",
      "registrationDigest",
      "planDigest",
      "queryFingerprint",
      "grantRef",
      "purpose",
      "classification",
      "parameterClassifications",
      "bounds",
      "rowCount",
      "byteCount",
      "protectedResultRef",
      "resultDigest",
      "principalFingerprint",
      "identityReadOnly",
      "sessionReadOnly",
      "producedAt"
    ],
    code,
    "Probe result evidence is invalid"
  );
  if (
    result["schemaVersion"] !== 1 ||
    result["status"] !== "complete" ||
    result["identityReadOnly"] !== true ||
    result["sessionReadOnly"] !== true
  )
    fail(code, "Probe result evidence is invalid");
  const schemaIdentity = record(input["schemaIdentity"], code, "Probe schema identity is invalid");
  exactKeys(schemaIdentity, ["version", "fingerprint"], code, "Probe schema identity is invalid");
  const redaction = record(input["redaction"], code, "Probe redaction evidence is invalid");
  exactKeys(
    redaction,
    ["policyRef", "method", "removedFields", "humanReviewRef"],
    code,
    "Probe redaction evidence is invalid"
  );
  if (redaction["method"] !== "allowlist" && redaction["method"] !== "aggregation")
    fail(code, "Probe redaction method is invalid");
  text(redaction["policyRef"], /^[a-z][a-z0-9._-]{2,127}$/u, code, "Probe redaction policy is invalid");
  text(redaction["humanReviewRef"], REVIEW_REF, code, "Probe redaction review is invalid");
  if (
    !Array.isArray(redaction["removedFields"]) ||
    redaction["removedFields"].some((item) => typeof item !== "string" || !/^[a-z][a-z0-9_.]{0,126}$/u.test(item))
  )
    fail(code, "Probe removed fields are invalid");
  if (
    !Array.isArray(input["sanitizedClaims"]) ||
    input["sanitizedClaims"].length === 0 ||
    input["sanitizedClaims"].length > 256
  )
    fail(code, "Probe sanitized claims are invalid");
  const claims = input["sanitizedClaims"].map((rawClaim) => {
    const claim = record(rawClaim, code, "Probe sanitized claim is invalid");
    exactKeys(claim, ["factKey", "value", "classification"], code, "Probe sanitized claim is invalid");
    const factKey = text(claim["factKey"], FACT_KEY, code, "Probe sanitized fact key is invalid");
    if (/(?:password|credential|secret|token)/iu.test(factKey)) fail(code, "Probe sanitized fact key is invalid");
    if (claim["classification"] !== "public" && claim["classification"] !== "internal")
      fail(code, "Probe sanitized claim classification is invalid");
    if (
      !["string", "number", "boolean"].includes(typeof claim["value"]) ||
      (typeof claim["value"] === "number" && !Number.isFinite(claim["value"])) ||
      (typeof claim["value"] === "string" && claim["value"].length > 512)
    )
      fail(code, "Probe sanitized claim value is invalid");
    if (
      typeof claim["value"] === "string" &&
      (isEmailValue(claim["value"]) || SENSITIVE_CLAIM_VALUE.test(claim["value"]))
    )
      fail(code, "Probe sanitized claim value is invalid");
    return {
      factKey,
      classification: claim["classification"],
      valueDigest: digest(claim["value"]),
      untrusted: true as const
    };
  });
  const bounds = record(result["bounds"], code, "Probe result bounds are invalid");
  exactKeys(
    bounds,
    ["timeoutMs", "rowLimit", "byteLimit", "concurrencyLimit"],
    code,
    "Probe result bounds are invalid"
  );
  const material = {
    schemaVersion: 2 as const,
    workspaceId: text(result["workspaceId"], /^workspace_[a-f0-9-]{36}$/u, code, "Probe Workspace is invalid"),
    databaseId: text(result["databaseId"], STABLE_ID, code, "Probe database is invalid"),
    registrationDigest: text(result["registrationDigest"], DIGEST, code, "Probe registration digest is invalid"),
    schemaIdentity: {
      version: text(schemaIdentity["version"], STABLE_ID, code, "Probe schema version is invalid"),
      fingerprint: text(schemaIdentity["fingerprint"], DIGEST, code, "Probe schema fingerprint is invalid")
    },
    queryFingerprint: text(result["queryFingerprint"], DIGEST, code, "Probe query fingerprint is invalid"),
    parameterClassifications: (() => {
      if (
        !Array.isArray(result["parameterClassifications"]) ||
        result["parameterClassifications"].some(
          (item) =>
            typeof item !== "string" || !["public", "internal", "confidential", "restricted", "secret"].includes(item)
        )
      )
        fail(code, "Probe parameter classifications are invalid");
      return [...result["parameterClassifications"]].sort() as string[];
    })(),
    producedAt: instant(result["producedAt"], code, "Probe production time is invalid"),
    bounds: {
      timeoutMs: positive(bounds["timeoutMs"], code, "Probe timeout is invalid"),
      rowLimit: positive(bounds["rowLimit"], code, "Probe row limit is invalid"),
      byteLimit: positive(bounds["byteLimit"], code, "Probe byte limit is invalid"),
      concurrencyLimit: positive(bounds["concurrencyLimit"], code, "Probe concurrency limit is invalid")
    },
    rowCount: (() => {
      if (!Number.isSafeInteger(result["rowCount"]) || (result["rowCount"] as number) < 0)
        fail(code, "Probe row count is invalid");
      return result["rowCount"] as number;
    })(),
    byteCount: (() => {
      if (!Number.isSafeInteger(result["byteCount"]) || (result["byteCount"] as number) < 0)
        fail(code, "Probe byte count is invalid");
      return result["byteCount"] as number;
    })(),
    resultDigest: text(result["resultDigest"], DIGEST, code, "Probe result digest is invalid"),
    producingRunId: text(input["producingRunId"], RUN_ID, code, "Probe producing run is invalid"),
    redaction: {
      policyRef: redaction["policyRef"],
      method: redaction["method"],
      removedFields: [...redaction["removedFields"]].sort(),
      humanReviewRef: redaction["humanReviewRef"]
    },
    sanitizedClaims: claims.toSorted((a, b) => codeUnitCompare(a.factKey, b.factKey)),
    promotionStatus: "accepted-sanitized" as const
  };
  return deepFreeze({ ...material, evidenceDigest: digest(material) });
}

function normalizePromotedProbeEvidence(value: unknown, code: string): PromotedProbeEvidence {
  const evidence = record(value, code, "Promoted Probe evidence is invalid");
  exactKeys(
    evidence,
    [
      "schemaVersion",
      "workspaceId",
      "databaseId",
      "registrationDigest",
      "schemaIdentity",
      "queryFingerprint",
      "parameterClassifications",
      "producedAt",
      "bounds",
      "rowCount",
      "byteCount",
      "resultDigest",
      "producingRunId",
      "redaction",
      "sanitizedClaims",
      "promotionStatus",
      "evidenceDigest"
    ],
    code,
    "Promoted Probe evidence is invalid"
  );
  if (evidence["schemaVersion"] !== 2 || evidence["promotionStatus"] !== "accepted-sanitized")
    fail(code, "Promoted Probe evidence is invalid");
  text(evidence["workspaceId"], /^workspace_[a-f0-9-]{36}$/u, code, "Promoted Probe evidence is invalid");
  text(evidence["databaseId"], STABLE_ID, code, "Promoted Probe evidence is invalid");
  text(evidence["registrationDigest"], DIGEST, code, "Promoted Probe evidence is invalid");
  text(evidence["queryFingerprint"], DIGEST, code, "Promoted Probe evidence is invalid");
  text(evidence["resultDigest"], DIGEST, code, "Promoted Probe evidence is invalid");
  text(evidence["producingRunId"], RUN_ID, code, "Promoted Probe evidence is invalid");
  text(evidence["evidenceDigest"], DIGEST, code, "Promoted Probe evidence is invalid");
  instant(evidence["producedAt"], code, "Promoted Probe evidence is invalid");
  const schemaIdentity = record(evidence["schemaIdentity"], code, "Promoted Probe evidence is invalid");
  exactKeys(schemaIdentity, ["version", "fingerprint"], code, "Promoted Probe evidence is invalid");
  text(schemaIdentity["version"], STABLE_ID, code, "Promoted Probe evidence is invalid");
  text(schemaIdentity["fingerprint"], DIGEST, code, "Promoted Probe evidence is invalid");
  const bounds = record(evidence["bounds"], code, "Promoted Probe evidence is invalid");
  exactKeys(
    bounds,
    ["timeoutMs", "rowLimit", "byteLimit", "concurrencyLimit"],
    code,
    "Promoted Probe evidence is invalid"
  );
  for (const field of ["timeoutMs", "rowLimit", "byteLimit", "concurrencyLimit"])
    positive(bounds[field], code, "Promoted Probe evidence is invalid");
  for (const field of ["rowCount", "byteCount"])
    if (!Number.isSafeInteger(evidence[field]) || (evidence[field] as number) < 0)
      fail(code, "Promoted Probe evidence is invalid");
  if (
    !Array.isArray(evidence["parameterClassifications"]) ||
    evidence["parameterClassifications"].some(
      (item) =>
        typeof item !== "string" || !["public", "internal", "confidential", "restricted", "secret"].includes(item)
    )
  )
    fail(code, "Promoted Probe evidence is invalid");
  const redaction = record(evidence["redaction"], code, "Promoted Probe evidence is invalid");
  exactKeys(
    redaction,
    ["policyRef", "method", "removedFields", "humanReviewRef"],
    code,
    "Promoted Probe evidence is invalid"
  );
  text(redaction["policyRef"], /^[a-z][a-z0-9._-]{2,127}$/u, code, "Promoted Probe evidence is invalid");
  if (redaction["method"] !== "allowlist" && redaction["method"] !== "aggregation")
    fail(code, "Promoted Probe evidence is invalid");
  text(redaction["humanReviewRef"], REVIEW_REF, code, "Promoted Probe evidence is invalid");
  if (
    !Array.isArray(redaction["removedFields"]) ||
    redaction["removedFields"].some((item) => typeof item !== "string" || !/^[a-z][a-z0-9_.]{0,126}$/u.test(item))
  )
    fail(code, "Promoted Probe evidence is invalid");
  if (!Array.isArray(evidence["sanitizedClaims"]) || evidence["sanitizedClaims"].length === 0)
    fail(code, "Promoted Probe evidence is invalid");
  const factKeys = new Set<string>();
  for (const value of evidence["sanitizedClaims"]) {
    const claim = record(value, code, "Promoted Probe evidence is invalid");
    exactKeys(
      claim,
      ["factKey", "classification", "valueDigest", "untrusted"],
      code,
      "Promoted Probe evidence is invalid"
    );
    const factKey = text(claim["factKey"], FACT_KEY, code, "Promoted Probe evidence is invalid");
    if (/(?:password|credential|secret|token)/iu.test(factKey) || factKeys.has(factKey))
      fail(code, "Promoted Probe evidence is invalid");
    factKeys.add(factKey);
    if (claim["classification"] !== "public" && claim["classification"] !== "internal")
      fail(code, "Promoted Probe evidence is invalid");
    if (claim["untrusted"] !== true) fail(code, "Promoted Probe evidence is invalid");
    text(claim["valueDigest"], DIGEST, code, "Promoted Probe evidence is invalid");
  }
  const normalized = evidence as unknown as PromotedProbeEvidence;
  if (promotedEvidenceDigestOf(normalized) !== evidence["evidenceDigest"])
    fail(code, "Promoted Probe evidence is invalid");
  return deepFreeze(normalized);
}

function selectedFact(packageValue: DatabaseKnowledgePackage, factKey: string): string | boolean | undefined {
  const fact = packageValue.facts.find((item) => item.factKey === factKey);
  if (fact === undefined) return undefined;
  if (fact.alternatives.length === 1) return fact.alternatives[0]?.value;
  const resolution = packageValue.contradictions.find((item) => item.factKey === factKey)?.resolution;
  return fact.alternatives.find((item) => item.valueDigest === resolution?.selectedValueDigest)?.value;
}
export function planSyntheticSeedScenarios(value: unknown) {
  const code = "VES_SEED_PLAN_INVALID";
  const input = record(value, code, "Synthetic seed plan input is invalid");
  exactKeys(
    input,
    [
      "schemaVersion",
      "workspaceId",
      "databaseId",
      "knowledgePackage",
      "acceptanceCriteria",
      "factories",
      "fixtures",
      "sanitizedEvidence",
      "policy"
    ],
    code,
    "Synthetic seed plan input is invalid"
  );
  if (input["schemaVersion"] !== 1) fail(code, "Synthetic seed plan version is invalid");
  const workspaceId = text(
    input["workspaceId"],
    /^workspace_[a-f0-9-]{36}$/u,
    code,
    "Synthetic seed Workspace is invalid"
  );
  const databaseId = text(input["databaseId"], STABLE_ID, code, "Synthetic seed database is invalid");
  const packageValue = input["knowledgePackage"] as DatabaseKnowledgePackage;
  if (
    typeof packageValue !== "object" ||
    packageValue === null ||
    packageValue.workspaceId !== workspaceId ||
    packageValue.databaseId !== databaseId ||
    !DIGEST.test(packageValue.packageDigest)
  )
    fail(code, "Database Knowledge Package binding is invalid");
  const expectedPackageDigest = packageDigestOf(packageValue);
  if (expectedPackageDigest !== packageValue.packageDigest) fail(code, "Database Knowledge Package digest is invalid");
  if (
    !Array.isArray(input["acceptanceCriteria"]) ||
    input["acceptanceCriteria"].length === 0 ||
    input["acceptanceCriteria"].length > 128 ||
    !Array.isArray(input["factories"]) ||
    !Array.isArray(input["fixtures"]) ||
    !Array.isArray(input["sanitizedEvidence"])
  )
    fail(code, "Synthetic seed plan collections are invalid");
  const factories = new Map<string, { factoryRef: string; entity: string; generators: UnknownRecord }>();
  for (const rawFactory of input["factories"]) {
    const factory = record(rawFactory, code, "Synthetic seed factory is invalid");
    exactKeys(factory, ["factoryRef", "entity", "origin", "generators"], code, "Synthetic seed factory is invalid");
    const entity = text(factory["entity"], ENTITY_REF, code, "Synthetic seed factory entity is invalid");
    if (factory["origin"] !== "synthetic") fail(code, "Synthetic seed factory origin is invalid");
    const generators = record(factory["generators"], code, "Synthetic seed generators are invalid");
    if (
      Object.keys(generators).length === 0 ||
      Object.entries(generators).some(
        ([field, generator]) => !IDENTIFIER.test(field) || typeof generator !== "string" || !GENERATORS.has(generator)
      )
    )
      fail(code, "Synthetic seed generator is invalid");
    if (factories.has(entity)) fail(code, "Synthetic seed factory is duplicated");
    factories.set(entity, {
      factoryRef: text(
        factory["factoryRef"],
        /^[a-z][a-z0-9._-]{2,127}$/u,
        code,
        "Synthetic seed factory reference is invalid"
      ),
      entity,
      generators: Object.fromEntries(Object.entries(generators).sort(([left], [right]) => codeUnitCompare(left, right)))
    });
  }
  const fixtureRefs = new Map<string, string[]>();
  const fixtureDigests = new Set<string>();
  for (const rawFixture of input["fixtures"]) {
    const fixture = record(rawFixture, code, "Synthetic seed fixture is invalid");
    exactKeys(
      fixture,
      ["fixtureRef", "entity", "origin", "containsProductionData", "digest"],
      code,
      "Synthetic seed fixture is invalid"
    );
    const entity = text(fixture["entity"], ENTITY_REF, code, "Synthetic seed fixture entity is invalid");
    if (fixture["origin"] !== "synthetic" || fixture["containsProductionData"] !== false)
      fail(code, "Synthetic seed fixture origin is invalid");
    fixtureDigests.add(text(fixture["digest"], DIGEST, code, "Synthetic seed fixture digest is invalid"));
    const refs = fixtureRefs.get(entity) ?? [];
    refs.push(
      text(fixture["fixtureRef"], /^[a-z][a-z0-9._-]{2,127}$/u, code, "Synthetic seed fixture reference is invalid")
    );
    fixtureRefs.set(entity, refs);
  }
  const policy = record(input["policy"], code, "Synthetic seed evidence policy is invalid");
  exactKeys(
    policy,
    ["allowSanitizedEvidence", "allowedEvidenceDigests"],
    code,
    "Synthetic seed evidence policy is invalid"
  );
  if (
    typeof policy["allowSanitizedEvidence"] !== "boolean" ||
    !Array.isArray(policy["allowedEvidenceDigests"]) ||
    policy["allowedEvidenceDigests"].some((item) => typeof item !== "string" || !DIGEST.test(item))
  )
    fail(code, "Synthetic seed evidence policy is invalid");
  const evidenceDigests: string[] = [];
  for (const rawEvidence of input["sanitizedEvidence"] as unknown[]) {
    const evidence = normalizePromotedProbeEvidence(rawEvidence, code);
    if (
      evidence.promotionStatus !== "accepted-sanitized" ||
      !DIGEST.test(evidence.evidenceDigest) ||
      promotedEvidenceDigestOf(evidence) !== evidence.evidenceDigest ||
      evidence.workspaceId !== workspaceId ||
      evidence.databaseId !== databaseId ||
      policy["allowSanitizedEvidence"] !== true ||
      !(policy["allowedEvidenceDigests"] as string[]).includes(evidence.evidenceDigest)
    )
      fail(code, "Synthetic seed evidence is not approved");
    evidenceDigests.push(evidence.evidenceDigest);
  }
  const scenarios: UnknownRecord[] = [];
  for (const rawCriterion of input["acceptanceCriteria"]) {
    const criterion = record(rawCriterion, code, "Synthetic seed acceptance criterion is invalid");
    exactKeys(
      criterion,
      ["requirementId", "criterionId", "when", "then", "shall", "targets"],
      code,
      "Synthetic seed acceptance criterion is invalid"
    );
    const requirementId = text(
      criterion["requirementId"],
      REQUIREMENT_ID,
      code,
      "Synthetic seed requirement is invalid"
    );
    const criterionId = text(criterion["criterionId"], CRITERION_ID, code, "Synthetic seed criterion is invalid");
    for (const field of ["when", "then", "shall"])
      if (typeof criterion[field] !== "string" || criterion[field].trim().length < 3 || criterion[field].length > 512)
        fail(code, "Synthetic seed criterion text is invalid");
    if (
      !Array.isArray(criterion["targets"]) ||
      criterion["targets"].length === 0 ||
      criterion["targets"].some((item) => typeof item !== "string" || !ENTITY_REF.test(item))
    )
      fail(code, "Synthetic seed targets are invalid");
    for (const entity of [...new Set(criterion["targets"] as string[])].sort()) {
      if (
        packageValue.contradictions.some(
          (item) => item.factKey.startsWith(`${entity}.`) && item.status === "unresolved"
        )
      )
        fail("VES_SEED_SCHEMA_UNRESOLVED", "Synthetic seed target has unresolved schema contradictions");
      const factory = factories.get(entity);
      if (factory === undefined) fail(code, "Synthetic seed target factory is unavailable");
      if (selectedFact(packageValue, `${entity}.present`) === false)
        fail(code, "Synthetic seed target does not exist in the resolved schema");
      const fields = [
        ...new Set(
          packageValue.facts
            .filter((fact) => fact.factKey.startsWith(`${entity}.column.`))
            .map((fact) => fact.factKey.split(".")[3] as string)
        )
      ]
        .filter((field) => selectedFact(packageValue, `${entity}.column.${field}.present`) !== false)
        .sort();
      if (
        fields.length === 0 ||
        Object.keys(factory.generators).some((field) => !fields.includes(field)) ||
        fields.some((field) => !(field in factory.generators))
      )
        fail(code, "Synthetic seed factory does not cover the target schema");
      const base = {
        requirementId,
        criterionId,
        entity,
        factoryRef: factory.factoryRef,
        generatorPlan: factory.generators,
        fixtureRefs: (fixtureRefs.get(entity) ?? []).sort(),
        materialization: "synthetic-only"
      };
      const addScenario = (caseKind: string, expectedValid: boolean, field?: string) => {
        const material = { ...base, caseKind, expectedValid, ...(field === undefined ? {} : { field }) };
        scenarios.push({ scenarioId: digest(material), ...material });
      };
      addScenario("nominal", true);
      for (const field of fields) {
        if (selectedFact(packageValue, `${entity}.column.${field}.nullable`) === false)
          addScenario("missing-required", false, field);
        if (selectedFact(packageValue, `${entity}.column.${field}.unique`) === true)
          addScenario("unique-collision", false, field);
      }
    }
  }
  const material = {
    schemaVersion: 1 as const,
    workspaceId,
    databaseId,
    knowledgePackageDigest: packageValue.packageDigest,
    productionDataAllowed: false as const,
    fixtureDigests: [...fixtureDigests].sort(),
    sanitizedEvidenceDigests: [...new Set(evidenceDigests)].sort(),
    scenarios: scenarios.toSorted((a, b) => codeUnitCompare(String(a["scenarioId"]), String(b["scenarioId"])))
  };
  return deepFreeze({ ...material, planDigest: digest(material) });
}
