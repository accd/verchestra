import { canonicalizeJsonV2 } from "@verchestra/domain";

import { codeUnitCompare, digest, sortedKeys } from "./canonical-material.ts";

type Engine = "mysql" | "mariadb";
type UnknownRecord = Readonly<Record<string, unknown>>;
type Classification = "public" | "internal" | "confidential" | "restricted" | "secret";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/u;
const SAFE_FUNCTIONS = new Set([
  "avg",
  "coalesce",
  "count",
  "date_format",
  "ifnull",
  "length",
  "lower",
  "max",
  "min",
  "sum",
  "upper"
]);
const FUNCTION_SYNTAX = new Set(["as", "case", "exists", "if", "in", "over"]);
const METADATA_SCHEMAS = new Set(["information_schema", "mysql", "performance_schema"]);
const SAFE_METADATA = new Set([
  "information_schema.columns",
  "information_schema.key_column_usage",
  "information_schema.referential_constraints",
  "information_schema.statistics",
  "information_schema.table_constraints",
  "information_schema.tables"
]);
const WRITE =
  /\b(?:ALTER|CALL|CREATE|DELETE|DROP|GRANT|HANDLER|INSERT|LOAD|LOCK|MERGE|RENAME|REPLACE|REVOKE|SET|TRUNCATE|UPDATE)\b/iu;

export class MySqlFamilyProbeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MySqlFamilyProbeError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new MySqlFamilyProbeError(code, message);
}

interface ParseOptions {
  readonly engine: Engine;
  readonly kind: "select" | "introspect";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}

export interface MySqlFamilyOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly { readonly schema: string; readonly name: string; readonly type: "table" | "catalog" }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

type FamilyObject = { schema: string; name: string; type: "table" | "catalog" };
type StatementRule = readonly [denied: (sql: string) => boolean, code: string, message: string];

// invariant: the rules run in this order, so a statement breaking several of
// them is refused with the first one listed.
const STATEMENT_RULES: readonly StatementRule[] = [
  [
    (sql) => !/^[\t\n\r\x20-\x7e]+$/u.test(sql) || /\\/u.test(sql),
    "VES_MYSQL_FAMILY_ENCODING_DENIED",
    "MySQL-family statement encoding is not permitted"
  ],
  [(sql) => /--|#|\/\*|\*\//u.test(sql), "VES_MYSQL_FAMILY_COMMENT_DENIED", "MySQL-family comments are not permitted"],
  [(sql) => sql.includes(";"), "VES_MYSQL_FAMILY_MULTI_STATEMENT", "MySQL-family request must contain one statement"],
  [
    (sql) => sql.includes("'") || sql.includes('"') || sql.includes("`"),
    "VES_MYSQL_FAMILY_LITERAL_DENIED",
    "Inline literals and quoted identifiers are not permitted"
  ],
  [
    (sql) => /\bINTO\s+(?:OUTFILE|DUMPFILE)\b/iu.test(sql),
    "VES_MYSQL_FAMILY_EXPORT_DENIED",
    "MySQL-family server-side export is not permitted"
  ],
  [(sql) => WRITE.test(sql), "VES_MYSQL_FAMILY_WRITE_DENIED", "MySQL-family write syntax is not permitted"],
  [
    (sql) => {
      const normalized = sql.replace(/\s+/gu, " ").trim().toUpperCase();
      return !normalized.startsWith("SELECT ") && !normalized.startsWith("WITH ");
    },
    "VES_MYSQL_FAMILY_READ_FORM_DENIED",
    "MySQL-family read form is not permitted"
  ]
];

function assertFamilyStatement(sql: unknown): asserts sql is string {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 131_072) {
    fail("VES_MYSQL_FAMILY_REQUEST_INVALID", "Protected MySQL-family statement is invalid");
  }
  for (const [denied, code, message] of STATEMENT_RULES) if (denied(sql)) fail(code, message);
}

function assertFamilyRequestOptions(options: ParseOptions): void {
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef)) {
    fail("VES_MYSQL_FAMILY_REQUEST_INVALID", "Protected request reference is invalid");
  }
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((item) => !CLASSIFICATIONS.includes(item as Classification))
  ) {
    fail("VES_MYSQL_FAMILY_PARAMETERS_INVALID", "MySQL-family parameter classifications are invalid");
  }
}

function commonTableExpressions(sql: string): Set<string> {
  const ctes = new Set<string>();
  for (const match of sql.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/giu)) {
    ctes.add((match[1] as string).toLowerCase());
  }
  return ctes;
}

// Returns undefined for a reference to a common table expression.
function familyObject(
  first: string,
  second: string | undefined,
  ctes: ReadonlySet<string>,
  kind: ParseOptions["kind"]
): FamilyObject | undefined {
  if (second === undefined) {
    if (ctes.has(first)) return undefined;
    fail("VES_MYSQL_FAMILY_OBJECT_INVALID", "MySQL-family objects must be schema-qualified");
  }
  if (!IDENTIFIER.test(first) || !IDENTIFIER.test(second)) {
    fail("VES_MYSQL_FAMILY_OBJECT_INVALID", "MySQL-family object identity is invalid");
  }
  const catalog = METADATA_SCHEMAS.has(first);
  if (catalog && (kind !== "introspect" || !SAFE_METADATA.has(`${first}.${second}`))) {
    fail("VES_MYSQL_FAMILY_CATALOG_DENIED", "MySQL-family metadata relation is not approved");
  }
  return { schema: first, name: second, type: catalog ? "catalog" : "table" };
}

function familyObjects(sql: string, ctes: ReadonlySet<string>, kind: ParseOptions["kind"]): Map<string, FamilyObject> {
  const objects = new Map<string, FamilyObject>();
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?/giu)) {
    const object = familyObject((match[1] as string).toLowerCase(), match[2]?.toLowerCase(), ctes, kind);
    if (object !== undefined) objects.set(`${object.schema}.${object.name}`, object);
  }
  if (objects.size === 0) fail("VES_MYSQL_FAMILY_OBJECT_INVALID", "MySQL-family read requires an object");
  return objects;
}

function familyFunctions(sql: string, ctes: ReadonlySet<string>): Set<string> {
  const functions = new Set<string>();
  for (const match of sql.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/giu)) {
    const name = (match[1] as string).toLowerCase();
    if (ctes.has(name) || FUNCTION_SYNTAX.has(name)) continue;
    if (!SAFE_FUNCTIONS.has(name)) {
      fail("VES_MYSQL_FAMILY_FUNCTION_DENIED", "MySQL-family function is not approved");
    }
    functions.add(name);
  }
  return functions;
}

export function parseMySqlFamilyReadOperation(sql: unknown, options: ParseOptions): MySqlFamilyOperation {
  if (options.engine !== "mysql" && options.engine !== "mariadb") {
    fail("VES_MYSQL_FAMILY_ENGINE_INVALID", "MySQL-family engine identity is invalid");
  }
  assertFamilyStatement(sql);
  assertFamilyRequestOptions(options);
  const ctes = commonTableExpressions(sql);
  const objects = familyObjects(sql, ctes, options.kind);
  const functions = familyFunctions(sql, ctes);
  const placeholders = [...sql].filter((character) => character === "?").length;
  if (placeholders !== options.parameterClassifications.length) {
    fail("VES_MYSQL_FAMILY_PARAMETERS_INVALID", "Parameter classifications do not match placeholders");
  }
  return Object.freeze({
    kind: options.kind,
    statementCount: 1,
    protectedRequestRef: options.protectedRequestRef,
    objects: Object.freeze(
      [...objects.values()].sort((left, right) =>
        codeUnitCompare(`${left.schema}.${left.name}`, `${right.schema}.${right.name}`)
      )
    ),
    functions: Object.freeze([...functions].sort(codeUnitCompare)),
    parameterClassifications: Object.freeze(
      options.parameterClassifications.toSorted(codeUnitCompare)
    ) as readonly Classification[]
  });
}

export interface FamilyPlan {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: MySqlFamilyOperation;
  readonly bounds: { readonly timeoutMs: number };
}

export interface MySqlFamilyPrincipalObservation {
  readonly engine: Engine;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly databaseId: string;
  readonly principal: string;
  readonly writePrivilegeCount: number;
  readonly filePrivilege: boolean;
  readonly superPrivilege: boolean;
  readonly createUserPrivilege: boolean;
}

export interface FamilyConnectionPort {
  inspectPrincipal(plan: FamilyPlan): Promise<MySqlFamilyPrincipalObservation>;
  executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]>;
  stream(statement: string, parameters: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}

function versionSupported(engine: Engine, version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (engine === "mysql") return major >= 8 && !/mariadb/iu.test(version);
  return /mariadb/iu.test(version) && (major > 10 || (major === 10 && minor >= 2));
}

function decodeRequest(bytes: Uint8Array) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("VES_MYSQL_FAMILY_REQUEST_INVALID", "Protected MySQL-family request is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("VES_MYSQL_FAMILY_REQUEST_INVALID", "Protected MySQL-family request is invalid");
  }
  const input = parsed as UnknownRecord;
  if (sortedKeys(input) !== "parameters,schemaVersion,sql" || input["schemaVersion"] !== 1) {
    fail("VES_MYSQL_FAMILY_REQUEST_INVALID", "Protected MySQL-family request is invalid");
  }
  if (!Array.isArray(input["parameters"]) || input["parameters"].length > 64) {
    fail("VES_MYSQL_FAMILY_PARAMETERS_INVALID", "Protected MySQL-family parameters are invalid");
  }
  for (const value of input["parameters"]) {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      fail("VES_MYSQL_FAMILY_PARAMETERS_INVALID", "Protected MySQL-family parameters are invalid");
    }
  }
  return { sql: input["sql"] as string, parameters: input["parameters"] };
}

abstract class BaseMySqlFamilyAdapter {
  readonly #engine: Engine;
  readonly #connection: FamilyConnectionPort;
  readonly #component: { readonly id: string; readonly digest: string };

  protected constructor(
    engine: Engine,
    component: { readonly id: string; readonly digest: string },
    connection: FamilyConnectionPort
  ) {
    this.#engine = engine;
    this.#component = component;
    this.#connection = connection;
  }

  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: this.#component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }

  async verifyIdentity(plan: FamilyPlan) {
    const observed = await this.#connection.inspectPrincipal(plan);
    if (observed.engine !== this.#engine || !versionSupported(this.#engine, observed.version)) {
      fail("VES_MYSQL_FAMILY_VERSION_UNSUPPORTED", "MySQL-family server version or identity is unsupported");
    }
    for (const capability of ["cte", "read-only-transactions", "metadata"]) {
      if (!observed.capabilities.includes(capability)) {
        fail("VES_MYSQL_FAMILY_CAPABILITY_MISSING", "MySQL-family server capability is missing");
      }
    }
    return Object.freeze({
      databaseId: observed.databaseId,
      principalReadOnly:
        observed.writePrivilegeCount === 0 &&
        !observed.filePrivilege &&
        !observed.superPrivilege &&
        !observed.createUserPrivilege,
      principalFingerprint: digest(observed),
      engine: observed.engine,
      version: observed.version
    });
  }

  async configureReadOnlySession(plan: FamilyPlan) {
    await this.#connection.executeControl("START TRANSACTION READ ONLY", []);
    if (this.#engine === "mysql") {
      await this.#connection.executeControl("SET SESSION MAX_EXECUTION_TIME = ?", [plan.bounds.timeoutMs]);
      const rows = await this.#connection.executeControl("SELECT @@transaction_read_only AS read_only", []);
      const readOnly = rows[0]?.["read_only"] === 1;
      return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
    }
    await this.#connection.executeControl("SET SESSION max_statement_time = ?", [plan.bounds.timeoutMs / 1000]);
    const rows = await this.#connection.executeControl("SELECT @@tx_read_only AS read_only", []);
    const readOnly = rows[0]?.["read_only"] === 1;
    return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
  }

  async *execute(plan: FamilyPlan, bytes: Uint8Array, signal: AbortSignal): AsyncIterable<readonly UnknownRecord[]> {
    const request = decodeRequest(bytes);
    const operation = parseMySqlFamilyReadOperation(request.sql, {
      engine: this.#engine,
      kind: plan.operation.kind,
      protectedRequestRef: plan.operation.protectedRequestRef,
      parameterClassifications: plan.operation.parameterClassifications
    });
    if (canonicalizeJsonV2(operation) !== canonicalizeJsonV2(plan.operation)) {
      fail("VES_MYSQL_FAMILY_PLAN_MISMATCH", "Protected MySQL-family request differs from the approved plan");
    }
    const placeholders = [...request.sql].filter((character) => character === "?").length;
    if (request.parameters.length !== placeholders) {
      fail("VES_MYSQL_FAMILY_PARAMETERS_INVALID", "Protected parameters do not match placeholders");
    }
    for await (const row of this.#connection.stream(request.sql, request.parameters, signal))
      yield Object.freeze([row]);
  }

  async cancel(): Promise<void> {
    await this.#connection.cancel();
  }

  async terminate(): Promise<void> {
    await this.#connection.terminate();
  }
}

export class MySqlProbeAdapter extends BaseMySqlFamilyAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:mysql", digest: `sha256:${"4".repeat(64)}` });
  constructor(options: { readonly connection: FamilyConnectionPort }) {
    super("mysql", MySqlProbeAdapter.component, options.connection);
  }
}

export class MariaDbProbeAdapter extends BaseMySqlFamilyAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:mariadb", digest: `sha256:${"5".repeat(64)}` });
  constructor(options: { readonly connection: FamilyConnectionPort }) {
    super("mariadb", MariaDbProbeAdapter.component, options.connection);
  }
}

interface FixtureOptions extends Partial<MySqlFamilyPrincipalObservation> {
  readonly engine: Engine;
  readonly transactionReadOnly?: boolean;
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}

export class MySqlFamilyFixtureConnection implements FamilyConnectionPort {
  readonly #options: FixtureOptions;
  readonly controlCalls: [string, readonly unknown[]][] = [];
  lastParameters: readonly unknown[] = [];
  streamCalls = 0;
  cancelled = false;
  terminated = false;

  constructor(options: FixtureOptions) {
    this.#options = options;
  }

  async inspectPrincipal(plan: FamilyPlan): Promise<MySqlFamilyPrincipalObservation> {
    const engine = this.#options.engine;
    return {
      engine,
      version: this.#options.version ?? (engine === "mysql" ? "8.4.5" : "11.4.8-MariaDB"),
      capabilities: this.#options.capabilities ?? ["cte", "read-only-transactions", "metadata"],
      databaseId: this.#options.databaseId ?? plan.databaseId,
      principal: this.#options.principal ?? "verchestra_readonly",
      writePrivilegeCount: this.#options.writePrivilegeCount ?? 0,
      filePrivilege: this.#options.filePrivilege ?? false,
      superPrivilege: this.#options.superPrivilege ?? false,
      createUserPrivilege: this.#options.createUserPrivilege ?? false
    };
  }

  async executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]> {
    this.controlCalls.push([statement, [...parameters]]);
    if (statement.includes("@@")) return [{ read_only: (this.#options.transactionReadOnly ?? true) ? 1 : 0 }];
    return [];
  }

  async *stream(_statement: string, parameters: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord> {
    this.streamCalls += 1;
    this.lastParameters = structuredClone(parameters);
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

  async cancel(): Promise<void> {
    this.cancelled = true;
  }

  async terminate(): Promise<void> {
    this.terminated = true;
  }
}
