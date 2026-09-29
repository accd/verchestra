// invariant: every string in this file is emitted byte-for-byte into a team's
// repository. Nothing here may read a clock, the environment, the platform, or
// the product release version, so one (engine, contract version) pair always
// yields the same bytes. The contract text is a copy of the published
// @verchestra/data-probe ports; tests/unit/probe-scaffold-contract.test.mjs
// fails when the two stop being identical types.

export const PROBE_SCAFFOLD_ENGINES = Object.freeze([
  "postgresql",
  "mysql",
  "mariadb",
  "sqlserver",
  "sap-ase",
  "oracle",
  "sqlite",
  "mongodb"
] as const);

export type ProbeScaffoldEngine = (typeof PROBE_SCAFFOLD_ENGINES)[number];

export interface ProbeEngineTemplate {
  readonly title: string;
  readonly connectionClass: string;
  readonly port: string;
  readonly plan: string;
  readonly observation: string;
  readonly contractTypes: string;
  readonly stubImports: readonly string[];
  readonly stubMethods: string;
  readonly driverChoice: string;
  readonly driverPackages: string;
  readonly kitImports: readonly string[];
  readonly kitPlanExtras: string;
  readonly kitBounds: string;
  readonly kitChecks: string;
  readonly boundedStream: boolean;
  readonly target: "sql" | "document";
  readonly defaultTarget: string;
}

const SQL_OPERATION = (name: string) => `export interface ${name} {
  readonly kind: "select" | "introspect";
  readonly statementCount: 1;
  readonly protectedRequestRef: string;
  readonly objects: readonly { readonly schema: string; readonly name: string; readonly type: "table" | "catalog" }[];
  readonly functions: readonly string[];
  readonly parameterClassifications: readonly Classification[];
}`;

const CONTROL_PORT = (port: string, plan: string, observation: string) => `export interface ${port} {
  inspectPrincipal(plan: ${plan}): Promise<${observation}>;
  executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]>;
  stream(statement: string, parameters: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}`;

const BOUNDED_PORT_TAIL = `  stream(
    statement: string,
    parameters: readonly unknown[],
    signal: AbortSignal,
    maximumRows: number
  ): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}`;

const TIMEOUT_BOUNDS = "{ readonly timeoutMs: number }";
const ROW_BOUNDS = "{ readonly timeoutMs: number; readonly rowLimit: number }";

const PLAN = (name: string, operation: string, bounds: string, extra = "") => `export interface ${name} {
${extra}  readonly databaseId: string;
  readonly planDigest: string;
  readonly operation: ${operation};
  readonly bounds: ${bounds};
}`;

const methods = (...blocks: readonly string[]) => blocks.join("\n\n");

const PRINCIPAL_STUB = (
  plan: string,
  observation: string,
  todo: string
) => `  async inspectPrincipal(plan: ${plan}): Promise<${observation}> {
    void plan;
    // TODO(driver): ${todo}
    throw new ProbeDriverTodoError("inspectPrincipal");
  }`;

const CONTROL_STUB = (
  todo: string
) => `  async executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]> {
    void statement;
    void parameters;
    // TODO(driver): ${todo}
    throw new ProbeDriverTodoError("executeControl");
  }`;

const STREAM_STUB = (
  todo: string
) => `  stream(statement: string, parameters: readonly unknown[], signal: AbortSignal): AsyncIterable<UnknownRecord> {
    void statement;
    void parameters;
    void signal;
    // TODO(driver): ${todo}
    throw new ProbeDriverTodoError("stream");
  }`;

const BOUNDED_STREAM_STUB = (todo: string) => `  stream(
    statement: string,
    parameters: readonly unknown[],
    signal: AbortSignal,
    maximumRows: number
  ): AsyncIterable<UnknownRecord> {
    void statement;
    void parameters;
    void signal;
    void maximumRows;
    // TODO(driver): ${todo}
    throw new ProbeDriverTodoError("stream");
  }`;

const RELEASE_STUBS = (cancelTodo: string) => `  async cancel(): Promise<void> {
    // TODO(driver): ${cancelTodo}
    throw new ProbeDriverTodoError("cancel");
  }

  async terminate(): Promise<void> {
    // TODO(driver): close this connection and release every driver resource it holds.
    throw new ProbeDriverTodoError("terminate");
  }`;

const CONTROL_STUBS = (principal: string, cancelTodo: string) =>
  methods(principal, CONTROL_STUB(CONTROL_TODO), STREAM_STUB(STREAM_TODO), RELEASE_STUBS(cancelTodo));

const SQL_STREAM_CHECK = `function streamProbe(
  connection: CONNECTION_PORT,
  target: ConformanceTarget,
  signal: AbortSignal
): AsyncIterable<UnknownRecord> {
  return connection.stream(target.statement, target.parameters, signal);
}`;

const BOUNDED_STREAM_CHECK = `function streamProbe(
  connection: CONNECTION_PORT,
  target: ConformanceTarget,
  signal: AbortSignal,
  rowLimit: number
): AsyncIterable<UnknownRecord> {
  return connection.stream(target.statement, target.parameters, signal, rowLimit);
}`;

const CATALOG_TARGET = (statement: string, schema: string, name: string) => `{
  databaseId: "probe-target",
  kind: "introspect",
  statement: "${statement}",
  parameters: [],
  objects: [{ schema: "${schema}", name: "${name}", type: "catalog" }],
  functions: ["count"]
}`;

const STREAM_TODO =
  "run the statement with the bound parameters through a server-side cursor, yield each row as a plain object, and stop as soon as signal aborts.";
const BOUNDED_STREAM_TODO =
  "run the statement with the bound parameters, yield at most maximumRows rows as plain objects, and stop as soon as signal aborts.";
const CONTROL_TODO =
  "run the adapter's control statement on this connection's single session and return its rows as plain objects.";

function postgresql(): ProbeEngineTemplate {
  const port = "PostgreSqlConnectionPort";
  const plan = "PostgreSqlPlan";
  const observation = "PostgreSqlPrincipalObservation";
  return {
    title: "PostgreSQL",
    connectionClass: "PostgreSqlProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `${SQL_OPERATION("PostgreSqlReadOperation")}

${PLAN(plan, "PostgreSqlReadOperation", TIMEOUT_BOUNDS, "  readonly workspaceId: string;\n")}

export interface ${observation} {
  readonly databaseId: string;
  readonly principal: string;
  readonly superuser: boolean;
  readonly createRole: boolean;
  readonly createDatabase: boolean;
  readonly replication: boolean;
  readonly bypassRls: boolean;
  readonly writePrivilegeCount: number;
}

${CONTROL_PORT(port, plan, observation)}`,
    stubImports: [port, plan, observation],
    stubMethods: CONTROL_STUBS(
      PRINCIPAL_STUB(
        plan,
        observation,
        "read the connected role's real attributes (pg_roles: rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls) and count its INSERT, UPDATE, DELETE, and TRUNCATE privileges; never return a permissive default."
      ),
      "cancel the statement running on this session (for example with the driver's cancel request)."
    ),
    driverChoice: "PostgreSQL client",
    driverPackages: "`pg` (node-postgres) or `postgres` (Postgres.js)",
    kitImports: [port, plan],
    kitPlanExtras: '    workspaceId: "workspace_conformance-kit",\n',
    kitBounds: "{ timeoutMs: bounds.timeoutMs }",
    kitChecks: `async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  requireDatabase(observed.databaseId, plan);
  requireReadOnlyPrincipal(
    !observed.superuser &&
      !observed.createRole &&
      !observed.createDatabase &&
      !observed.replication &&
      !observed.bypassRls &&
      observed.writePrivilegeCount === 0
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  await connection.executeControl("BEGIN READ ONLY", []);
  await connection.executeControl("SET LOCAL statement_timeout = $1", [plan.bounds.timeoutMs]);
  await connection.executeControl("SET LOCAL lock_timeout = $1", [plan.bounds.timeoutMs]);
  const rows = await connection.executeControl("SHOW transaction_read_only", []);
  requireReadOnlySession(rows[0]?.["transaction_read_only"] === "on");
}

${SQL_STREAM_CHECK.replace("CONNECTION_PORT", port)}`,
    boundedStream: false,
    target: "sql",
    defaultTarget: CATALOG_TARGET("SELECT count(*) FROM information_schema.tables", "information_schema", "tables")
  };
}

function mysqlFamily(engine: "mysql" | "mariadb"): ProbeEngineTemplate {
  const port = "FamilyConnectionPort";
  const plan = "FamilyPlan";
  const observation = "MySqlFamilyPrincipalObservation";
  const mysql = engine === "mysql";
  const versionCheck = mysql
    ? `function versionSupported(version: string): boolean {
  const match = /^(\\d+)\\.\\d+\\.\\d+/u.exec(version);
  return match !== null && Number(match[1]) >= 8 && !/mariadb/iu.test(version);
}`
    : `function versionSupported(version: string): boolean {
  const match = /^(\\d+)\\.(\\d+)\\.\\d+/u.exec(version);
  if (match === null || !/mariadb/iu.test(version)) return false;
  const major = Number(match[1]);
  return major > 10 || (major === 10 && Number(match[2]) >= 2);
}`;
  const timeout = mysql
    ? 'await connection.executeControl("SET SESSION MAX_EXECUTION_TIME = ?", [plan.bounds.timeoutMs]);'
    : 'await connection.executeControl("SET SESSION max_statement_time = ?", [plan.bounds.timeoutMs / 1000]);';
  const readBack = mysql ? "SELECT @@transaction_read_only AS read_only" : "SELECT @@tx_read_only AS read_only";
  return {
    title: mysql ? "MySQL" : "MariaDB",
    connectionClass: mysql ? "MySqlProbeConnection" : "MariaDbProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `export type MySqlFamilyEngine = "mysql" | "mariadb";

${SQL_OPERATION("MySqlFamilyOperation")}

${PLAN(plan, "MySqlFamilyOperation", TIMEOUT_BOUNDS)}

export interface ${observation} {
  readonly engine: MySqlFamilyEngine;
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly databaseId: string;
  readonly principal: string;
  readonly writePrivilegeCount: number;
  readonly filePrivilege: boolean;
  readonly superPrivilege: boolean;
  readonly createUserPrivilege: boolean;
}

${CONTROL_PORT(port, plan, observation)}`,
    stubImports: [port, plan, observation],
    stubMethods: CONTROL_STUBS(
      PRINCIPAL_STUB(
        plan,
        observation,
        `report engine "${engine}", the server's real version string and capabilities ("cte", "read-only-transactions", "metadata"), and the connected account's real write, FILE, SUPER, and CREATE USER privileges; never return a permissive default.`
      ),
      "cancel the statement running on this session (for example with KILL QUERY from a separate connection)."
    ),
    driverChoice: mysql ? "MySQL client" : "MariaDB client",
    driverPackages: mysql ? "`mysql2`" : "`mariadb` (MariaDB Connector/Node.js) or `mysql2`",
    kitImports: [port, plan],
    kitPlanExtras: "",
    kitBounds: "{ timeoutMs: bounds.timeoutMs }",
    kitChecks: `${versionCheck}

async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  if (observed.engine !== "${engine}" || !versionSupported(observed.version)) {
    fail("VES_PROBE_KIT_VERSION_UNSUPPORTED", "The server version or engine identity is unsupported");
  }
  for (const capability of ["cte", "read-only-transactions", "metadata"]) {
    if (!observed.capabilities.includes(capability)) {
      fail("VES_PROBE_KIT_CAPABILITY_MISSING", "The server does not report a required capability");
    }
  }
  requireDatabase(observed.databaseId, plan);
  requireReadOnlyPrincipal(
    observed.writePrivilegeCount === 0 &&
      !observed.filePrivilege &&
      !observed.superPrivilege &&
      !observed.createUserPrivilege
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  await connection.executeControl("START TRANSACTION READ ONLY", []);
  ${timeout}
  const rows = await connection.executeControl("${readBack}", []);
  requireReadOnlySession(rows[0]?.["read_only"] === 1);
}

${SQL_STREAM_CHECK.replace("CONNECTION_PORT", port)}`,
    boundedStream: false,
    target: "sql",
    defaultTarget: CATALOG_TARGET("SELECT count(*) FROM information_schema.tables", "information_schema", "tables")
  };
}

function sqlserver(): ProbeEngineTemplate {
  const port = "SqlServerConnectionPort";
  const plan = "SqlServerConnectionPlan";
  const observation = "SqlServerObservation";
  return {
    title: "SQL Server",
    connectionClass: "SqlServerProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `${SQL_OPERATION("SqlServerOperation")}

export interface ${plan} {
  readonly databaseId: string;
  readonly planDigest: string;
  readonly bounds: ${TIMEOUT_BOUNDS};
  readonly operation: SqlServerOperation;
}

export interface ${observation} {
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

${CONTROL_PORT(port, plan, observation)}`,
    stubImports: [port, plan, observation],
    stubMethods: CONTROL_STUBS(
      PRINCIPAL_STUB(
        plan,
        observation,
        "report the login's real server and database role membership (sysadmin, securityadmin, db_owner, db_ddladmin, db_datawriter), its write permission count, and whether it holds IMPERSONATE; never return a permissive default."
      ),
      "cancel the request running on this session (for example with the driver's request cancel)."
    ),
    driverChoice: "SQL Server client",
    driverPackages: "`mssql` or `tedious`",
    kitImports: [port, plan],
    kitPlanExtras: "",
    kitBounds: "{ timeoutMs: bounds.timeoutMs }",
    kitChecks: `async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  requireDatabase(observed.databaseId, plan);
  requireReadOnlyPrincipal(
    !observed.sysadmin &&
      !observed.securityAdmin &&
      !observed.dbOwner &&
      !observed.dbDdlAdmin &&
      !observed.dbDataWriter &&
      observed.writePermissionCount === 0 &&
      !observed.impersonatePermission
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  await connection.executeControl("SET XACT_ABORT ON", []);
  await connection.executeControl("SET LOCK_TIMEOUT @p1", [plan.bounds.timeoutMs]);
  await connection.executeControl("SET TRANSACTION ISOLATION LEVEL SNAPSHOT", []);
  await connection.executeControl("BEGIN TRANSACTION", []);
  const rows = await connection.executeControl(
    "SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS can_write",
    []
  );
  requireReadOnlySession(rows[0]?.["can_write"] === 0);
}

${SQL_STREAM_CHECK.replace("CONNECTION_PORT", port)}`,
    boundedStream: false,
    target: "sql",
    defaultTarget: CATALOG_TARGET("SELECT count(*) FROM sys.tables", "sys", "tables")
  };
}

function sapAse(): ProbeEngineTemplate {
  const port = "SapAseConnectionPort";
  const plan = "SapAsePlan";
  const observation = "SapAsePrincipalObservation";
  return {
    title: "SAP ASE",
    connectionClass: "SapAseProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `${SQL_OPERATION("SapAseOperation")}

${PLAN(plan, "SapAseOperation", ROW_BOUNDS)}

export interface ${observation} {
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

${CONTROL_PORT(port, plan, observation)}`,
    stubImports: [port, plan, observation],
    stubMethods: CONTROL_STUBS(
      PRINCIPAL_STUB(
        plan,
        observation,
        'report product "sap-ase", the real server version, and the login\'s real roles (sa_role, sso_role, oper_role, replication_role, dtm_tm_role), database ownership, and write, DDL, execute, and proxy permissions; never return a permissive default.'
      ),
      "cancel the command running on this session (for example with the driver's cancel call)."
    ),
    driverChoice: "SAP ASE client",
    driverPackages: "`odbc` together with the SAP ASE ODBC driver installed on the host",
    kitImports: [port, plan],
    kitPlanExtras: "",
    kitBounds: "{ timeoutMs: bounds.timeoutMs, rowLimit: bounds.rowLimit }",
    kitChecks: `async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  requireProduct(observed.product, "sap-ase");
  requireDatabase(observed.databaseId, plan);
  requireReadOnlyPrincipal(
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
      !observed.proxyPermission
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  const lockWaitSeconds = Math.max(1, Math.ceil(plan.bounds.timeoutMs / 1000));
  await connection.executeControl("set chained off", []);
  await connection.executeControl(\`set lock wait \${lockWaitSeconds}\`, []);
  await connection.executeControl(\`set rowcount \${plan.bounds.rowLimit}\`, []);
  await connection.executeControl("begin transaction", []);
  const rows = await connection.executeControl(
    "select session_write_count, session_dangerous_role_count, session_execute_count",
    []
  );
  requireReadOnlySession(
    rows[0]?.["session_write_count"] === 0 &&
      rows[0]?.["session_dangerous_role_count"] === 0 &&
      rows[0]?.["session_execute_count"] === 0
  );
}

${SQL_STREAM_CHECK.replace("CONNECTION_PORT", port)}`,
    boundedStream: false,
    target: "sql",
    defaultTarget: CATALOG_TARGET("select count(*) from dbo.sysobjects", "dbo", "sysobjects")
  };
}

function oracle(): ProbeEngineTemplate {
  const port = "OracleConnectionPort";
  const plan = "OracleConnectionPlan";
  const observation = "OracleObservation";
  return {
    title: "Oracle",
    connectionClass: "OracleProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `${SQL_OPERATION("OracleOperation")}

${PLAN(plan, "OracleOperation", ROW_BOUNDS)}

export interface ${observation} {
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

export interface ${port} {
  inspectPrincipal(plan: ${plan}): Promise<${observation}>;
  executeControl(statement: string, parameters: readonly unknown[]): Promise<readonly UnknownRecord[]>;
${BOUNDED_PORT_TAIL}`,
    stubImports: [port, plan, observation],
    stubMethods: methods(
      PRINCIPAL_STUB(
        plan,
        observation,
        'report product "oracle", the real server version, the user\'s real administrative privileges (SYSDBA, SYSOPER, SYSASM, SYSBACKUP, SYSDG, SYSKM, the DBA role), its write system and object privilege counts, EXECUTE ANY PROCEDURE, and CREATE DATABASE LINK; never return a permissive default.'
      ),
      CONTROL_STUB(CONTROL_TODO),
      BOUNDED_STREAM_STUB(BOUNDED_STREAM_TODO),
      RELEASE_STUBS("cancel the call running on this connection (for example with the driver's break call).")
    ),
    driverChoice: "Oracle client",
    driverPackages: "`oracledb` (node-oracledb)",
    kitImports: [port, plan],
    kitPlanExtras: "",
    kitBounds: "{ timeoutMs: bounds.timeoutMs, rowLimit: bounds.rowLimit }",
    kitChecks: `async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  requireProduct(observed.product, "oracle");
  requireDatabase(observed.databaseId, plan);
  requireReadOnlyPrincipal(
    !observed.sysdba &&
      !observed.sysoper &&
      !observed.sysasm &&
      !observed.sysbackup &&
      !observed.sysdg &&
      !observed.syskm &&
      !observed.dbaRole &&
      observed.writeSystemPrivilegeCount === 0 &&
      observed.writeObjectPrivilegeCount === 0 &&
      !observed.executeAnyProcedure &&
      !observed.createDatabaseLink
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  // Oracle binds no separate session timeout, so the plan's bounds are not consulted here.
  void plan;
  await connection.executeControl("SET TRANSACTION READ ONLY", []);
  const rows = await connection.executeControl(
    "SELECT session_write_count, session_dangerous_role_count, transaction_read_only FROM dual",
    []
  );
  requireReadOnlySession(
    rows[0]?.["session_write_count"] === 0 &&
      rows[0]?.["session_dangerous_role_count"] === 0 &&
      rows[0]?.["transaction_read_only"] === 1
  );
}

${BOUNDED_STREAM_CHECK.replace("CONNECTION_PORT", port)}`,
    boundedStream: true,
    target: "sql",
    defaultTarget: CATALOG_TARGET("SELECT count(*) FROM all_tables", "oracle_catalog", "all_tables")
  };
}

function sqlite(): ProbeEngineTemplate {
  const port = "SqliteConnectionPort";
  const plan = "SqliteConnectionPlan";
  const observation = "SqliteObservation";
  return {
    title: "SQLite",
    connectionClass: "SqliteProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `export interface SqliteObject {
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

${PLAN(plan, "SqliteOperation", ROW_BOUNDS)}

export interface ${observation} {
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

export interface ${port} {
  inspectPrincipal(plan: ${plan}): Promise<${observation}>;
  configureAuthorization(operation: SqliteOperation): Promise<SqliteSessionObservation>;
${BOUNDED_PORT_TAIL}`,
    stubImports: [port, plan, observation, "SqliteOperation", "SqliteSessionObservation"],
    stubMethods: methods(
      PRINCIPAL_STUB(
        plan,
        observation,
        'report product "sqlite", the real library version, and how the database file was actually opened: read-only, defensive, extension loading off, PRAGMA query_only on, and exactly one attached database; never return a permissive default.'
      ),
      `  async configureAuthorization(operation: SqliteOperation): Promise<SqliteSessionObservation> {
    void operation;
    // TODO(driver): install an authorizer that allows reads of only the operation's objects and calls of only its functions, then read the session state back.
    throw new ProbeDriverTodoError("configureAuthorization");
  }`,
      BOUNDED_STREAM_STUB(BOUNDED_STREAM_TODO),
      RELEASE_STUBS("stop the statement this connection is iterating.")
    ),
    driverChoice: "SQLite binding",
    driverPackages: "the built-in `node:sqlite` module (no package needed) or `better-sqlite3`",
    kitImports: [port, plan],
    kitPlanExtras: "",
    kitBounds: "{ timeoutMs: bounds.timeoutMs, rowLimit: bounds.rowLimit }",
    kitChecks: `async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  requireProduct(observed.product, "sqlite");
  requireDatabase(observed.databaseId, plan);
  requireReadOnlyPrincipal(
    observed.readOnlyOpen &&
      observed.defensive &&
      !observed.extensionLoading &&
      observed.queryOnly &&
      observed.attachedDatabaseCount === 1
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.configureAuthorization(plan.operation);
  requireReadOnlySession(
    observed.queryOnly &&
      observed.defensive &&
      !observed.extensionLoading &&
      observed.authorizer &&
      observed.attachedDatabaseCount === 1
  );
}

${BOUNDED_STREAM_CHECK.replace("CONNECTION_PORT", port)}`,
    boundedStream: true,
    target: "sql",
    defaultTarget: CATALOG_TARGET("SELECT count(*) FROM main.sqlite_schema", "main", "sqlite_schema")
  };
}

function mongodb(): ProbeEngineTemplate {
  const port = "MongoDbConnectionPort";
  const plan = "MongoDbConnectionPlan";
  const observation = "MongoDbObservation";
  return {
    title: "MongoDB",
    connectionClass: "MongoDbProbeConnection",
    port,
    plan,
    observation,
    contractTypes: `${SQL_OPERATION("MongoDbOperation")}

${PLAN(plan, "MongoDbOperation", ROW_BOUNDS)}

export interface MongoDbRole {
  readonly role: string;
  readonly db: string;
}

export interface ${observation} {
  readonly product: string;
  readonly version: string;
  readonly databaseId: string;
  readonly authorizationEnabled: boolean;
  readonly roles: readonly MongoDbRole[];
  readonly writeActionCount: number;
  readonly adminActionCount: number;
  readonly serverExecutionActionCount: number;
}

export interface MongoDbSessionObservation {
  readonly typedReadSurface: boolean;
  readonly genericCommandDisabled: boolean;
  readonly readConcern: string;
  readonly maxTimeMS: number;
  readonly batchSize: number;
  readonly noCursorTimeout: boolean;
}

export interface ${port} {
  inspectPrincipal(plan: ${plan}): Promise<${observation}>;
  configureReadOnly(plan: ${plan}): Promise<MongoDbSessionObservation>;
  stream(command: UnknownRecord, signal: AbortSignal): AsyncIterable<UnknownRecord>;
  cancel(): Promise<void>;
  terminate(): Promise<void>;
}`,
    stubImports: [port, plan, observation, "MongoDbSessionObservation", "UnknownRecord"],
    stubMethods: methods(
      PRINCIPAL_STUB(
        plan,
        observation,
        'report product "mongodb", the real server version, whether authorization is enabled, the user\'s real roles, and its write, admin, and server-execution action counts from connectionStatus; never return a permissive default.'
      ),
      `  async configureReadOnly(plan: ${plan}): Promise<MongoDbSessionObservation> {
    void plan;
    // TODO(driver): configure the session's typed read surface (readConcern "majority", maxTimeMS and batchSize from plan.bounds, no noCursorTimeout, generic commands disabled) and report the controls actually applied.
    throw new ProbeDriverTodoError("configureReadOnly");
  }`,
      `  stream(command: UnknownRecord, signal: AbortSignal): AsyncIterable<UnknownRecord> {
    void command;
    void signal;
    // TODO(driver): run the typed read command (find, aggregate, explain, or introspect), yield each document as a plain object, and stop as soon as signal aborts.
    throw new ProbeDriverTodoError("stream");
  }`,
      RELEASE_STUBS("kill the cursor this session is iterating.")
    ),
    driverChoice: "MongoDB client",
    driverPackages: "`mongodb` (the official Node.js driver)",
    kitImports: [port, plan],
    kitPlanExtras: "",
    kitBounds: "{ timeoutMs: bounds.timeoutMs, rowLimit: bounds.rowLimit }",
    kitChecks: `async function verifyPrincipal(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.inspectPrincipal(plan);
  requireProduct(observed.product, "mongodb");
  requireDatabase(observed.databaseId, plan);
  const database = plan.operation.objects[0]?.schema;
  requireReadOnlyPrincipal(
    observed.authorizationEnabled &&
      observed.roles.length > 0 &&
      observed.roles.every((role) => role.role === "read" && role.db === database) &&
      observed.writeActionCount === 0 &&
      observed.adminActionCount === 0 &&
      observed.serverExecutionActionCount === 0
  );
}

async function configureSession(connection: ${port}, plan: ${plan}): Promise<void> {
  const observed = await connection.configureReadOnly(plan);
  requireReadOnlySession(
    observed.typedReadSurface &&
      observed.genericCommandDisabled &&
      observed.readConcern === "majority" &&
      observed.maxTimeMS === plan.bounds.timeoutMs &&
      observed.batchSize > 0 &&
      observed.batchSize <= plan.bounds.rowLimit &&
      !observed.noCursorTimeout
  );
}

function streamProbe(
  connection: ${port},
  target: ConformanceTarget,
  signal: AbortSignal
): AsyncIterable<UnknownRecord> {
  return connection.stream(target.command, signal);
}`,
    boundedStream: false,
    target: "document",
    defaultTarget: `{
  databaseId: "probe-target",
  kind: "introspect",
  command: { kind: "introspect", database: "app", collection: "collections_catalog" },
  objects: [{ schema: "app", name: "collections_catalog", type: "catalog" }],
  functions: []
}`
  };
}

export const PROBE_ENGINE_TEMPLATES: Readonly<Record<ProbeScaffoldEngine, ProbeEngineTemplate>> = Object.freeze({
  postgresql: postgresql(),
  mysql: mysqlFamily("mysql"),
  mariadb: mysqlFamily("mariadb"),
  sqlserver: sqlserver(),
  "sap-ase": sapAse(),
  oracle: oracle(),
  sqlite: sqlite(),
  mongodb: mongodb()
});
