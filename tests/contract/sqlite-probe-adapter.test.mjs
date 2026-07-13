import assert from "node:assert/strict";
import { test } from "node:test";
import { SqliteProbeAdapter, parseSqliteReadOperation } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { sqliteFixture } from "../helpers/sqlite-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const parse = (sql, classifications = [], kind = "select") =>
  parseSqliteReadOperation(sql, { kind, protectedRequestRef: ref, parameterClassifications: classifications });

test("SQLite normalizes a bound SELECT without SQL or values", () => {
  const operation = parse("SELECT count(*) FROM main.orders WHERE status = ?", ["internal"]);
  assert.deepEqual(operation.objects, [{ schema: "main", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["count"]);
  assert.equal(JSON.stringify(operation).includes("FROM main.orders"), false);
  assert.equal(JSON.stringify(operation).includes("paid"), false);
});
test("SQLite normalizes a read-only CTE", () =>
  assert.deepEqual(parse("WITH recent AS (SELECT id FROM main.orders) SELECT count(*) FROM recent").objects, [
    { schema: "main", name: "orders", type: "table" }
  ]));
test("SQLite permits sqlite_schema only for introspection", () =>
  assert.deepEqual(parse("SELECT name FROM main.sqlite_schema", [], "introspect").objects, [
    { schema: "main", name: "sqlite_schema", type: "catalog" }
  ]));
test("SQLite handshake binds exact component and read capability", async () => {
  const f = await sqliteFixture();
  const h = await f.worker.handshake();
  assert.deepEqual(h.component, SqliteProbeAdapter.component);
  assert.deepEqual(h.capabilities, ["database-read"]);
});
test("SQLite verifies immutable read-only open evidence", async () => {
  const f = await sqliteFixture();
  const e = await f.worker.verifyIdentity(f.plan);
  assert.equal(e.principalReadOnly, true);
  assert.equal(e.product, "sqlite");
  assert.match(e.principalFingerprint, /^sha256:/u);
});
test("SQLite enables query-only and authorizer controls", async () => {
  const f = await sqliteFixture();
  const e = await f.worker.configureReadOnlySession(f.plan);
  assert.deepEqual([e.sessionReadOnly, e.transactionReadOnly], [true, true]);
  assert.equal(f.connection.authorizationConfigured, true);
});
test("SQLite streams rows through T41", async () => {
  const f = await sqliteFixture({ connection: { rows: [{ id: 1 }, { id: 2 }] } });
  const r = await f.supervisor.execute();
  assert.deepEqual([r.status, r.rowCount], ["complete", 2]);
});
test("SQLite rejects protected SQL that differs from the plan", async () => {
  const f = await sqliteFixture();
  f.parameters.set(
    f.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        sql: "SELECT id FROM main.other WHERE status = ?",
        parameters: ["paid"]
      })
    )
  );
  await assert.rejects(f.supervisor.execute(), { code: "VES_SQLITE_PLAN_MISMATCH" });
  assert.equal(f.connection.streamCalls, 0);
});
test("SQLite rejects protected bind cardinality before execution", async () => {
  const f = await sqliteFixture();
  f.parameters.set(
    f.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        sql: "SELECT count(*) FROM main.orders WHERE status = ?",
        parameters: []
      })
    )
  );
  await assert.rejects(f.supervisor.execute(), { code: "VES_SQLITE_PARAMETERS_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
test("SQLite cancellation and termination delegate", async () => {
  const f = await sqliteFixture();
  await f.worker.cancel();
  await f.worker.terminate();
  assert.deepEqual([f.connection.cancelled, f.connection.terminated], [true, true]);
});
