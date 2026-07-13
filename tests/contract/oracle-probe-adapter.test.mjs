import assert from "node:assert/strict";
import { test } from "node:test";
import { OracleProbeAdapter, parseOracleReadOperation } from "../../packages/data-probe/src/oracle-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { oracleFixture } from "../helpers/oracle-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const parse = (sql, classifications = [], kind = "select") =>
  parseOracleReadOperation(sql, { kind, protectedRequestRef: ref, parameterClassifications: classifications });

test("Oracle normalizes a bound SELECT without SQL or values", () => {
  const operation = parse("SELECT count(*) FROM hr.orders WHERE status = :p1", ["internal"]);
  assert.deepEqual(operation.objects, [{ schema: "hr", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["count"]);
  assert.equal(JSON.stringify(operation).includes("FROM hr.orders"), false);
  assert.equal(JSON.stringify(operation).includes("paid"), false);
});
test("Oracle normalizes a read-only CTE", () =>
  assert.deepEqual(parse("WITH recent AS (SELECT id FROM hr.orders) SELECT count(*) FROM recent").objects, [
    { schema: "hr", name: "orders", type: "table" }
  ]));
test("Oracle permits approved ALL catalog introspection", () =>
  assert.deepEqual(parse("SELECT table_name FROM all_tables", [], "introspect").objects, [
    { schema: "oracle_catalog", name: "all_tables", type: "catalog" }
  ]));
test("Oracle handshake binds exact component and read capability", async () => {
  const f = await oracleFixture();
  const h = await f.worker.handshake();
  assert.deepEqual(h.component, OracleProbeAdapter.component);
  assert.deepEqual(h.capabilities, ["database-read"]);
});
test("Oracle verifies a restricted database user", async () => {
  const f = await oracleFixture();
  const e = await f.worker.verifyIdentity(f.plan);
  assert.equal(e.principalReadOnly, true);
  assert.equal(e.product, "oracle");
  assert.match(e.principalFingerprint, /^sha256:/u);
});
test("Oracle begins an exact read-only transaction", async () => {
  const f = await oracleFixture();
  const e = await f.worker.configureReadOnlySession(f.plan);
  assert.deepEqual([e.sessionReadOnly, e.transactionReadOnly], [true, true]);
  assert.deepEqual(
    f.connection.controlCalls.map(([sql]) => sql),
    [
      "SET TRANSACTION READ ONLY",
      "SELECT session_write_count, session_dangerous_role_count, transaction_read_only FROM dual"
    ]
  );
});
test("Oracle streams rows with a driver row limit through T41", async () => {
  const f = await oracleFixture({ connection: { rows: [{ id: 1 }, { id: 2 }] } });
  const r = await f.supervisor.execute();
  assert.deepEqual([r.status, r.rowCount, f.connection.lastMaximumRows], ["complete", 2, 100]);
});
test("Oracle rejects protected SQL that differs from the plan", async () => {
  const f = await oracleFixture();
  f.parameters.set(
    f.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, sql: "SELECT id FROM hr.other WHERE status = :p1", parameters: ["paid"] })
    )
  );
  await assert.rejects(f.supervisor.execute(), { code: "VES_ORACLE_PLAN_MISMATCH" });
  assert.equal(f.connection.streamCalls, 0);
});
test("Oracle rejects protected bind cardinality before streaming", async () => {
  const f = await oracleFixture();
  f.parameters.set(
    f.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, sql: "SELECT count(*) FROM hr.orders WHERE status = :p1", parameters: [] })
    )
  );
  await assert.rejects(f.supervisor.execute(), { code: "VES_ORACLE_PARAMETERS_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
test("Oracle cancellation and termination delegate", async () => {
  const f = await oracleFixture();
  await f.worker.cancel();
  await f.worker.terminate();
  assert.deepEqual([f.connection.cancelled, f.connection.terminated], [true, true]);
});
