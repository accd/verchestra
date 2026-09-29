import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { MongoDbFixtureConnection, MongoDbProbeAdapter } from "../../packages/data-probe/src/mongodb-adapter.ts";
import {
  MariaDbProbeAdapter,
  MySqlFamilyFixtureConnection,
  MySqlProbeAdapter
} from "../../packages/data-probe/src/mysql-family-adapter.ts";
import { OracleFixtureConnection, OracleProbeAdapter } from "../../packages/data-probe/src/oracle-adapter.ts";
import {
  PostgreSqlFixtureConnection,
  PostgreSqlProbeAdapter
} from "../../packages/data-probe/src/postgresql-adapter.ts";
import { SapAseFixtureConnection, SapAseProbeAdapter } from "../../packages/data-probe/src/sap-ase-adapter.ts";
import {
  SqliteFixtureConnection,
  SqliteProbeAdapter,
  SqliteReadConnection
} from "../../packages/data-probe/src/sqlite-adapter.ts";
import { SqlServerFixtureConnection, SqlServerProbeAdapter } from "../../packages/data-probe/src/sqlserver-adapter.ts";
import { PROBE_DRIVER_TODO_CODE, PROBE_SCAFFOLD_ENGINES } from "../../packages/workspace/src/index.ts";
import { writeProbeScaffolds } from "../helpers/probe-scaffold-fixture.mjs";

// #234: the scaffold's vendored kit must reach the same verdict, through the
// same port calls, as the published adapter the product kit runs. Each engine
// row names the published fixture connection, the published adapter, and one
// fixture option set that makes the principal, and one that makes the session,
// not read-only. `record` reads what the fixture observed of the session setup.
const control = (connection) => connection.controlCalls;
const ENGINES = Object.freeze({
  postgresql: {
    connection: (options = {}) => new PostgreSqlFixtureConnection(options),
    adapter: (connection) => new PostgreSqlProbeAdapter({ connection }),
    principal: { superuser: true },
    session: { transactionReadOnly: "off" },
    record: control
  },
  mysql: {
    connection: (options = {}) => new MySqlFamilyFixtureConnection({ engine: "mysql", ...options }),
    adapter: (connection) => new MySqlProbeAdapter({ connection }),
    principal: { superPrivilege: true },
    session: { transactionReadOnly: false },
    wrongProduct: { engine: "mariadb" },
    wrongProductCode: "VES_PROBE_KIT_VERSION_UNSUPPORTED",
    record: control
  },
  mariadb: {
    connection: (options = {}) => new MySqlFamilyFixtureConnection({ engine: "mariadb", ...options }),
    adapter: (connection) => new MariaDbProbeAdapter({ connection }),
    principal: { filePrivilege: true },
    session: { transactionReadOnly: false },
    wrongProduct: { version: "10.1.48-MariaDB" },
    wrongProductCode: "VES_PROBE_KIT_VERSION_UNSUPPORTED",
    record: control
  },
  sqlserver: {
    connection: (options = {}) => new SqlServerFixtureConnection(options),
    adapter: (connection) => new SqlServerProbeAdapter({ connection }),
    principal: { sysadmin: true },
    session: { sessionCanWrite: true },
    record: control
  },
  "sap-ase": {
    connection: (options = {}) => new SapAseFixtureConnection(options),
    adapter: (connection) => new SapAseProbeAdapter({ connection }),
    principal: { saRole: true },
    session: { sessionWriteCount: 1 },
    wrongProduct: { product: "sybase-iq" },
    wrongProductCode: "VES_PROBE_KIT_PRODUCT_MISMATCH",
    record: control
  },
  oracle: {
    connection: (options = {}) => new OracleFixtureConnection(options),
    adapter: (connection) => new OracleProbeAdapter({ connection }),
    principal: { dbaRole: true },
    session: { transactionReadOnly: false },
    wrongProduct: { product: "mysql" },
    wrongProductCode: "VES_PROBE_KIT_PRODUCT_MISMATCH",
    record: control
  },
  sqlite: {
    connection: (options = {}) => new SqliteFixtureConnection(options),
    adapter: (connection) => new SqliteProbeAdapter({ connection }),
    principal: { extensionLoading: true },
    session: { sessionAuthorizer: false },
    wrongProduct: { product: "duckdb" },
    wrongProductCode: "VES_PROBE_KIT_PRODUCT_MISMATCH",
    record: (connection) => connection.authorizationConfigured
  },
  mongodb: {
    connection: (options = {}) => new MongoDbFixtureConnection(options),
    adapter: (connection) => new MongoDbProbeAdapter({ connection }),
    principal: { writeActionCount: 1 },
    session: { noCursorTimeout: true },
    wrongProduct: { product: "documentdb" },
    wrongProductCode: "VES_PROBE_KIT_PRODUCT_MISMATCH",
    record: (connection) => connection.controls
  }
});

function target(engine) {
  if (engine === "mongodb") {
    return {
      databaseId: "probe-target",
      kind: "select",
      command: { kind: "find", database: "sales", collection: "orders", filter: {}, projection: { _id: 1 }, sort: {} },
      objects: [{ schema: "sales", name: "orders", type: "table" }],
      functions: []
    };
  }
  return {
    databaseId: "probe-target",
    kind: "select",
    statement: "SELECT count(*) FROM sales.orders WHERE status = $1",
    parameters: ["paid"],
    objects: [{ schema: "sales", name: "orders", type: "table" }],
    functions: ["count"]
  };
}

const rejectsWith = (code) => (error) => {
  assert.equal(error.code, code);
  return true;
};

let scaffolds;
before(async () => {
  scaffolds = await writeProbeScaffolds();
});
after(async () => {
  await scaffolds?.cleanup();
});

test("every scaffold engine has a published fixture and adapter row", () => {
  assert.deepEqual(Object.keys(ENGINES), [...PROBE_SCAFFOLD_ENGINES]);
});

for (const [engine, row] of Object.entries(ENGINES)) {
  test(`${engine}: the kit run against the generated connection fails with the TODO(driver) code`, async () => {
    const { kit, connection } = await scaffolds.load(engine);
    const [, GeneratedConnection] = Object.entries(connection).find(([name]) => name.endsWith("ProbeConnection"));
    await assert.rejects(kit.runConformanceKit(new GeneratedConnection(), target(engine)), (error) => {
      assert.equal(error.code, PROBE_DRIVER_TODO_CODE);
      assert.equal(error.method, "inspectPrincipal");
      assert.equal(error instanceof connection.ProbeDriverTodoError, true);
      return true;
    });
  });

  test(`${engine}: a conforming published connection passes and is released`, async () => {
    const { kit } = await scaffolds.load(engine);
    const fixture = row.connection();
    const report = await kit.runConformanceKit(fixture, target(engine));
    assert.deepEqual(report, { engine, contractVersion: 1, rowCount: 1 });
    assert.equal(fixture.cancelled, true);
    assert.equal(fixture.terminated, true);
  });

  test(`${engine}: the kit drives the session exactly as the published adapter does`, async () => {
    const { kit } = await scaffolds.load(engine);
    const viaKit = row.connection();
    await kit.runConformanceKit(viaKit, target(engine));
    const viaAdapter = row.connection();
    const adapter = row.adapter(viaAdapter);
    const plan = kit.conformancePlan(target(engine), kit.DEFAULT_CONFORMANCE_BOUNDS);
    const identity = await adapter.verifyIdentity(plan);
    const session = await adapter.configureReadOnlySession(plan);
    assert.equal(identity.principalReadOnly, true);
    assert.equal(session.sessionReadOnly, true);
    assert.ok(row.record(viaAdapter));
    assert.deepEqual(row.record(viaKit), row.record(viaAdapter));
  });

  test(`${engine}: a principal the adapter rejects fails the kit and the connection is still released`, async () => {
    const { kit } = await scaffolds.load(engine);
    const plan = kit.conformancePlan(target(engine), kit.DEFAULT_CONFORMANCE_BOUNDS);
    const identity = await row.adapter(row.connection(row.principal)).verifyIdentity(plan);
    assert.equal(identity.principalReadOnly, false);
    const fixture = row.connection(row.principal);
    await assert.rejects(
      kit.runConformanceKit(fixture, target(engine)),
      rejectsWith("VES_PROBE_KIT_PRINCIPAL_NOT_READ_ONLY")
    );
    assert.equal(fixture.terminated, true);
    assert.equal(fixture.streamCalls, 0);
  });

  test(`${engine}: a session the adapter rejects fails the kit before any row streams`, async () => {
    const { kit } = await scaffolds.load(engine);
    const plan = kit.conformancePlan(target(engine), kit.DEFAULT_CONFORMANCE_BOUNDS);
    const session = await row.adapter(row.connection(row.session)).configureReadOnlySession(plan);
    assert.equal(session.sessionReadOnly, false);
    const fixture = row.connection(row.session);
    await assert.rejects(
      kit.runConformanceKit(fixture, target(engine)),
      rejectsWith("VES_PROBE_KIT_SESSION_NOT_READ_ONLY")
    );
    assert.equal(fixture.streamCalls, 0);
  });

  test(`${engine}: identity, row shape, and row limit violations each fail with their own code`, async () => {
    const { kit } = await scaffolds.load(engine);
    await assert.rejects(
      kit.runConformanceKit(row.connection({ databaseId: "another-database" }), target(engine)),
      rejectsWith("VES_PROBE_KIT_IDENTITY_MISMATCH")
    );
    await assert.rejects(
      kit.runConformanceKit(row.connection({ rows: [[1]] }), target(engine)),
      rejectsWith("VES_PROBE_KIT_ROW_INVALID")
    );
    await assert.rejects(
      kit.runConformanceKit(row.connection({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }] }), {
        ...target(engine),
        bounds: { timeoutMs: 1_000, rowLimit: 2 }
      }),
      rejectsWith("VES_PROBE_KIT_ROW_LIMIT_EXCEEDED")
    );
    if (row.wrongProduct !== undefined) {
      await assert.rejects(
        kit.runConformanceKit(row.connection(row.wrongProduct), target(engine)),
        rejectsWith(row.wrongProductCode)
      );
    }
  });

  test(`${engine}: node --test on the generated test file exits non-zero with the TODO(driver) code`, () => {
    // why: an inherited NODE_TEST_CONTEXT turns the child into a subtest
    // reporter of this runner, which always exits 0; the team's CI has none.
    const { NODE_TEST_CONTEXT, ...environment } = process.env;
    void NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ["--test", "conformance.test.mts"], {
      cwd: scaffolds.directory(engine),
      encoding: "utf8",
      env: { ...environment, NO_COLOR: "1" }
    });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /pass 0/u);
    assert.match(result.stdout, /fail 1/u);
    assert.ok(result.stdout.includes(PROBE_DRIVER_TODO_CODE), result.stdout);
  });
}

test("sqlite: the generated kit passes against the published node:sqlite connection on a real file", async () => {
  const { kit } = await scaffolds.load("sqlite");
  const directory = await mkdtemp(join(tmpdir(), "verchestra-probe-scaffold-sqlite-"));
  const path = join(directory, "orders.sqlite");
  const setup = new DatabaseSync(path);
  setup.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT NOT NULL)");
  setup.close();
  const connection = new SqliteReadConnection({ databaseId: "probe-target", path });
  try {
    const report = await kit.runConformanceKit(connection, {
      databaseId: "probe-target",
      kind: "introspect",
      statement: "SELECT count(*) FROM main.sqlite_schema",
      parameters: [],
      objects: [{ schema: "main", name: "sqlite_schema", type: "catalog" }],
      functions: ["count"]
    });
    assert.deepEqual(report, { engine: "sqlite", contractVersion: 1, rowCount: 1 });
  } finally {
    connection.close();
    await rm(directory, { recursive: true, force: true });
  }
});
