import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const SAFE_FUNCTIONS = new Set([
  "abs",
  "avg",
  "coalesce",
  "count",
  "length",
  "lower",
  "max",
  "min",
  "nvl",
  "round",
  "substr",
  "sum",
  "trunc",
  "upper"
]);
const SYNTAX_FUNCTIONS = new Set(["as", "case", "exists", "in", "over"]);
const SAFE_CATALOGS = new Set([
  "all_cons_columns",
  "all_constraints",
  "all_ind_columns",
  "all_indexes",
  "all_tab_columns",
  "all_tables"
]);
const WRITE =
  /\b(?:ALTER|ANALYZE|AUDIT|COMMENT|COMMIT|CREATE|DELETE|DROP|FLASHBACK|GRANT|INSERT|LOCK|MERGE|NOAUDIT|PURGE|RENAME|REVOKE|ROLLBACK|SAVEPOINT|TRUNCATE|UPDATE)\b/iu;
const EXECUTION = /\b(?:BEGIN|CALL|DECLARE|EXEC(?:UTE)?|IMMEDIATE|OPEN)\b/iu;
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
export class OracleProbeError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "OracleProbeError";
    this.code = code;
  }
}
function fail(code: string, message: string): never {
  throw new OracleProbeError(code, message);
}

interface ParseOptions {
  readonly kind: "select" | "introspect";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}
export interface OracleOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly { readonly schema: string; readonly name: string; readonly type: "table" | "catalog" }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

export function parseOracleReadOperation(sql: unknown, options: ParseOptions): OracleOperation {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 131_072)
    fail("VES_ORACLE_REQUEST_INVALID", "Protected Oracle statement is invalid");
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(sql) || /\\|\x00/u.test(sql))
    fail("VES_ORACLE_ENCODING_DENIED", "Oracle statement encoding is not permitted");
  if (/--|\/\*|\*\//u.test(sql)) fail("VES_ORACLE_COMMENT_DENIED", "Oracle comments and hints are not permitted");
  if (sql.includes(";") || sql.split("\n").some((line) => line.trim() === "/"))
    fail("VES_ORACLE_BATCH_DENIED", "Oracle batches are not permitted");
  if (EXECUTION.test(sql) || /\bINTO\b/iu.test(sql))
    fail("VES_ORACLE_EXECUTION_DENIED", "Oracle PL SQL and execution syntax is not permitted");
  if (/@/u.test(sql)) fail("VES_ORACLE_DATABASE_LINK_DENIED", "Oracle database links are not permitted");
  if (/\bFOR\s+UPDATE\b/iu.test(sql)) fail("VES_ORACLE_LOCK_DENIED", "Oracle row locking is not permitted");
  if (/\b(?:NEXTVAL|CURRVAL)\b/iu.test(sql)) fail("VES_ORACLE_SEQUENCE_DENIED", "Oracle sequences are not permitted");
  if (sql.includes("'") || sql.includes('"') || /\bq\s*'/iu.test(sql) || /\b\d+(?:\.\d+)?\b/u.test(sql))
    fail("VES_ORACLE_LITERAL_DENIED", "Inline literals and quoted identifiers are not permitted");
  if (WRITE.test(sql)) fail("VES_ORACLE_WRITE_DENIED", "Oracle write or transaction syntax is not permitted");
  const normalized = sql.replace(/\s+/gu, " ").trim().toUpperCase();
  if (!normalized.startsWith("SELECT ") && !normalized.startsWith("WITH "))
    fail("VES_ORACLE_READ_FORM_DENIED", "Oracle read form is not permitted");
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef))
    fail("VES_ORACLE_REQUEST_INVALID", "Protected Oracle request reference is invalid");
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((v) => !CLASSIFICATIONS.includes(v as Classification))
  )
    fail("VES_ORACLE_PARAMETERS_INVALID", "Oracle parameter classifications are invalid");
  const ctes = new Set<string>();
  for (const m of sql.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/giu))
    ctes.add((m[1] as string).toLowerCase());
  const objects = new Map<string, { schema: string; name: string; type: "table" | "catalog" }>();
  for (const m of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_$#]*)(?:\.([a-z][a-z0-9_$#]*))?/giu)) {
    const first = (m[1] as string).toLowerCase();
    const second = m[2]?.toLowerCase();
    if (second === undefined) {
      if (ctes.has(first)) continue;
      const looksCatalog = /^(?:all_|dba_|user_|v\$|gv\$)/u.test(first);
      if (!looksCatalog) fail("VES_ORACLE_OBJECT_INVALID", "Oracle objects must be schema qualified");
      if (options.kind !== "introspect" || !SAFE_CATALOGS.has(first))
        fail("VES_ORACLE_CATALOG_DENIED", "Oracle catalog object is not approved");
      objects.set(`oracle_catalog.${first}`, { schema: "oracle_catalog", name: first, type: "catalog" });
      continue;
    }
    if (first === "sys" || first === "system")
      fail("VES_ORACLE_CATALOG_DENIED", "Oracle system schema is not approved");
    objects.set(`${first}.${second}`, { schema: first, name: second, type: "table" });
  }
  if (objects.size === 0) fail("VES_ORACLE_OBJECT_INVALID", "Oracle read requires an approved object");
  const functions = new Set<string>();
  for (const m of sql.matchAll(/\b([a-z][a-z0-9_$#]*)\s*\(/giu)) {
    const name = (m[1] as string).toLowerCase();
    if (ctes.has(name) || SYNTAX_FUNCTIONS.has(name)) continue;
    if (/^(?:dbms_|utl_)/u.test(name) || !SAFE_FUNCTIONS.has(name))
      fail("VES_ORACLE_FUNCTION_DENIED", "Oracle function is not approved");
    functions.add(name);
  }
  const params = [...sql.matchAll(/:p(\d+)\b/giu)].map((m) => Number(m[1]));
  const maximum = params.length ? Math.max(...params) : 0;
  if (
    maximum !== options.parameterClassifications.length ||
    new Set(params).size !== maximum ||
    params.some((v) => !Number.isSafeInteger(v) || v < 1 || v > 64)
  )
    fail("VES_ORACLE_PARAMETERS_INVALID", "Oracle binds are invalid");
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

export interface OracleConnectionPlan {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: OracleOperation;
  readonly bounds: { readonly timeoutMs: number; readonly rowLimit: number };
}
export interface OracleObservation {
  readonly product: string;
  readonly version: string;
  readonly databaseId: string;
  readonly user: string;
  readonly sysdba: boolean;
  readonly sysoper: boolean;
  readonly sysasm: boolean;
  readonly sysbackup: boolean;
  readonly sysdg: boolean;
  readonly syskm: boolean;
  readonly dbaRole: boolean;
  readonly writeSystemPrivilegeCount: number;
  readonly writeObjectPrivilegeCount: number;
  readonly executeAnyProcedure: boolean;
  readonly createDatabaseLink: boolean;
}
export interface OracleConnectionPort {
  inspectPrincipal(plan: OracleConnectionPlan): Promise<OracleObservation>;
  executeControl(sql: string, params: readonly unknown[]): Promise<readonly UnknownRecord[]>;
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
    fail("VES_ORACLE_REQUEST_INVALID", "Protected Oracle request is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    fail("VES_ORACLE_REQUEST_INVALID", "Protected Oracle request is invalid");
  const input = parsed as UnknownRecord;
  if (Object.keys(input).sort().join(",") !== "parameters,schemaVersion,sql" || input["schemaVersion"] !== 1)
    fail("VES_ORACLE_REQUEST_INVALID", "Protected Oracle request is invalid");
  if (
    !Array.isArray(input["parameters"]) ||
    input["parameters"].length > 64 ||
    input["parameters"].some((v) => v !== null && !["string", "number", "boolean"].includes(typeof v))
  )
    fail("VES_ORACLE_PARAMETERS_INVALID", "Protected Oracle parameters are invalid");
  return { sql: input["sql"] as string, parameters: input["parameters"] };
}

export class OracleProbeAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:oracle", digest: `sha256:${"8".repeat(64)}` });
  readonly #connection: OracleConnectionPort;
  constructor(options: { readonly connection: OracleConnectionPort }) {
    this.#connection = options.connection;
  }
  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: OracleProbeAdapter.component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }
  async verifyIdentity(plan: OracleConnectionPlan) {
    const o = await this.#connection.inspectPrincipal(plan);
    if (o.product !== "oracle") fail("VES_ORACLE_PRODUCT_INVALID", "Database product is not Oracle");
    return Object.freeze({
      databaseId: o.databaseId,
      product: o.product,
      version: o.version,
      principalReadOnly:
        !o.sysdba &&
        !o.sysoper &&
        !o.sysasm &&
        !o.sysbackup &&
        !o.sysdg &&
        !o.syskm &&
        !o.dbaRole &&
        o.writeSystemPrivilegeCount === 0 &&
        o.writeObjectPrivilegeCount === 0 &&
        !o.executeAnyProcedure &&
        !o.createDatabaseLink,
      principalFingerprint: digest(o)
    });
  }
  async configureReadOnlySession(plan: OracleConnectionPlan) {
    await this.#connection.executeControl("SET TRANSACTION READ ONLY", []);
    const rows = await this.#connection.executeControl(
      "SELECT session_write_count, session_dangerous_role_count, transaction_read_only FROM dual",
      []
    );
    const readOnly =
      rows[0]?.["session_write_count"] === 0 &&
      rows[0]?.["session_dangerous_role_count"] === 0 &&
      rows[0]?.["transaction_read_only"] === 1;
    return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
  }
  async *execute(
    plan: OracleConnectionPlan,
    bytes: Uint8Array,
    signal: AbortSignal
  ): AsyncIterable<readonly UnknownRecord[]> {
    const request = decode(bytes);
    const operation = parseOracleReadOperation(request.sql, {
      kind: plan.operation.kind,
      protectedRequestRef: plan.operation.protectedRequestRef,
      parameterClassifications: plan.operation.parameterClassifications
    });
    if (canonicalizeJsonV2(operation) !== canonicalizeJsonV2(plan.operation))
      fail("VES_ORACLE_PLAN_MISMATCH", "Protected Oracle request differs from the approved plan");
    const markers = [...request.sql.matchAll(/:p(\d+)\b/giu)].map((m) => Number(m[1]));
    const maximum = markers.length ? Math.max(...markers) : 0;
    if (request.parameters.length !== maximum)
      fail("VES_ORACLE_PARAMETERS_INVALID", "Protected Oracle parameters do not match binds");
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

interface FixtureOptions extends Partial<OracleObservation> {
  readonly transactionReadOnly?: boolean;
  readonly sessionWriteCount?: number;
  readonly sessionDangerousRoleCount?: number;
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}
export class OracleFixtureConnection implements OracleConnectionPort {
  readonly #options: FixtureOptions;
  readonly controlCalls: [string, readonly unknown[]][] = [];
  lastParameters: readonly unknown[] = [];
  lastMaximumRows = 0;
  streamCalls = 0;
  cancelled = false;
  terminated = false;
  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }
  async inspectPrincipal(plan: OracleConnectionPlan): Promise<OracleObservation> {
    return {
      product: this.#options.product ?? "oracle",
      version: this.#options.version ?? "19.25",
      databaseId: this.#options.databaseId ?? plan.databaseId,
      user: this.#options.user ?? "VRC_PROBE",
      sysdba: this.#options.sysdba ?? false,
      sysoper: this.#options.sysoper ?? false,
      sysasm: this.#options.sysasm ?? false,
      sysbackup: this.#options.sysbackup ?? false,
      sysdg: this.#options.sysdg ?? false,
      syskm: this.#options.syskm ?? false,
      dbaRole: this.#options.dbaRole ?? false,
      writeSystemPrivilegeCount: this.#options.writeSystemPrivilegeCount ?? 0,
      writeObjectPrivilegeCount: this.#options.writeObjectPrivilegeCount ?? 0,
      executeAnyProcedure: this.#options.executeAnyProcedure ?? false,
      createDatabaseLink: this.#options.createDatabaseLink ?? false
    };
  }
  async executeControl(sql: string, params: readonly unknown[]): Promise<readonly UnknownRecord[]> {
    this.controlCalls.push([sql, [...params]]);
    return sql.startsWith("SELECT session_write")
      ? [
          {
            session_write_count: this.#options.sessionWriteCount ?? 0,
            session_dangerous_role_count: this.#options.sessionDangerousRoleCount ?? 0,
            transaction_read_only: (this.#options.transactionReadOnly ?? true) ? 1 : 0
          }
        ]
      : [];
  }
  async *stream(
    _sql: string,
    params: readonly unknown[],
    signal: AbortSignal,
    maximumRows: number
  ): AsyncIterable<UnknownRecord> {
    this.streamCalls += 1;
    this.lastParameters = structuredClone(params);
    this.lastMaximumRows = maximumRows;
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
