import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PostgreSqlProbeAdapter,
  parsePostgreSqlReadOperation
} from "../../packages/data-probe/src/postgresql-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { postgresFixture } from "../helpers/postgresql-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const options = { kind: "select", protectedRequestRef: ref, parameterClassifications: [] };

test("normalizes a parameterized SELECT into the engine-neutral contract", () => {
  const operation = parsePostgreSqlReadOperation("SELECT count(*) FROM public.orders WHERE status = $1", {
    ...options,
    parameterClassifications: ["internal"]
  });
  assert.equal(operation.kind, "select");
  assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["count"]);
});

test("normalizes a read-only CTE and excludes its logical alias from objects", () => {
  const sql = "WITH recent AS (SELECT id FROM public.orders) SELECT count(*) FROM recent";
  const operation = parsePostgreSqlReadOperation(sql, options);
  assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
});

test("normalizes EXPLAIN FORMAT JSON over SELECT", () => {
  const operation = parsePostgreSqlReadOperation("EXPLAIN (FORMAT JSON) SELECT id FROM public.orders", options);
  assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
});

test("normalizes approved PostgreSQL catalog introspection", () => {
  const operation = parsePostgreSqlReadOperation("SELECT tablename FROM pg_catalog.pg_tables", {
    ...options,
    kind: "introspect"
  });
  assert.deepEqual(operation.objects, [{ schema: "pg_catalog", name: "pg_tables", type: "catalog" }]);
});

test("normalization contains no SQL or parameter values", () => {
  const operation = parsePostgreSqlReadOperation("SELECT id FROM public.orders WHERE status = $1", {
    ...options,
    parameterClassifications: ["internal"]
  });
  const serialized = JSON.stringify(operation);
  assert.equal(serialized.includes("SELECT"), false);
  assert.equal(serialized.includes("paid"), false);
});

test("adapter handshake exposes only read capability and exact component", async () => {
  const { worker } = await postgresFixture();
  const handshake = await worker.handshake();
  assert.deepEqual(handshake.capabilities, ["database-read"]);
  assert.deepEqual(handshake.component, PostgreSqlProbeAdapter.component);
});

test("adapter verifies a restricted principal", async () => {
  const { worker, plan } = await postgresFixture();
  const evidence = await worker.verifyIdentity(plan);
  assert.equal(evidence.principalReadOnly, true);
  assert.match(evidence.principalFingerprint, /^sha256:/u);
});

test("adapter configures a read-only transaction with exact timeout", async () => {
  const { worker, plan, connection } = await postgresFixture();
  const evidence = await worker.configureReadOnlySession(plan);
  assert.equal(evidence.sessionReadOnly, true);
  assert.deepEqual(connection.controlCalls, [
    ["BEGIN READ ONLY", []],
    ["SET LOCAL statement_timeout = $1", [2000]],
    ["SET LOCAL lock_timeout = $1", [2000]],
    ["SHOW transaction_read_only", []]
  ]);
});

test("adapter streams rows through the T41 supervisor", async () => {
  const { supervisor } = await postgresFixture({ connection: { rows: [{ id: 1 }, { id: 2 }] } });
  const result = await supervisor.execute();
  assert.equal(result.rowCount, 2);
  assert.equal(result.status, "complete");
});

test("adapter binds normalized protected request to the exact plan", async () => {
  const fixture = await postgresFixture();
  fixture.parameters.set(
    fixture.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        sql: "SELECT id FROM public.other WHERE status = $1",
        parameters: ["paid"]
      })
    )
  );
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_POSTGRES_PLAN_MISMATCH" });
});

test("adapter cancellation delegates to PostgreSQL connection cancellation", async () => {
  const { worker, connection } = await postgresFixture();
  await worker.cancel();
  assert.equal(connection.cancelled, true);
});

test("adapter termination closes the PostgreSQL connection", async () => {
  const { worker, connection } = await postgresFixture();
  await worker.terminate();
  assert.equal(connection.terminated, true);
});
