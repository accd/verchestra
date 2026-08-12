import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/u;
const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const SAFE_FUNCTIONS = new Set([
  "avg",
  "coalesce",
  "count",
  "date_trunc",
  "length",
  "lower",
  "max",
  "min",
  "sum",
  "upper"
]);
const FUNCTION_SYNTAX = new Set(["as", "case", "exists", "explain", "in", "over"]);
const SAFE_CATALOGS = new Set([
  "pg_catalog.pg_attribute",
  "pg_catalog.pg_class",
  "pg_catalog.pg_constraint",
  "pg_catalog.pg_index",
  "pg_catalog.pg_namespace",
  "pg_catalog.pg_tables",
  "information_schema.columns",
  "information_schema.table_constraints",
  "information_schema.tables"
]);
const WRITE_KEYWORDS =
  /\b(?:ALTER|ANALYZE|CALL|CLUSTER|COMMENT|COPY|CREATE|DELETE|DO|DROP|GRANT|INSERT|LISTEN|LOAD|LOCK|MERGE|NOTIFY|REFRESH|REINDEX|REVOKE|SECURITY|SET|TRUNCATE|UNLISTEN|UPDATE|VACUUM)\b/iu;

type Classification = (typeof CLASSIFICATIONS)[number];
type UnknownRecord = Readonly<Record<string, unknown>>;

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

export class PostgreSqlProbeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PostgreSqlProbeError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new PostgreSqlProbeError(code, message);
}

interface ParseOptions {
  readonly kind: "select" | "introspect";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}

export interface PostgreSqlReadOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly { readonly schema: string; readonly name: string; readonly type: "table" | "catalog" }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

function sqlPrefixAllowed(sql: string): boolean {
  const normalized = sql.replace(/\s+/gu, " ").trim().toUpperCase();
  return (
    normalized.startsWith("SELECT ") ||
    normalized.startsWith("WITH ") ||
    normalized.startsWith("EXPLAIN SELECT ") ||
    normalized.startsWith("EXPLAIN (FORMAT JSON) SELECT ")
  );
}

export function parsePostgreSqlReadOperation(sql: unknown, options: ParseOptions): PostgreSqlReadOperation {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 131_072) {
    fail("VES_POSTGRES_REQUEST_INVALID", "Protected PostgreSQL statement is invalid");
  }
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(sql) || /\\/u.test(sql) || /\$(?!\d+\b)/u.test(sql)) {
    fail("VES_POSTGRES_ENCODING_DENIED", "PostgreSQL statement encoding is not permitted");
  }
  if (/--|\/\*|\*\//u.test(sql)) fail("VES_POSTGRES_COMMENT_DENIED", "PostgreSQL comments are not permitted");
  if (sql.includes(";")) fail("VES_POSTGRES_MULTI_STATEMENT", "PostgreSQL request must contain one statement");
  if (sql.includes("'") || sql.includes('"')) {
    fail("VES_POSTGRES_LITERAL_DENIED", "Inline SQL literals and quoted identifiers are not permitted");
  }
  if (/\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/iu.test(sql)) {
    fail("VES_POSTGRES_LOCK_DENIED", "PostgreSQL row locking is not permitted");
  }
  if (WRITE_KEYWORDS.test(sql)) fail("VES_POSTGRES_WRITE_DENIED", "PostgreSQL write syntax is not permitted");
  if (!sqlPrefixAllowed(sql)) fail("VES_POSTGRES_READ_FORM_DENIED", "PostgreSQL read form is not permitted");
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef)) {
    fail("VES_POSTGRES_REQUEST_INVALID", "Protected PostgreSQL request reference is invalid");
  }
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((item) => !CLASSIFICATIONS.includes(item as Classification))
  ) {
    fail("VES_POSTGRES_PARAMETERS_INVALID", "PostgreSQL parameter classifications are invalid");
  }

  const cteNames = new Set<string>();
  for (const match of sql.matchAll(/(?:\bWITH\b|,)\s*([a-z][a-z0-9_]*)\s+AS\s*\(/giu)) {
    cteNames.add((match[1] as string).toLowerCase());
  }
  const objects = new Map<string, { schema: string; name: string; type: "table" | "catalog" }>();
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?/giu)) {
    const first = (match[1] as string).toLowerCase();
    const second = match[2]?.toLowerCase();
    if (second === undefined) {
      if (cteNames.has(first)) continue;
      fail("VES_POSTGRES_OBJECT_INVALID", "PostgreSQL objects must be schema-qualified");
    }
    if (!IDENTIFIER.test(first) || !IDENTIFIER.test(second)) {
      fail("VES_POSTGRES_OBJECT_INVALID", "PostgreSQL object identity is invalid");
    }
    const identity = `${first}.${second}`;
    const catalog = first === "pg_catalog" || first === "information_schema";
    if (catalog && (options.kind !== "introspect" || !SAFE_CATALOGS.has(identity))) {
      fail("VES_POSTGRES_CATALOG_DENIED", "PostgreSQL catalog relation is not approved");
    }
    objects.set(identity, { schema: first, name: second, type: catalog ? "catalog" : "table" });
  }
  if (objects.size === 0) fail("VES_POSTGRES_OBJECT_INVALID", "PostgreSQL read requires an approved object");

  const functions = new Set<string>();
  for (const match of sql.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/giu)) {
    const name = (match[1] as string).toLowerCase();
    if (cteNames.has(name) || FUNCTION_SYNTAX.has(name)) continue;
    if (!SAFE_FUNCTIONS.has(name)) fail("VES_POSTGRES_FUNCTION_DENIED", "PostgreSQL function is not approved");
    functions.add(name);
  }
  const placeholders = [...sql.matchAll(/\$(\d+)\b/gu)].map((match) => Number(match[1]));
  const maximum = placeholders.length === 0 ? 0 : Math.max(...placeholders);
  if (
    maximum !== options.parameterClassifications.length ||
    new Set(placeholders).size !== maximum ||
    placeholders.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 64)
  ) {
    fail("VES_POSTGRES_PARAMETERS_INVALID", "PostgreSQL parameter classifications do not match placeholders");
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
    functions: Object.freeze([...functions].sort()),
    parameterClassifications: Object.freeze([...options.parameterClassifications].sort()) as readonly Classification[]
  });
}

export interface PostgreSqlPlan {
  readonly workspaceId: string;
  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: PostgreSqlReadOperation;
  readonly bounds: { readonly timeoutMs: number };
}

export interface PostgreSqlPrincipalObservation {
  readonly databaseId: string;
  readonly principal: string;
  readonly superuser: boolean;
  readonly createRole: boolean;
  readonly createDatabase: boolean;
  readonly replication: boolean;
  readonly bypassRls: boolean;
  readonly writePrivilegeCount: number;
}

export interface PostgreSqlConnectionPort {
  inspectPrincipal(plan: PostgreSqlPlan): Promise<PostgreSqlPrincipalObservation>;
  executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]>;
  stream(statement: string, parameters: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}

function decodeRequest(bytes: Uint8Array): { readonly sql: string; readonly parameters: readonly unknown[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("VES_POSTGRES_REQUEST_INVALID", "Protected PostgreSQL request is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("VES_POSTGRES_REQUEST_INVALID", "Protected PostgreSQL request is invalid");
  }
  const input = parsed as UnknownRecord;
  if (Object.keys(input).sort().join(",") !== "parameters,schemaVersion,sql" || input["schemaVersion"] !== 1) {
    fail("VES_POSTGRES_REQUEST_INVALID", "Protected PostgreSQL request is invalid");
  }
  if (!Array.isArray(input["parameters"]) || input["parameters"].length > 64) {
    fail("VES_POSTGRES_PARAMETERS_INVALID", "Protected PostgreSQL parameters are invalid");
  }
  for (const value of input["parameters"]) {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      fail("VES_POSTGRES_PARAMETERS_INVALID", "Protected PostgreSQL parameters are invalid");
    }
  }
  return { sql: input["sql"] as string, parameters: input["parameters"] };
}

export class PostgreSqlProbeAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:postgresql", digest: `sha256:${"3".repeat(64)}` });
  readonly #connection: PostgreSqlConnectionPort;

  constructor(options: { readonly connection: PostgreSqlConnectionPort }) {
    this.#connection = options.connection;
  }

  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: PostgreSqlProbeAdapter.component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }

  async verifyIdentity(plan: PostgreSqlPlan) {
    const observed = await this.#connection.inspectPrincipal(plan);
    const principalReadOnly =
      !observed.superuser &&
      !observed.createRole &&
      !observed.createDatabase &&
      !observed.replication &&
      !observed.bypassRls &&
      observed.writePrivilegeCount === 0;
    return Object.freeze({
      databaseId: observed.databaseId,
      principalReadOnly,
      principalFingerprint: digest(observed)
    });
  }

  async configureReadOnlySession(plan: PostgreSqlPlan) {
    await this.#connection.executeControl("BEGIN READ ONLY", []);
    await this.#connection.executeControl("SET LOCAL statement_timeout = $1", [plan.bounds.timeoutMs]);
    await this.#connection.executeControl("SET LOCAL lock_timeout = $1", [plan.bounds.timeoutMs]);
    const rows = await this.#connection.executeControl("SHOW transaction_read_only", []);
    const transactionReadOnly = rows[0]?.["transaction_read_only"] === "on";
    return Object.freeze({
      planDigest: plan.planDigest,
      sessionReadOnly: transactionReadOnly,
      transactionReadOnly
    });
  }

  async *execute(
    plan: PostgreSqlPlan,
    protectedBytes: Uint8Array,
    signal: AbortSignal
  ): AsyncIterable<readonly UnknownRecord[]> {
    try {
      const request = decodeRequest(protectedBytes);
      const operation = parsePostgreSqlReadOperation(request.sql, {
        kind: plan.operation.kind,
        protectedRequestRef: plan.operation.protectedRequestRef,
        parameterClassifications: plan.operation.parameterClassifications
      });
      if (canonicalizeJsonV2(operation) !== canonicalizeJsonV2(plan.operation)) {
        fail("VES_POSTGRES_PLAN_MISMATCH", "Protected PostgreSQL request differs from the approved plan");
      }
      const placeholders = [...request.sql.matchAll(/\$(\d+)\b/gu)].map((match) => Number(match[1]));
      const maximum = placeholders.length === 0 ? 0 : Math.max(...placeholders);
      if (request.parameters.length !== maximum) {
        fail("VES_POSTGRES_PARAMETERS_INVALID", "Protected PostgreSQL parameters do not match placeholders");
      }
      for await (const row of this.#connection.stream(request.sql, request.parameters, signal))
        yield Object.freeze([row]);
    } catch (error) {
      // Every PostgreSqlProbeError this adapter raises carries a static,
      // pre-written message (see the fail() calls above and in
      // parsePostgreSqlReadOperation) — none of them interpolate the
      // protected SQL text, bound parameters, or row data, so propagating
      // any of them unchanged, regardless of code, is always safe (#233).
      // Only this branch is untrusted: an error thrown by
      // PostgreSqlConnectionPort#stream() (a real driver's own error) may
      // embed the failing statement or its parameter values in its message,
      // so it is deliberately not propagated — it is rewritten to the one
      // generic, connection-agnostic code below.
      if (error instanceof PostgreSqlProbeError) throw error;
      throw new PostgreSqlProbeError("VES_POSTGRES_CONNECTION_FAILURE", "PostgreSQL connection failed");
    }
  }

  async cancel(): Promise<void> {
    await this.#connection.cancel();
  }

  async terminate(): Promise<void> {
    await this.#connection.terminate();
  }
}

interface FixtureOptions extends Partial<PostgreSqlPrincipalObservation> {
  readonly transactionReadOnly?: "on" | "off";
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}

export class PostgreSqlFixtureConnection implements PostgreSqlConnectionPort {
  readonly #options: FixtureOptions;
  readonly controlCalls: [string, readonly unknown[]][] = [];
  lastParameters: readonly unknown[] = [];
  streamCalls = 0;
  cancelled = false;
  terminated = false;

  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }

  async inspectPrincipal(plan: PostgreSqlPlan): Promise<PostgreSqlPrincipalObservation> {
    return {
      databaseId: this.#options.databaseId ?? plan.databaseId,
      principal: this.#options.principal ?? "verchestra_readonly",
      superuser: this.#options.superuser ?? false,
      createRole: this.#options.createRole ?? false,
      createDatabase: this.#options.createDatabase ?? false,
      replication: this.#options.replication ?? false,
      bypassRls: this.#options.bypassRls ?? false,
      writePrivilegeCount: this.#options.writePrivilegeCount ?? 0
    };
  }

  async executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]> {
    this.controlCalls.push([statement, [...parameters]]);
    if (statement === "SHOW transaction_read_only") {
      return [{ transaction_read_only: this.#options.transactionReadOnly ?? "on" }];
    }
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
