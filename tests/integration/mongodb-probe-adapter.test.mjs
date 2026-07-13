import assert from "node:assert/strict";
import { test } from "node:test";
import { findCommand, mongoDbFixture } from "../helpers/mongodb-probe-fixture.mjs";

test("MongoDB aggregate executes only the approved bounded pipeline", async () => {
  const f = await mongoDbFixture({
    command: {
      kind: "aggregate",
      database: "sales",
      collection: "orders",
      pipeline: [{ $match: { status: { $eq: { $param: 0 } } } }, { $limit: 10 }]
    }
  });
  await f.supervisor.execute();
  assert.equal(f.connection.lastCommand.pipeline[0].$match.status.$eq, "paid");
});
test("MongoDB explain executes queryPlanner only", async () => {
  const f = await mongoDbFixture({ command: { ...findCommand(), kind: "explain", verbosity: "queryPlanner" } });
  await f.supervisor.execute();
  assert.equal(f.connection.lastCommand.verbosity, "queryPlanner");
});
test("MongoDB introspection executes the closed collection catalog operation", async () => {
  const f = await mongoDbFixture({
    command: { kind: "introspect", database: "sales", collection: "collections_catalog" }
  });
  await f.supervisor.execute();
  assert.equal(f.connection.lastCommand.collection, "collections_catalog");
});

for (const [label, connection] of [
  ["compatible product", { product: "documentdb" }],
  ["foreign database identity", { databaseId: "other" }],
  ["authorization disabled", { authorizationEnabled: false }],
  ["readWrite role", { roles: [{ role: "readWrite", db: "sales" }] }],
  ["readAnyDatabase role", { roles: [{ role: "readAnyDatabase", db: "admin" }] }],
  ["foreign read role", { roles: [{ role: "read", db: "other" }] }],
  ["effective write action", { writeActionCount: 1 }],
  ["effective admin action", { adminActionCount: 1 }],
  ["server execution action", { serverExecutionActionCount: 1 }]
])
  test(`MongoDB denies ${label}`, async () => {
    const f = await mongoDbFixture({ connection });
    const code = label.includes("product")
      ? "VES_MONGODB_PRODUCT_INVALID"
      : label.includes("database identity")
        ? "VES_PROBE_IDENTITY_INVALID"
        : "VES_PROBE_IDENTITY_NOT_READ_ONLY";
    await assert.rejects(f.supervisor.execute(), { code });
    assert.equal(f.connection.streamCalls, 0);
  });

test("MongoDB generic command surface blocks session execution", async () => {
  const f = await mongoDbFixture({ connection: { genericCommandDisabled: false } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
});
test("MongoDB timeout kills cursor without promotion", async () => {
  const f = await mongoDbFixture({
    bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { delayMs: 100 }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(f.connection.cancelled, true);
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("MongoDB row limit rolls back without promotion", async () => {
  const f = await mongoDbFixture({
    bounds: { timeoutMs: 2000, rowLimit: 1, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { rows: [{ id: 1 }, { id: 2 }] }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_ROW_LIMIT" });
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("MongoDB byte limit rolls back without promotion", async () => {
  const f = await mongoDbFixture({
    bounds: { timeoutMs: 2000, rowLimit: 100, byteLimit: 1, concurrencyLimit: 1 },
    connection: { rows: [{ payload: "large" }] }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_BYTE_LIMIT" });
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("MongoDB protected values reach only typed execution", async () => {
  const f = await mongoDbFixture({ parameters: ["paid"] });
  await f.supervisor.execute();
  assert.equal(f.connection.lastCommand.filter.status.$eq, "paid");
  assert.equal(JSON.stringify(f.plan).includes("paid"), false);
});
