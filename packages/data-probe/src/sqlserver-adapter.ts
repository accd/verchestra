import { createHash } from "node:crypto";

type UnknownRecord = Readonly<Record<string, unknown>>;
type Classification = "public" | "internal" | "confidential" | "restricted" | "secret";
const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const SAFE_FUNCTIONS = new Set([
  "avg",
  "coalesce",
  "count",
  "dateadd",
  "datediff",
  "isnull",
  "len",
  "lower",
  "max",
  "min",
  "sum",
  "upper"
]);
const SYNTAX_FUNCTIONS = new Set(["as", "case", "exists", "in", "over"]);
const SAFE_CATALOGS = new Set([
  "sys.columns",
  "sys.foreign_keys",
  "sys.indexes",
  "sys.objects",
  "sys.schemas",
  "sys.tables"
]);
const WRITE =
  /\b(?:ALTER|BACKUP|BULK|CREATE|DBCC|DELETE|DENY|DROP|EXEC(?:UTE)?|GRANT|INSERT|KILL|MERGE|RECONFIGURE|RESTORE|REVOKE|TRUNCATE|UPDATE)\b/iu;

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as UnknownRecord)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(",")}}`;
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
export class SqlServerProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SqlServerProbeError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new SqlServerProbeError(code, message);
}

interface ParseOptions {
  readonly kind: "select" | "introspect";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}
export interface SqlServerOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly { readonly schema: string; readonly name: string; readonly type: "table" | "catalog" }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

export function parseSqlServerReadOperation(sql: unknown, options: ParseOptions): SqlServerOperation {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 131_072)
    fail("VES_SQLSERVER_REQUEST_INVALID", "Protected SQL Server statement is invalid");
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(sql) || /\\/u.test(sql))
    fail("VES_SQLSERVER_ENCODING_DENIED", "SQL Server statement encoding is not permitted");
  if (/--|\/\*|\*\//u.test(sql)) fail("VES_SQLSERVER_COMMENT_DENIED", "SQL Server comments are not permitted");
  if (sql.includes(";") || sql.split("\n").some((line) => line.trim().toUpperCase() === "GO"))
    fail("VES_SQLSERVER_BATCH_DENIED", "SQL Server batches are not permitted");
  if (sql.includes("'") || sql.includes('"') || sql.includes("[") || sql.includes("]"))
    fail("VES_SQLSERVER_LITERAL_DENIED", "Inline literals and quoted identifiers are not permitted");
  if (/\b(?:OPENROWSET|OPENDATASOURCE)\s*\(/iu.test(sql))
    fail("VES_SQLSERVER_FUNCTION_DENIED", "SQL Server external data functions are not permitted");
  if (/\bINTO\s+[a-z#]/iu.test(sql) || WRITE.test(sql))
    fail("VES_SQLSERVER_WRITE_DENIED", "SQL Server write or execution syntax is not permitted");
  if (/#|\btempdb\b/iu.test(sql))
    fail("VES_SQLSERVER_TEMP_OBJECT_DENIED", "SQL Server temporary objects are not permitted");
  if (/\bWITH\s*\(|\bOPTION\s*\(/iu.test(sql))
    fail("VES_SQLSERVER_HINT_DENIED", "SQL Server query hints are not permitted");
  const normalized = sql.replace(/\s+/gu, " ").trim().toUpperCase();
  if (!normalized.startsWith("SELECT ") && !normalized.startsWith("WITH "))
    fail("VES_SQLSERVER_READ_FORM_DENIED", "SQL Server read form is not permitted");
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef))
    fail("VES_SQLSERVER_REQUEST_INVALID", "Protected SQL Server request reference is invalid");
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((c) => !CLASSIFICATIONS.includes(c as Classification))
  )
    fail("VES_SQLSERVER_PARAMETERS_INVALID", "SQL Server parameter classifications are invalid");
  const ctes = new Set<string>();
  for (const match of sql.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/giu))
    ctes.add((match[1] as string).toLowerCase());
  const objects = new Map<string, { schema: string; name: string; type: "table" | "catalog" }>();
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?/giu)) {
    const schema = (match[1] as string).toLowerCase();
    const name = match[2]?.toLowerCase();
    if (name === undefined) {
      if (ctes.has(schema)) continue;
      fail("VES_SQLSERVER_OBJECT_INVALID", "SQL Server objects must be schema-qualified");
    }
    const identity = `${schema}.${name}`;
    const catalog = schema === "sys" || schema === "information_schema";
    if (catalog && (options.kind !== "introspect" || !SAFE_CATALOGS.has(identity)))
      fail("VES_SQLSERVER_CATALOG_DENIED", "SQL Server catalog object is not approved");
    objects.set(identity, { schema, name, type: catalog ? "catalog" : "table" });
  }
  if (objects.size === 0) fail("VES_SQLSERVER_OBJECT_INVALID", "SQL Server read requires an object");
  const functions = new Set<string>();
  for (const match of sql.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/giu)) {
    const name = (match[1] as string).toLowerCase();
    if (ctes.has(name) || SYNTAX_FUNCTIONS.has(name)) continue;
    if (!SAFE_FUNCTIONS.has(name)) fail("VES_SQLSERVER_FUNCTION_DENIED", "SQL Server function is not approved");
    functions.add(name);
  }
  const params = [...sql.matchAll(/@p(\d+)\b/giu)].map((m) => Number(m[1]));
  const maximum = params.length ? Math.max(...params) : 0;
  if (
    maximum !== options.parameterClassifications.length ||
    new Set(params).size !== maximum ||
    params.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 64)
  )
    fail("VES_SQLSERVER_PARAMETERS_INVALID", "SQL Server parameters are invalid");
  return Object.freeze({
    kind: options.kind,
    statementCount: 1,
    protectedRequestRef: options.protectedRequestRef,
    objects: Object.freeze(
      [...objects.values()].sort((a, b) => `${a.schema}.${a.name}`.localeCompare(`${b.schema}.${b.name}`))
    ),
    functions: Object.freeze([...functions].sort()),
    parameterClassifications: Object.freeze([...options.parameterClassifications].sort()) as readonly Classification[]
  });
}

export interface SqlServerConnectionPlan {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly bounds: { readonly timeoutMs: number };
  readonly operation: SqlServerOperation;
}
export interface SqlServerObservation {
  readonly databaseId: string;
  readonly principal: string;
  readonly sysadmin: boolean;
  readonly securityAdmin: boolean;
  readonly dbOwner: boolean;
  readonly dbDdlAdmin: boolean;
  readonly dbDataWriter: boolean;
  readonly writePermissionCount: number;
  readonly impersonatePermission: boolean;
}
export interface SqlServerConnectionPort {
  inspectPrincipal(plan: SqlServerConnectionPlan): Promise<SqlServerObservation>;
  executeControl(sql: string, params: readonly unknown[]): Promise<readonly UnknownRecord[]>;
  stream(sql: string, params: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}

function decodeRequest(bytes: Uint8Array): { readonly sql: string; readonly parameters: readonly unknown[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("VES_SQLSERVER_REQUEST_INVALID", "Protected SQL Server execution request is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    fail("VES_SQLSERVER_REQUEST_INVALID", "Protected SQL Server execution request is invalid");
  const input = parsed as UnknownRecord;
  if (Object.keys(input).sort().join(",") !== "parameters,schemaVersion,sql" || input["schemaVersion"] !== 1)
    fail("VES_SQLSERVER_REQUEST_INVALID", "Protected SQL Server execution request is invalid");
  if (!Array.isArray(input["parameters"]) || input["parameters"].length > 64)
    fail("VES_SQLSERVER_PARAMETERS_INVALID", "Protected SQL Server parameters are invalid");
  for (const value of input["parameters"]) {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value))
      fail("VES_SQLSERVER_PARAMETERS_INVALID", "Protected SQL Server parameters are invalid");
  }
  return { sql: input["sql"] as string, parameters: input["parameters"] };
}

export class SqlServerProbeAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:sqlserver", digest: `sha256:${"6".repeat(64)}` });
  readonly #connection: SqlServerConnectionPort;
  constructor(options: { readonly connection: SqlServerConnectionPort }) {
    this.#connection = options.connection;
  }
  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: SqlServerProbeAdapter.component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }
  async verifyIdentity(plan: SqlServerConnectionPlan) {
    const o = await this.#connection.inspectPrincipal(plan);
    return Object.freeze({
      databaseId: o.databaseId,
      principalReadOnly:
        !o.sysadmin &&
        !o.securityAdmin &&
        !o.dbOwner &&
        !o.dbDdlAdmin &&
        !o.dbDataWriter &&
        o.writePermissionCount === 0 &&
        !o.impersonatePermission,
      principalFingerprint: digest(o)
    });
  }
  async configureReadOnlySession(plan: SqlServerConnectionPlan) {
    await this.#connection.executeControl("SET XACT_ABORT ON", []);
    await this.#connection.executeControl("SET LOCK_TIMEOUT @p1", [plan.bounds.timeoutMs]);
    await this.#connection.executeControl("SET TRANSACTION ISOLATION LEVEL SNAPSHOT", []);
    await this.#connection.executeControl("BEGIN TRANSACTION", []);
    const rows = await this.#connection.executeControl(
      "SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS can_write",
      []
    );
    const readOnly = rows[0]?.["can_write"] === 0;
    return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
  }
  async *execute(
    plan: SqlServerConnectionPlan,
    bytes: Uint8Array,
    signal: AbortSignal
  ): AsyncIterable<readonly UnknownRecord[]> {
    const request = decodeRequest(bytes);
    const operation = parseSqlServerReadOperation(request.sql, {
      kind: plan.operation.kind,
      protectedRequestRef: plan.operation.protectedRequestRef,
      parameterClassifications: plan.operation.parameterClassifications
    });
    if (canonical(operation) !== canonical(plan.operation))
      fail("VES_SQLSERVER_PLAN_MISMATCH", "Protected SQL Server request differs from the approved plan");
    const placeholders = [...request.sql.matchAll(/@p(\d+)\b/giu)].map((match) => Number(match[1]));
    const maximum = placeholders.length === 0 ? 0 : Math.max(...placeholders);
    if (request.parameters.length !== maximum)
      fail("VES_SQLSERVER_PARAMETERS_INVALID", "Protected SQL Server parameters do not match placeholders");
    for await (const row of this.#connection.stream(request.sql, request.parameters, signal))
      yield Object.freeze([row]);
  }
  async cancel() {
    await this.#connection.cancel();
  }
  async terminate() {
    await this.#connection.terminate();
  }
}

interface FixtureOptions extends Partial<SqlServerObservation> {
  readonly sessionCanWrite?: boolean;
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}
export class SqlServerFixtureConnection implements SqlServerConnectionPort {
  readonly #options: FixtureOptions;
  readonly controlCalls: [string, readonly unknown[]][] = [];
  lastParameters: readonly unknown[] = [];
  streamCalls = 0;
  cancelled = false;
  terminated = false;
  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }
  async inspectPrincipal(plan: SqlServerConnectionPlan): Promise<SqlServerObservation> {
    return {
      databaseId: this.#options.databaseId ?? plan.databaseId,
      principal: this.#options.principal ?? "verchestra_readonly",
      sysadmin: this.#options.sysadmin ?? false,
      securityAdmin: this.#options.securityAdmin ?? false,
      dbOwner: this.#options.dbOwner ?? false,
      dbDdlAdmin: this.#options.dbDdlAdmin ?? false,
      dbDataWriter: this.#options.dbDataWriter ?? false,
      writePermissionCount: this.#options.writePermissionCount ?? 0,
      impersonatePermission: this.#options.impersonatePermission ?? false
    };
  }
  async executeControl(sql: string, params: readonly unknown[]): Promise<readonly UnknownRecord[]> {
    this.controlCalls.push([sql, [...params]]);
    return sql.startsWith("SELECT HAS_PERMS") ? [{ can_write: this.#options.sessionCanWrite ? 1 : 0 }] : [];
  }
  async *stream(_sql: string, params: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord> {
    this.streamCalls += 1;
    this.lastParameters = structuredClone(params);
    if ((this.#options.delayMs ?? 0) > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.#options.delayMs);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
    }
    if (signal.aborted) return;
    for (const row of this.#options.rows ?? [{ id: 1 }]) yield structuredClone(row);
  }
  async cancel() {
    this.cancelled = true;
  }
  async terminate() {
    this.terminated = true;
  }
}
