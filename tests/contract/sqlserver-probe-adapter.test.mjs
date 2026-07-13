import assert from "node:assert/strict";
import { test } from "node:test";

import { SqlServerProbeAdapter, parseSqlServerReadOperation } from "../../packages/data-probe/src/sqlserver-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { sqlServerFixture } from "../helpers/sqlserver-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const parse = (sql, classifications = [], kind = "select") =>
  parseSqlServerReadOperation(sql, {
    kind,
    protectedRequestRef: ref,
    parameterClassifications: classifications
  });

test("SQL Server normalizes a parameterized SELECT without protected values", () => {
  const operation = parse("SELECT count(*) FROM public.orders WHERE status = @p1", ["internal"]);
  assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["count"]);
  assert.equal(JSON.stringify(operation).includes("paid"), false);
  assert.equal(JSON.stringify(operation).includes("SELECT"), false);
});

test("SQL Server normalizes a read-only CTE without treating its alias as an object", () => {
  const operation = parse("WITH recent AS (SELECT id FROM public.orders) SELECT count(*) FROM recent");
  assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
});

test("SQL Server permits only an approved catalog during introspection", () => {
  const operation = parse("SELECT name FROM sys.tables", [], "introspect");
  assert.deepEqual(operation.objects, [{ schema: "sys", name: "tables", type: "catalog" }]);
});

test("SQL Server handshake binds the exact read-only worker component", async () => {
  const fixture = await sqlServerFixture();
  const handshake = await fixture.worker.handshake();
  assert.deepEqual(handshake.component, SqlServerProbeAdapter.component);
  assert.deepEqual(handshake.capabilities, ["database-read"]);
});

test("SQL Server verifies a restricted login and database principal", async () => {
  const fixture = await sqlServerFixture();
  const evidence = await fixture.worker.verifyIdentity(fixture.plan);
  assert.equal(evidence.principalReadOnly, true);
  assert.match(evidence.principalFingerprint, /^sha256:/u);
});

test("SQL Server configures exact session controls and rechecks write permission", async () => {
  const fixture = await sqlServerFixture();
  const evidence = await fixture.worker.configureReadOnlySession(fixture.plan);
  assert.deepEqual([evidence.sessionReadOnly, evidence.transactionReadOnly], [true, true]);
  assert.deepEqual(fixture.connection.controlCalls, [
    ["SET XACT_ABORT ON", []],
    ["SET LOCK_TIMEOUT @p1", [2000]],
    ["SET TRANSACTION ISOLATION LEVEL SNAPSHOT", []],
    ["BEGIN TRANSACTION", []],
    ["SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS can_write", []]
  ]);
});

test("SQL Server streams protected rows through the common bounded supervisor", async () => {
  const fixture = await sqlServerFixture({ connection: { rows: [{ id: 1 }, { id: 2 }] } });
  const result = await fixture.supervisor.execute();
  assert.deepEqual([result.status, result.rowCount], ["complete", 2]);
});

test("SQL Server rejects a protected request that differs from the approved plan", async () => {
  const fixture = await sqlServerFixture();
  fixture.parameters.set(
    fixture.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, sql: "SELECT id FROM public.other WHERE status = @p1", parameters: ["paid"] })
    )
  );
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_SQLSERVER_PLAN_MISMATCH" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SQL Server rejects protected parameter cardinality before connection streaming", async () => {
  const fixture = await sqlServerFixture();
  fixture.parameters.set(
    fixture.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, sql: "SELECT count(*) FROM public.orders WHERE status = @p1", parameters: [] })
    )
  );
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_SQLSERVER_PARAMETERS_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SQL Server cancellation and termination delegate to the connection", async () => {
  const fixture = await sqlServerFixture();
  await fixture.worker.cancel();
  await fixture.worker.terminate();
  assert.deepEqual([fixture.connection.cancelled, fixture.connection.terminated], [true, true]);
});
