import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import {
  SqliteFixtureConnection,
  SqliteProbeAdapter,
  SqliteReadConnection,
  parseSqliteReadOperation
} from "../../packages/data-probe/src/sqlite-adapter.ts";
import {
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { policy, registration, request } from "./database-probe-fixture.mjs";

export async function sqliteFixture(options = {}) {
  const sql = options.sql ?? "SELECT count(*) FROM main.orders WHERE status = ?";
  const classifications = options.parameterClassifications ?? ["internal"];
  const protectedRequestRef = request().operation.protectedRequestRef;
  const operation = parseSqliteReadOperation(sql, {
    kind: options.kind ?? "select",
    protectedRequestRef,
    parameterClassifications: classifications
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration({ engine: "sqlite", approvedSchemas: ["main"] }));
  const planner = new ProbePlanner({
    registry,
    adapters: [{ engine: "sqlite", validateNormalizedOperation: () => [] }]
  });
  const plan = await planner.plan(
    request({ operation, bounds: options.bounds ?? request().bounds }),
    policy({
      allowedObjects: ["main.orders", "main.sqlite_schema"],
      allowCatalogAccess: (options.kind ?? "select") === "introspect",
      ...options.policy
    })
  );
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(
    protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        sql,
        parameters: options.parameters ?? (classifications.length ? ["paid"] : [])
      })
    )
  );
  const results = new MemoryProbeResultSink();
  const connection = options.realConnection ?? new SqliteFixtureConnection(options.connection);
  const worker = new SqliteProbeAdapter({ connection });
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: SqliteProbeAdapter.component,
    maximumMessageBytes: 65_536
  });
  return { operation, plan, parameters, results, connection, worker, supervisor };
}

export async function realSqliteFixture(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-sqlite-probe-"));
  const path = join(directory, "orders.sqlite");
  const setup = new DatabaseSync(path, { defensive: true });
  setup.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT NOT NULL, amount INTEGER NOT NULL)");
  setup.prepare("INSERT INTO orders(status, amount) VALUES (?, ?)").run("paid", 50);
  setup.prepare("INSERT INTO orders(status, amount) VALUES (?, ?)").run("pending", 25);
  setup.close();
  const before = await readFile(path);
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const connection = new SqliteReadConnection({ databaseId: "orders-production", path });
  const fixture = await sqliteFixture({ ...options, realConnection: connection });
  return {
    ...fixture,
    path,
    before,
    beforeDigest: digest(before),
    async after() {
      connection.close();
      const bytes = await readFile(path);
      return { bytes, digest: digest(bytes) };
    },
    async cleanup() {
      connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  };
}
