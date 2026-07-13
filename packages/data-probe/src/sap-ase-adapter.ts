import { createHash } from "node:crypto";

const CLASSIFICATIONS = ["public", "internal", "confidential", "restricted", "secret"] as const;
const SAFE_FUNCTIONS = new Set([
  "abs",
  "avg",
  "char_length",
  "coalesce",
  "convert",
  "count",
  "dateadd",
  "datediff",
  "isnull",
  "lower",
  "ltrim",
  "max",
  "min",
  "rtrim",
  "str_replace",
  "substring",
  "sum",
  "upper"
]);
const SYNTAX_FUNCTIONS = new Set(["case", "exists", "from", "in"]);
const SAFE_CATALOGS = new Set([
  "dbo.syscolumns",
  "dbo.sysconstraints",
  "dbo.sysindexes",
  "dbo.sysobjects",
  "dbo.sysreferences",
  "dbo.sysusers"
]);
const WRITE =
  /\b(?:ALTER|BULK|CHECKPOINT|CREATE|DBCC|DELETE|DISK|DROP|DUMP|GRANT|INSERT|KILL|LOAD|RECONFIGURE|REORG|REVOKE|SETUSER|TRANSFER|TRUNCATE|UPDATE|WRITETEXT)\b/iu;
const EXECUTION = /\b(?:EXEC(?:UTE)?|EXECUTE\s+IMMEDIATE|SET\s+PROXY|SET\s+SESSION\s+AUTHORIZATION|USE|WAITFOR)\b/iu;

type UnknownRecord = Readonly<Record<string, unknown>>;
type Classification = (typeof CLASSIFICATIONS)[number];

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as UnknownRecord)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

export class SapAseProbeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SapAseProbeError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new SapAseProbeError(code, message);
}

interface ParseOptions {
  readonly kind: "select" | "introspect";
  readonly protectedRequestRef: string;
  readonly parameterClassifications: readonly string[];
}

interface SapAseOperation {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly {
    readonly schema: string;
    readonly name: string;
    readonly type: "table" | "catalog";
  }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}

export function parseSapAseReadOperation(sql: unknown, options: ParseOptions): SapAseOperation {
  if (typeof sql !== "string" || sql.length === 0 || sql.length > 131_072) {
    fail("VES_SAP_ASE_REQUEST_INVALID", "Protected SAP ASE statement is invalid");
  }
  if (!/^[\x09\x0a\x0d\x20-\x7e]+$/u.test(sql) || /\\/u.test(sql)) {
    fail("VES_SAP_ASE_ENCODING_DENIED", "SAP ASE statement encoding is not permitted");
  }
  if (/--|\/\*|\*\//u.test(sql)) fail("VES_SAP_ASE_COMMENT_DENIED", "SAP ASE comments are not permitted");
  if (sql.includes(";") || /(?:^|\r?\n)\s*GO\s*(?:\r?\n|$)/iu.test(sql)) {
    fail("VES_SAP_ASE_BATCH_DENIED", "SAP ASE batches are not permitted");
  }
  if (
    sql.includes("'") ||
    sql.includes('"') ||
    sql.includes("[") ||
    sql.includes("]") ||
    sql.includes("`") ||
    /\b\d+(?:\.\d+)?\b/u.test(sql)
  ) {
    fail("VES_SAP_ASE_LITERAL_DENIED", "Inline literals and quoted identifiers are not permitted");
  }
  if (/@/u.test(sql)) fail("VES_SAP_ASE_VARIABLE_DENIED", "SAP ASE variables are not permitted");
  if (EXECUTION.test(sql)) fail("VES_SAP_ASE_EXECUTION_DENIED", "SAP ASE execution syntax is not permitted");
  if (/#|\btempdb\b/iu.test(sql)) {
    fail("VES_SAP_ASE_TEMP_OBJECT_DENIED", "SAP ASE temporary objects are not permitted");
  }
  if (/\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?/iu.test(sql)) {
    fail("VES_SAP_ASE_REMOTE_OBJECT_DENIED", "SAP ASE cross database or remote objects are not permitted");
  }
  if (/\bINTO\s+[a-z]/iu.test(sql) || WRITE.test(sql)) {
    fail("VES_SAP_ASE_WRITE_DENIED", "SAP ASE write syntax is not permitted");
  }
  const normalized = sql.replace(/\s+/gu, " ").trim().toLowerCase();
  if (!normalized.startsWith("select ")) {
    fail("VES_SAP_ASE_READ_FORM_DENIED", "SAP ASE read form is not permitted");
  }
  if (!/^protected-request:[a-z0-9-]{16,128}$/u.test(options.protectedRequestRef)) {
    fail("VES_SAP_ASE_REQUEST_INVALID", "Protected SAP ASE request reference is invalid");
  }
  if (
    !Array.isArray(options.parameterClassifications) ||
    options.parameterClassifications.length > 64 ||
    options.parameterClassifications.some((item) => !CLASSIFICATIONS.includes(item as Classification))
  ) {
    fail("VES_SAP_ASE_PARAMETERS_INVALID", "SAP ASE parameter classifications are invalid");
  }

  const objects = new Map<string, { schema: string; name: string; type: "table" | "catalog" }>();
  for (const match of sql.matchAll(/\b(?:from|join)\s+([a-z][a-z0-9_]*)(?:\.([a-z][a-z0-9_]*))?/giu)) {
    const schema = (match[1] as string).toLowerCase();
    const name = match[2]?.toLowerCase();
    if (name === undefined) fail("VES_SAP_ASE_OBJECT_INVALID", "SAP ASE objects must be owner qualified");
    const identity = `${schema}.${name}`;
    const catalog = schema === "dbo" && name.startsWith("sys");
    if (catalog && (options.kind !== "introspect" || !SAFE_CATALOGS.has(identity))) {
      fail("VES_SAP_ASE_CATALOG_DENIED", "SAP ASE catalog object is not approved");
    }
    objects.set(identity, { schema, name, type: catalog ? "catalog" : "table" });
  }
  if (objects.size === 0) fail("VES_SAP_ASE_OBJECT_INVALID", "SAP ASE read requires an approved object");

  const functions = new Set<string>();
  for (const match of sql.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/giu)) {
    const name = (match[1] as string).toLowerCase();
    if (SYNTAX_FUNCTIONS.has(name)) continue;
    if (!SAFE_FUNCTIONS.has(name)) fail("VES_SAP_ASE_FUNCTION_DENIED", "SAP ASE function is not approved");
    functions.add(name);
  }
  const placeholders = [...sql].filter((character) => character === "?").length;
  if (placeholders !== options.parameterClassifications.length) {
    fail("VES_SAP_ASE_PARAMETERS_INVALID", "SAP ASE parameter classifications do not match placeholders");
  }
  return Object.freeze({
    kind: options.kind,
    statementCount: 1,
    protectedRequestRef: options.protectedRequestRef,
    objects: Object.freeze(
      [...objects.values()].sort((left, right) =>
        `${left.schema}.${left.name}`.localeCompare(`${right.schema}.${right.name}`)
      )
    ),
    functions: Object.freeze([...functions].sort()),
    parameterClassifications: Object.freeze([...options.parameterClassifications].sort()) as readonly Classification[]
  });
}

interface SapAsePlan {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: SapAseOperation;
  readonly bounds: { readonly timeoutMs: number; readonly rowLimit: number };
}

interface PrincipalObservation {
  readonly product: string;
  readonly version: string;
  readonly databaseId: string;
  readonly login: string;
  readonly databaseUser: string;
  readonly saRole: boolean;
  readonly ssoRole: boolean;
  readonly operRole: boolean;
  readonly replicationRole: boolean;
  readonly dtmRole: boolean;
  readonly databaseOwner: boolean;
  readonly serverAdminPrivilegeCount: number;
  readonly writePermissionCount: number;
  readonly ddlPermissionCount: number;
  readonly executePermissionCount: number;
  readonly proxyPermission: boolean;
}

interface SapAseConnectionPort {
  inspectPrincipal(plan: SapAsePlan): Promise<PrincipalObservation>;
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
    fail("VES_SAP_ASE_REQUEST_INVALID", "Protected SAP ASE request is invalid");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    fail("VES_SAP_ASE_REQUEST_INVALID", "Protected SAP ASE request is invalid");
  }
  const input = parsed as UnknownRecord;
  if (Object.keys(input).sort().join(",") !== "parameters,schemaVersion,sql" || input["schemaVersion"] !== 1) {
    fail("VES_SAP_ASE_REQUEST_INVALID", "Protected SAP ASE request is invalid");
  }
  if (!Array.isArray(input["parameters"]) || input["parameters"].length > 64) {
    fail("VES_SAP_ASE_PARAMETERS_INVALID", "Protected SAP ASE parameters are invalid");
  }
  for (const value of input["parameters"]) {
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      fail("VES_SAP_ASE_PARAMETERS_INVALID", "Protected SAP ASE parameters are invalid");
    }
  }
  return { sql: input["sql"] as string, parameters: input["parameters"] };
}

export class SapAseProbeAdapter {
  static readonly component = Object.freeze({ id: "probe-worker:sap-ase", digest: `sha256:${"7".repeat(64)}` });
  readonly #connection: SapAseConnectionPort;

  constructor(options: { readonly connection: SapAseConnectionPort }) {
    this.#connection = options.connection;
  }

  async handshake() {
    return Object.freeze({
      protocol: "verchestra-probe/1",
      supportedSchemas: Object.freeze(["probe.plan/1", "probe.result/1"]),
      component: SapAseProbeAdapter.component,
      capabilities: Object.freeze(["database-read"]),
      maximumMessageBytes: 65_536
    });
  }

  async verifyIdentity(plan: SapAsePlan) {
    const observed = await this.#connection.inspectPrincipal(plan);
    if (observed.product !== "sap-ase") {
      fail("VES_SAP_ASE_PRODUCT_INVALID", "Database product is not SAP ASE");
    }
    return Object.freeze({
      databaseId: observed.databaseId,
      product: observed.product,
      version: observed.version,
      principalReadOnly:
        !observed.saRole &&
        !observed.ssoRole &&
        !observed.operRole &&
        !observed.replicationRole &&
        !observed.dtmRole &&
        !observed.databaseOwner &&
        observed.serverAdminPrivilegeCount === 0 &&
        observed.writePermissionCount === 0 &&
        observed.ddlPermissionCount === 0 &&
        observed.executePermissionCount === 0 &&
        !observed.proxyPermission,
      principalFingerprint: digest(observed)
    });
  }

  async configureReadOnlySession(plan: SapAsePlan) {
    const lockWaitSeconds = Math.max(1, Math.ceil(plan.bounds.timeoutMs / 1000));
    await this.#connection.executeControl("set chained off", []);
    await this.#connection.executeControl(`set lock wait ${lockWaitSeconds}`, []);
    await this.#connection.executeControl(`set rowcount ${plan.bounds.rowLimit}`, []);
    await this.#connection.executeControl("begin transaction", []);
    const rows = await this.#connection.executeControl(
      "select session_write_count, session_dangerous_role_count, session_execute_count",
      []
    );
    const readOnly =
      rows[0]?.["session_write_count"] === 0 &&
      rows[0]?.["session_dangerous_role_count"] === 0 &&
      rows[0]?.["session_execute_count"] === 0;
    return Object.freeze({ planDigest: plan.planDigest, sessionReadOnly: readOnly, transactionReadOnly: readOnly });
  }

  async *execute(plan: SapAsePlan, bytes: Uint8Array, signal: AbortSignal): AsyncIterable<readonly UnknownRecord[]> {
    const request = decodeRequest(bytes);
    const operation = parseSapAseReadOperation(request.sql, {
      kind: plan.operation.kind,
      protectedRequestRef: plan.operation.protectedRequestRef,
      parameterClassifications: plan.operation.parameterClassifications
    });
    if (canonical(operation) !== canonical(plan.operation)) {
      fail("VES_SAP_ASE_PLAN_MISMATCH", "Protected SAP ASE request differs from the approved plan");
    }
    const placeholders = [...request.sql].filter((character) => character === "?").length;
    if (request.parameters.length !== placeholders) {
      fail("VES_SAP_ASE_PARAMETERS_INVALID", "Protected SAP ASE parameters do not match placeholders");
    }
    for await (const row of this.#connection.stream(request.sql, request.parameters, signal)) {
      yield Object.freeze([row]);
    }
  }

  async cancel(): Promise<void> {
    await this.#connection.cancel();
  }

  async terminate(): Promise<void> {
    await this.#connection.terminate();
  }
}

interface FixtureOptions extends Partial<PrincipalObservation> {
  readonly sessionWriteCount?: number;
  readonly sessionDangerousRoleCount?: number;
  readonly sessionExecuteCount?: number;
  readonly rows?: readonly UnknownRecord[];
  readonly delayMs?: number;
}

export class SapAseFixtureConnection implements SapAseConnectionPort {
  readonly #options: FixtureOptions;
  readonly controlCalls: [string, readonly unknown[]][] = [];
  lastParameters: readonly unknown[] = [];
  streamCalls = 0;
  cancelled = false;
  terminated = false;

  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }

  async inspectPrincipal(plan: SapAsePlan): Promise<PrincipalObservation> {
    return {
      product: this.#options.product ?? "sap-ase",
      version: this.#options.version ?? "16.1 SP00 PL02",
      databaseId: this.#options.databaseId ?? plan.databaseId,
      login: this.#options.login ?? "verchestra_probe",
      databaseUser: this.#options.databaseUser ?? "verchestra_probe",
      saRole: this.#options.saRole ?? false,
      ssoRole: this.#options.ssoRole ?? false,
      operRole: this.#options.operRole ?? false,
      replicationRole: this.#options.replicationRole ?? false,
      dtmRole: this.#options.dtmRole ?? false,
      databaseOwner: this.#options.databaseOwner ?? false,
      serverAdminPrivilegeCount: this.#options.serverAdminPrivilegeCount ?? 0,
      writePermissionCount: this.#options.writePermissionCount ?? 0,
      ddlPermissionCount: this.#options.ddlPermissionCount ?? 0,
      executePermissionCount: this.#options.executePermissionCount ?? 0,
      proxyPermission: this.#options.proxyPermission ?? false
    };
  }

  async executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]> {
    this.controlCalls.push([statement, [...parameters]]);
    if (statement.startsWith("select session_write_count")) {
      return [
        {
          session_write_count: this.#options.sessionWriteCount ?? 0,
          session_dangerous_role_count: this.#options.sessionDangerousRoleCount ?? 0,
          session_execute_count: this.#options.sessionExecuteCount ?? 0
        }
      ];
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
