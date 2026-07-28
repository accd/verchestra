import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOracleReadOperation } from "../../packages/data-probe/src/oracle-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { oracleFixture } from "../helpers/oracle-probe-fixture.mjs";

const options = {
  kind: "select",
  protectedRequestRef: request().operation.protectedRequestRef,
  parameterClassifications: []
};
for (const [label, sql, code] of [
  ["semicolon batch", "SELECT id FROM hr.orders; DELETE FROM hr.orders", "VES_ORACLE_BATCH_DENIED"],
  ["slash batch", "SELECT id FROM hr.orders\n/", "VES_ORACLE_BATCH_DENIED"],
  ["PL/SQL block", "BEGIN NULL END", "VES_ORACLE_EXECUTION_DENIED"],
  ["DECLARE block", "DECLARE x NUMBER BEGIN NULL END", "VES_ORACLE_EXECUTION_DENIED"],
  ["procedure CALL", "CALL hr.read_orders()", "VES_ORACLE_EXECUTION_DENIED"],
  ["EXECUTE", "EXECUTE hr.read_orders", "VES_ORACLE_EXECUTION_DENIED"],
  ["SELECT INTO", "SELECT id INTO target_id FROM hr.orders", "VES_ORACLE_EXECUTION_DENIED"],
  ["database link", "SELECT id FROM hr.orders@remote", "VES_ORACLE_DATABASE_LINK_DENIED"],
  ["SELECT FOR UPDATE", "SELECT id FROM hr.orders FOR UPDATE", "VES_ORACLE_LOCK_DENIED"],
  ["sequence NEXTVAL", "SELECT hr.order_seq.NEXTVAL FROM hr.orders", "VES_ORACLE_SEQUENCE_DENIED"],
  ["line comment", "SELECT id FROM hr.orders -- hidden", "VES_ORACLE_COMMENT_DENIED"],
  ["optimizer hint", "SELECT /*+ FULL(o) */ id FROM hr.orders o", "VES_ORACLE_COMMENT_DENIED"],
  ["string literal", "SELECT id FROM hr.orders WHERE status = 'paid'", "VES_ORACLE_LITERAL_DENIED"],
  ["q literal", "SELECT id FROM hr.orders WHERE status = q'[paid]'", "VES_ORACLE_LITERAL_DENIED"],
  ["quoted identifier", 'SELECT id FROM "HR"."ORDERS"', "VES_ORACLE_LITERAL_DENIED"],
  ["numeric literal", "SELECT id FROM hr.orders WHERE id = 1", "VES_ORACLE_LITERAL_DENIED"],
  ["unqualified object", "SELECT id FROM orders", "VES_ORACLE_OBJECT_INVALID"],
  ["DBA catalog", "SELECT username FROM dba_users", "VES_ORACLE_CATALOG_DENIED"],
  ["V$ catalog", "SELECT name FROM v$database", "VES_ORACLE_CATALOG_DENIED"],
  ["ALL catalog outside introspection", "SELECT table_name FROM all_tables", "VES_ORACLE_CATALOG_DENIED"],
  ["DBMS package", "SELECT dbms_random.value() FROM hr.orders", "VES_ORACLE_FUNCTION_DENIED"],
  ["UTL package", "SELECT utl_inaddr.get_host_name() FROM hr.orders", "VES_ORACLE_FUNCTION_DENIED"],
  ["Unicode homoglyph", "SЕLECT id FROM hr.orders", "VES_ORACLE_ENCODING_DENIED"]
])
  test(`Oracle denies ${label}`, () => assert.throws(() => parseOracleReadOperation(sql, options), { code }));

for (const [label, sql] of [
  ["padded with tabs and spaces", "SELECT id FROM hr.orders\n \t/ \t\n"],
  ["with CRLF line endings", "SELECT id FROM hr.orders\r\n/\r\n"],
  ["after blank lines", "SELECT id FROM hr.orders\n\n\n/"],
  ["as the opening line", "/\nSELECT id FROM hr.orders"],
  ["as a trailing line ending in a lone carriage return", "SELECT id FROM hr.orders\n/\r"]
])
  test(`Oracle denies a slash batch separator ${label}`, () =>
    assert.throws(() => parseOracleReadOperation(sql, options), { code: "VES_ORACLE_BATCH_DENIED" }));

test("Oracle allows a division operator that shares its line", () =>
  assert.deepEqual(parseOracleReadOperation("SELECT total / weight FROM hr.orders", options).objects, [
    { schema: "hr", name: "orders", type: "table" }
  ]));

test("Oracle batch separator detection stays linear on adversarial newline input", () => {
  const adversarial = `${"\n".repeat(60_000)}X`;
  const started = process.hrtime.bigint();
  assert.throws(() => parseOracleReadOperation(adversarial, options), { code: "VES_ORACLE_READ_FORM_DENIED" });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 1000, `parse took ${elapsedMs.toFixed(0)}ms; batch separator detection is no longer linear`);
});

for (const [label, connection] of [
  ["SYSDBA", { sysdba: true }],
  ["SYSOPER", { sysoper: true }],
  ["SYSASM", { sysasm: true }],
  ["SYSBACKUP", { sysbackup: true }],
  ["SYSDG", { sysdg: true }],
  ["SYSKM", { syskm: true }],
  ["DBA role", { dbaRole: true }],
  ["write system privilege", { writeSystemPrivilegeCount: 1 }],
  ["write object privilege", { writeObjectPrivilegeCount: 1 }],
  ["EXECUTE ANY PROCEDURE", { executeAnyProcedure: true }],
  ["CREATE DATABASE LINK", { createDatabaseLink: true }]
])
  test(`Oracle principal with ${label} is not read-only`, async () => {
    const f = await oracleFixture({ connection });
    assert.equal((await f.worker.verifyIdentity(f.plan)).principalReadOnly, false);
  });

test("Oracle malformed protected request is sanitized", async () => {
  const f = await oracleFixture();
  f.parameters.set(f.plan.operation.protectedRequestRef, new TextEncoder().encode("not-json"));
  await assert.rejects(f.supervisor.execute(), { code: "VES_ORACLE_REQUEST_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
