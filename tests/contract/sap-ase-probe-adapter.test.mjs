import assert from "node:assert/strict";
import { test } from "node:test";

import { SapAseProbeAdapter, parseSapAseReadOperation } from "../../packages/data-probe/src/sap-ase-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { sapAseFixture } from "../helpers/sap-ase-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const parse = (sql, classifications = [], kind = "select") =>
  parseSapAseReadOperation(sql, {
    kind,
    protectedRequestRef: ref,
    parameterClassifications: classifications
  });

test("SAP ASE normalizes a prepared SELECT without SQL or values in the operation", () => {
  const operation = parse("select count(*) from dbo.orders where status = ?", ["internal"]);
  assert.deepEqual(operation.objects, [{ schema: "dbo", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["count"]);
  assert.equal(JSON.stringify(operation).includes("select count(*) from dbo.orders"), false);
  assert.equal(JSON.stringify(operation).includes("from dbo.orders"), false);
  assert.equal(JSON.stringify(operation).includes("paid"), false);
});

test("SAP ASE normalizes a derived-table read without inventing an object", () => {
  const operation = parse("select count(*) from (select id from dbo.orders) recent");
  assert.deepEqual(operation.objects, [{ schema: "dbo", name: "orders", type: "table" }]);
});

test("SAP ASE permits only an approved local catalog for introspection", () => {
  const operation = parse("select name from dbo.sysobjects", [], "introspect");
  assert.deepEqual(operation.objects, [{ schema: "dbo", name: "sysobjects", type: "catalog" }]);
});

test("SAP ASE handshake identifies an exact SAP ASE read worker", async () => {
  const fixture = await sapAseFixture();
  const handshake = await fixture.worker.handshake();
  assert.deepEqual(handshake.component, SapAseProbeAdapter.component);
  assert.deepEqual(handshake.capabilities, ["database-read"]);
});

test("SAP ASE verifies restricted login, database user, roles, and grants", async () => {
  const fixture = await sapAseFixture();
  const evidence = await fixture.worker.verifyIdentity(fixture.plan);
  assert.equal(evidence.principalReadOnly, true);
  assert.equal(evidence.product, "sap-ase");
  assert.match(evidence.principalFingerprint, /^sha256:/u);
});

test("SAP ASE configures deterministic transaction, lock, and row bounds", async () => {
  const fixture = await sapAseFixture();
  const evidence = await fixture.worker.configureReadOnlySession(fixture.plan);
  assert.deepEqual([evidence.sessionReadOnly, evidence.transactionReadOnly], [true, true]);
  assert.deepEqual(fixture.connection.controlCalls, [
    ["set chained off", []],
    ["set lock wait 2", []],
    ["set rowcount 100", []],
    ["begin transaction", []],
    ["select session_write_count, session_dangerous_role_count, session_execute_count", []]
  ]);
});

test("SAP ASE streams protected rows through the common Probe supervisor", async () => {
  const fixture = await sapAseFixture({ connection: { rows: [{ id: 1 }, { id: 2 }] } });
  const result = await fixture.supervisor.execute();
  assert.deepEqual([result.status, result.rowCount], ["complete", 2]);
});

test("SAP ASE rejects protected SQL that differs from the approved plan", async () => {
  const fixture = await sapAseFixture();
  fixture.parameters.set(
    fixture.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, sql: "select id from dbo.other where status = ?", parameters: ["paid"] })
    )
  );
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_SAP_ASE_PLAN_MISMATCH" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE rejects protected parameter cardinality before streaming", async () => {
  const fixture = await sapAseFixture();
  fixture.parameters.set(
    fixture.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, sql: "select count(*) from dbo.orders where status = ?", parameters: [] })
    )
  );
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_SAP_ASE_PARAMETERS_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE cancellation and termination delegate to the connection", async () => {
  const fixture = await sapAseFixture();
  await fixture.worker.cancel();
  await fixture.worker.terminate();
  assert.deepEqual([fixture.connection.cancelled, fixture.connection.terminated], [true, true]);
});
