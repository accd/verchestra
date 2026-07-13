import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMySqlFamilyReadOperation } from "../../packages/data-probe/src/mysql-family-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { mysqlFamilyFixture } from "../helpers/mysql-family-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;

for (const engine of ["mysql", "mariadb"]) {
  const parse = (sql, classifications = [], kind = "select") =>
    parseMySqlFamilyReadOperation(sql, {
      engine,
      kind,
      protectedRequestRef: ref,
      parameterClassifications: classifications
    });

  test(`${engine}: normalizes parameterized SELECT`, () => {
    const operation = parse("SELECT count(*) FROM public.orders WHERE status = ?", ["internal"]);
    assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
    assert.deepEqual(operation.functions, ["count"]);
  });

  test(`${engine}: normalizes read-only CTE`, () => {
    const operation = parse("WITH recent AS (SELECT id FROM public.orders) SELECT count(*) FROM recent");
    assert.deepEqual(operation.objects, [{ schema: "public", name: "orders", type: "table" }]);
  });

  test(`${engine}: normalizes safe metadata introspection`, () => {
    const operation = parse("SELECT table_name FROM information_schema.tables", [], "introspect");
    assert.deepEqual(operation.objects, [{ schema: "information_schema", name: "tables", type: "catalog" }]);
  });

  test(`${engine}: normalized operation contains no SQL or values`, () => {
    const serialized = JSON.stringify(parse("SELECT id FROM public.orders WHERE status = ?", ["internal"]));
    assert.equal(serialized.includes("SELECT"), false);
    assert.equal(serialized.includes("paid"), false);
  });

  test(`${engine}: handshake binds distinct component and read capability`, async () => {
    const fixture = await mysqlFamilyFixture(engine);
    const handshake = await fixture.worker.handshake();
    assert.deepEqual(handshake.component, fixture.Adapter.component);
    assert.deepEqual(handshake.capabilities, ["database-read"]);
  });

  test(`${engine}: verifies restricted principal with engine/version evidence`, async () => {
    const fixture = await mysqlFamilyFixture(engine);
    const evidence = await fixture.worker.verifyIdentity(fixture.plan);
    assert.equal(evidence.principalReadOnly, true);
    assert.equal(evidence.engine, engine);
    assert.match(evidence.version, /^\d+\.\d+\.\d+/u);
  });

  test(`${engine}: configures its exact read-only session controls`, async () => {
    const fixture = await mysqlFamilyFixture(engine);
    assert.equal((await fixture.worker.configureReadOnlySession(fixture.plan)).sessionReadOnly, true);
    assert.equal(fixture.connection.controlCalls[0][0], "START TRANSACTION READ ONLY");
    assert.match(
      fixture.connection.controlCalls[1][0],
      engine === "mysql" ? /MAX_EXECUTION_TIME/u : /max_statement_time/u
    );
  });

  test(`${engine}: streams through the common bounded supervisor`, async () => {
    const fixture = await mysqlFamilyFixture(engine, { connection: { rows: [{ id: 1 }, { id: 2 }] } });
    assert.equal((await fixture.supervisor.execute()).rowCount, 2);
  });

  test(`${engine}: protected request must match exact approved plan`, async () => {
    const fixture = await mysqlFamilyFixture(engine);
    fixture.parameters.set(
      fixture.plan.operation.protectedRequestRef,
      new TextEncoder().encode(
        JSON.stringify({ schemaVersion: 1, sql: "SELECT id FROM public.other WHERE status = ?", parameters: ["paid"] })
      )
    );
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_MYSQL_FAMILY_PLAN_MISMATCH" });
  });
}
