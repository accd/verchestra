import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";
import { DatabaseSync, constants } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const SAFE_FUNCTIONS = new Set([
  "abs",
  "avg",
  "coalesce",
  "count",
  "ifnull",
  "length",
  "lower",
  "max",
  "min",
  "nullif",
  "round",
  "substr",
  "sum",
  "upper"
]);
const SYNTAX_FUNCTIONS = new Set(["as", "case", "exists", "in", "over"]);
const WRITE =
  /\b(?:ALTER|ANALYZE|BEGIN|COMMIT|CREATE|DELETE|DROP|END|INSERT|REINDEX|RELEASE|REPLACE|ROLLBACK|SAVEPOINT|UPDATE|VACUUM)\b/iu;
type UnknownRecord = Readonly<Record<string, unknown>>;
type Classification = (typeof CLASSIFICATIONS)[number];

// Code-unit comparison, not localeCompare: entity ordering feeds the
// parsed plan's semantic shape, not just its digest input (AD-015,
// issue #58).
function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJsonV2(value)).digest("hex")}`;
}
export class SqliteProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SqliteProbeError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new SqliteProbeError(code, message);
}

interface ParseOptions {
  readonly kind: "select" | "introspect";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}
export interface SqliteObject {
  readonly schema: string;
  readonly name: string;
  readonly type: "table" | "catalog";
}
export interface SqliteOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly SqliteObject[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

export function parseSqliteReadOperation(sql: unknown, options: ParseOptions): SqliteOperation {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 131_072)
    fail("VES_SQLITE_REQUEST_INVALID", "Protected SQLite statement is invalid");
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(sql) || /\\|\x00/u.test(sql))
    fail("VES_SQLITE_ENCODING_DENIED", "SQLite statement encoding is not permitted");
  if (/--|\/\*|\*\//u.test(sql)) fail("VES_SQLITE_COMMENT_DENIED", "SQLite comments are not permitted");
  if (sql.includes(";")) fail("VES_SQLITE_BATCH_DENIED", "SQLite batches are not permitted");
  if (/\b(?:ATTACH|DETACH)\b/iu.test(sql) || /\b(?:TEMP|TEMPORARY)\b/iu.test(sql))
    fail("VES_SQLITE_DATABASE_CONTROL_DENIED", "SQLite database attachment and temporary objects are not permitted");
  if (/^\s*PRAGMA\b/iu.test(sql)) fail("VES_SQLITE_PRAGMA_DENIED", "SQLite PRAGMA statements are not permitted");
  if (/\bWITH\s+RECURSIVE\b/iu.test(sql))
    fail("VES_SQLITE_RECURSIVE_DENIED", "Recursive SQLite queries are not permitted");
  if (WRITE.test(sql)) fail("VES_SQLITE_WRITE_DENIED", "SQLite write or transaction syntax is not permitted");
  if (sql.includes("'") || sql.includes('"') || /\b\d+(?:\.\d+)?\b/u.test(sql))
    fail("VES_SQLITE_LITERAL_DENIED", "Inline literals and quoted identifiers are not permitted");
  if (/[:@$]\w|\?\d/u.test(sql)) fail("VES_SQLITE_PARAMETERS_INVALID", "Only anonymous SQLite binds are permitted");
  const normalized = sql.replace(/\s+/gu, " ").trim().toUpperCase();
  if (!normalized.startsWith("SELECT ") && !normalized.startsWith("WITH "))
    fail("VES_SQLITE_READ_FORM_DENIED", "SQLite read form is not permitted");
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef))
    fail("VES_SQLITE_REQUEST_INVALID", "Protected SQLite request reference is invalid");
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((value) => !CLASSIFICATIONS.includes(value as Classification))
  )
    fail("VES_SQLITE_PARAMETERS_INVALID", "SQLite parameter classifications are invalid");

  const ctes = new Set<string>();
  for (const match of sql.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/giu))
    ctes.add((match[1] as string).toLowerCase());
  const objects = new Map<string, SqliteObject>();
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?/giu)) {
    const first = (match[1] as string).toLowerCase();
    const second = match[2]?.toLowerCase();
    if (second === undefined) {
      if (ctes.has(first)) continue;
      fail("VES_SQLITE_OBJECT_INVALID", "SQLite objects must be main schema qualified");
    }
    if (first !== "main") fail("VES_SQLITE_DATABASE_CONTROL_DENIED", "Only the SQLite main database is permitted");
    if (second.startsWith("sqlite_")) {
      if (second !== "sqlite_schema" || options.kind !== "introspect")
        fail("VES_SQLITE_CATALOG_DENIED", "SQLite catalog object is not approved");
      objects.set(`main.${second}`, { schema: "main", name: second, type: "catalog" });
    } else objects.set(`main.${second}`, { schema: "main", name: second, type: "table" });
  }
  if (objects.size === 0) fail("VES_SQLITE_OBJECT_INVALID", "SQLite read requires an approved object");
  const functions = new Set<string>();
  for (const match of sql.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/giu)) {
    const name = (match[1] as string).toLowerCase();
    if (ctes.has(name) || SYNTAX_FUNCTIONS.has(name)) continue;
    if (!SAFE_FUNCTIONS.has(name)) fail("VES_SQLITE_FUNCTION_DENIED", "SQLite function is not approved");
    functions.add(name);
  }
  const bindCount = [...sql.matchAll(/\?/gu)].length;
  if (bindCount !== options.parameterClassifications.length)
    fail("VES_SQLITE_PARAMETERS_INVALID", "SQLite binds are invalid");
  return Object.freeze({
    kind: options.kind,
    statementCount: 1,
    protectedRequestRef: options.protectedRequestRef,
    objects: Object.freeze(
      [...objects.values()].sort((a, b) => codeUnitCompare(`${a.schema}.${a.name}`, `${b.schema}.${b.name}`))
    ),
    functions: Object.freeze([...functions].sort()),
    parameterClassifications: Object.freeze([...options.parameterClassifications].sort()) as readonly Classification[]
  });
}

export interface SqliteConnectionPlan {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: SqliteOperation;
  readonly bounds: { readonly timeoutMs: number; readonly rowLimit: number };
}
export interface SqliteObservation {
  readonly product: string;
  readonly version: string;
  readonly databaseId: string;
  readonly readOnlyOpen: boolean;
  readonly defensive: boolean;
  readonly extensionLoading: boolean;
  readonly queryOnly: boolean;
  readonly attachedDatabaseCount: number;
}
export interface SqliteSessionObservation {
  readonly queryOnly: boolean;
  readonly defensive: boolean;
  readonly extensionLoading: boolean;
  readonly authorizer: boolean;
  readonly attachedDatabaseCount: number;
}
export interface SqliteConnectionPort {
  inspectPrincipal(plan: SqliteConnectionPlan): Promise<SqliteObservation>;
  configureAuthorization(operation: SqliteOperation): Promise<SqliteSessionObservation>;
  stream(
    sql: string,
    params: readonly unknown[],
    signal: AbortSignal,
    maximumRows: number
  ): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}
function decode(bytes: Uint8Array) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("VES_SQLITE_REQUEST_INVALID", "Protected SQLite request is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    fail("VES_SQLITE_REQUEST_INVALID", "Protected SQLite request is invalid");
  const input = parsed as UnknownRecord;
  if (Object.keys(input).sort().join(",") !== "parameters,schemaVersion,sql" || input["schemaVersion"] !== 1)
    fail("VES_SQLITE_REQUEST_INVALID", "Protected SQLite request is invalid");
  if (
    !Array.isArray(input["parameters"]) ||
    input["parameters"].length > 64 ||
    input["parameters"].some((value) => value !== null && !["string", "number", "boolean"].includes(typeof value))
  )
    fail("VES_SQLITE_PARAMETERS_INVALID", "Protected SQLite parameters are invalid");
  return { sql: input["sql"] as string, parameters: input["parameters"] };
}

export class SqliteProbeAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:sqlite", digest: `sha256:${"9".repeat(64)}` });
  readonly #connection: SqliteConnectionPort;
  constructor(options: { readonly connection: SqliteConnectionPort }) {
    this.#connection = options.connection;
  }
  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: SqliteProbeAdapter.component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }
  async verifyIdentity(plan: SqliteConnectionPlan) {
    const observation = await this.#connection.inspectPrincipal(plan);
    if (observation.product !== "sqlite") fail("VES_SQLITE_PRODUCT_INVALID", "Database product is not SQLite");
    const principalReadOnly =
      observation.databaseId === plan.databaseId &&
      observation.readOnlyOpen &&
      observation.defensive &&
      !observation.extensionLoading &&
      observation.queryOnly &&
      observation.attachedDatabaseCount === 1;
    return Object.freeze({
      databaseId: observation.databaseId,
      product: observation.product,
      version: observation.version,
      principalReadOnly,
      principalFingerprint: digest(observation)
    });
  }
  async configureReadOnlySession(plan: SqliteConnectionPlan) {
    const observation = await this.#connection.configureAuthorization(plan.operation);
    const readOnly =
      observation.queryOnly &&
      observation.defensive &&
      !observation.extensionLoading &&
      observation.authorizer &&
      observation.attachedDatabaseCount === 1;
    return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
  }
  async *execute(
    plan: SqliteConnectionPlan,
    bytes: Uint8Array,
    signal: AbortSignal
  ): AsyncIterable<readonly UnknownRecord[]> {
    const request = decode(bytes);
    const operation = parseSqliteReadOperation(request.sql, {
      kind: plan.operation.kind,
      protectedRequestRef: plan.operation.protectedRequestRef,
      parameterClassifications: plan.operation.parameterClassifications
    });
    if (canonicalizeJsonV2(operation) !== canonicalizeJsonV2(plan.operation))
      fail("VES_SQLITE_PLAN_MISMATCH", "Protected SQLite request differs from the approved plan");
    const bindCount = [...request.sql.matchAll(/\?/gu)].length;
    if (request.parameters.length !== bindCount)
      fail("VES_SQLITE_PARAMETERS_INVALID", "Protected SQLite parameters do not match binds");
    for await (const row of this.#connection.stream(request.sql, request.parameters, signal, plan.bounds.rowLimit))
      yield Object.freeze([row]);
  }
  async cancel() {
    await this.#connection.cancel();
  }
  async terminate() {
    await this.#connection.terminate();
  }
}

export class SqliteReadConnection implements SqliteConnectionPort {
  readonly #databaseId: string;
  readonly #db: DatabaseSync;
  #closed = false;
  #cancelled = false;
  #queryOnly = false;
  #authorizer = false;
  constructor(options: { readonly databaseId: string; readonly path: string }) {
    this.#databaseId = options.databaseId;
    this.#db = new DatabaseSync(options.path, { readOnly: true, allowExtension: false, defensive: true });
    this.#db.exec("PRAGMA query_only=ON");
    this.#queryOnly = this.#db.prepare("PRAGMA query_only").get()?.["query_only"] === 1;
  }
  async inspectPrincipal(plan: SqliteConnectionPlan): Promise<SqliteObservation> {
    void plan;
    const version = this.#db.prepare("SELECT sqlite_version() AS version").get()?.["version"];
    const attachedDatabaseCount = this.#db.prepare("PRAGMA database_list").all().length;
    return {
      product: "sqlite",
      version: String(version),
      databaseId: this.#databaseId,
      readOnlyOpen: true,
      defensive: true,
      extensionLoading: false,
      queryOnly: this.#queryOnly,
      attachedDatabaseCount
    };
  }
  async configureAuthorization(operation: SqliteOperation): Promise<SqliteSessionObservation> {
    const allowedObjects = new Set(operation.objects.map((object) => object.name));
    if (allowedObjects.has("sqlite_schema")) allowedObjects.add("sqlite_master");
    const allowedFunctions = new Set(operation.functions);
    this.#db.setAuthorizer((action, arg1, arg2, database) => {
      if (action === constants.SQLITE_SELECT) return constants.SQLITE_OK;
      if (action === constants.SQLITE_READ)
        return database === "main" && arg1 !== null && allowedObjects.has(arg1.toLowerCase())
          ? constants.SQLITE_OK
          : constants.SQLITE_DENY;
      if (action === constants.SQLITE_FUNCTION)
        return arg2 !== null && allowedFunctions.has(arg2.toLowerCase()) ? constants.SQLITE_OK : constants.SQLITE_DENY;
      return constants.SQLITE_DENY;
    });
    this.#authorizer = true;
    return {
      queryOnly: this.#queryOnly,
      defensive: true,
      extensionLoading: false,
      authorizer: this.#authorizer,
      attachedDatabaseCount: 1
    };
  }
  async *stream(
    sql: string,
    params: readonly unknown[],
    signal: AbortSignal,
    maximumRows: number
  ): AsyncIterable<UnknownRecord> {
    this.#cancelled = false;
    const statement = this.#db.prepare(sql);
    let rows = 0;
    const sqliteParams = params.map((value) => (typeof value === "boolean" ? Number(value) : (value as SQLInputValue)));
    for (const row of statement.iterate(...sqliteParams)) {
      if (signal.aborted || this.#cancelled) return;
      rows += 1;
      yield row;
      if (rows > maximumRows) return;
    }
  }
  async cancel() {
    this.#cancelled = true;
  }
  async terminate() {
    this.close();
  }
  close() {
    if (!this.#closed) {
      this.#db.close();
      this.#closed = true;
    }
  }
  prepareForTest(sql: string) {
    return this.#db.prepare(sql);
  }
  enableExtensionForTest() {
    this.#db.enableLoadExtension(true);
  }
}

interface FixtureOptions extends Partial<SqliteObservation> {
  readonly sessionQueryOnly?: boolean;
  readonly sessionDefensive?: boolean;
  readonly sessionExtensionLoading?: boolean;
  readonly sessionAuthorizer?: boolean;
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}
export class SqliteFixtureConnection implements SqliteConnectionPort {
  readonly #options: FixtureOptions;
  authorizationConfigured = false;
  lastParameters: readonly unknown[] = [];
  streamCalls = 0;
  cancelled = false;
  terminated = false;
  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }
  async inspectPrincipal(plan: SqliteConnectionPlan): Promise<SqliteObservation> {
    return {
      product: this.#options.product ?? "sqlite",
      version: this.#options.version ?? "3.51.2",
      databaseId: this.#options.databaseId ?? plan.databaseId,
      readOnlyOpen: this.#options.readOnlyOpen ?? true,
      defensive: this.#options.defensive ?? true,
      extensionLoading: this.#options.extensionLoading ?? false,
      queryOnly: this.#options.queryOnly ?? true,
      attachedDatabaseCount: this.#options.attachedDatabaseCount ?? 1
    };
  }
  async configureAuthorization(_operation: SqliteOperation): Promise<SqliteSessionObservation> {
    void _operation;
    this.authorizationConfigured = true;
    return {
      queryOnly: this.#options.sessionQueryOnly ?? true,
      defensive: this.#options.sessionDefensive ?? true,
      extensionLoading: this.#options.sessionExtensionLoading ?? false,
      authorizer: this.#options.sessionAuthorizer ?? true,
      attachedDatabaseCount: this.#options.attachedDatabaseCount ?? 1
    };
  }
  async *stream(
    _sql: string,
    params: readonly unknown[],
    signal: AbortSignal,
    _maximumRows: number
  ): AsyncIterable<UnknownRecord> {
    void _maximumRows;
    this.streamCalls += 1;
    this.lastParameters = structuredClone(params);
    if ((this.#options.delayMs ?? 0) > 0)
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
