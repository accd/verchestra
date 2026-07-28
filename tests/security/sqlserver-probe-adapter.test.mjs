import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SqlServerFixtureConnection,
  SqlServerProbeAdapter,
  parseSqlServerReadOperation
} from "../../packages/data-probe/src/sqlserver-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const options = { kind: "select", protectedRequestRef: ref, parameterClassifications: [] };

test("normalizes T-SQL SELECT", () => {
  const op = parseSqlServerReadOperation("SELECT count(*) FROM public.orders WHERE status = @p1", {
    ...options,
    parameterClassifications: ["internal"]
  });
  assert.deepEqual(op.objects, [{ schema: "public", name: "orders", type: "table" }]);
  assert.deepEqual(op.functions, ["count"]);
});

test("normalizes T-SQL read-only CTE", () => {
  assert.deepEqual(
    parseSqlServerReadOperation("WITH recent AS (SELECT id FROM public.orders) SELECT count(*) FROM recent", options)
      .objects,
    [{ schema: "public", name: "orders", type: "table" }]
  );
});

test("allows closed sys catalog introspection", () => {
  assert.deepEqual(
    parseSqlServerReadOperation("SELECT name FROM sys.tables", { ...options, kind: "introspect" }).objects,
    [{ schema: "sys", name: "tables", type: "catalog" }]
  );
});

for (const [label, sql, code] of [
  ["GO batch", "SELECT id FROM public.orders\nGO\nSELECT 1", "VES_SQLSERVER_BATCH_DENIED"],
  ["semicolon batch", "SELECT id FROM public.orders; DELETE FROM public.orders", "VES_SQLSERVER_BATCH_DENIED"],
  ["EXEC", "EXEC public.read_orders", "VES_SQLSERVER_WRITE_DENIED"],
  ["SELECT INTO", "SELECT id INTO public.copy FROM public.orders", "VES_SQLSERVER_WRITE_DENIED"],
  ["temp table", "SELECT id FROM #orders", "VES_SQLSERVER_TEMP_OBJECT_DENIED"],
  ["tempdb", "SELECT id FROM tempdb.public.orders", "VES_SQLSERVER_TEMP_OBJECT_DENIED"],
  ["table hint", "SELECT id FROM public.orders WITH (NOLOCK)", "VES_SQLSERVER_HINT_DENIED"],
  ["query hint", "SELECT id FROM public.orders OPTION (MAXDOP 8)", "VES_SQLSERVER_HINT_DENIED"],
  ["OPENROWSET", "SELECT * FROM OPENROWSET(BULK @p1)", "VES_SQLSERVER_FUNCTION_DENIED"],
  ["xp command", "EXEC xp_cmdshell @p1", "VES_SQLSERVER_WRITE_DENIED"],
  ["line comment", "SELECT id FROM public.orders -- hidden", "VES_SQLSERVER_COMMENT_DENIED"],
  ["block comment", "SELECT id FROM public.orders /* hidden */", "VES_SQLSERVER_COMMENT_DENIED"],
  ["literal", "SELECT id FROM public.orders WHERE status = 'paid'", "VES_SQLSERVER_LITERAL_DENIED"],
  ["quoted identifier", "SELECT id FROM [public].[orders]", "VES_SQLSERVER_LITERAL_DENIED"],
  ["unqualified", "SELECT id FROM orders", "VES_SQLSERVER_OBJECT_INVALID"],
  ["system object", "SELECT * FROM sys.server_principals", "VES_SQLSERVER_CATALOG_DENIED"],
  ["Unicode homoglyph", "SЕLECT id FROM public.orders", "VES_SQLSERVER_ENCODING_DENIED"]
]) {
  test(`denies ${label}`, () => assert.throws(() => parseSqlServerReadOperation(sql, options), { code }));
}

for (const [label, sql] of [
  ["padded with tabs and spaces", "SELECT id FROM public.orders\n \tGO \t\nSELECT id FROM public.orders"],
  ["with CRLF line endings", "SELECT id FROM public.orders\r\nGO\r\nSELECT id FROM public.orders"],
  ["after blank lines", "SELECT id FROM public.orders\n\n\nGO\n\n"],
  ["as the closing line without a trailing newline", "SELECT id FROM public.orders\nGO"],
  ["as the opening line", "GO\nSELECT id FROM public.orders"],
  ["in lower case", "SELECT id FROM public.orders\ngo\nSELECT id FROM public.orders"],
  ["ending in a lone carriage return", "SELECT id FROM public.orders\nGO\r"]
]) {
  test(`denies a GO batch separator ${label}`, () =>
    assert.throws(() => parseSqlServerReadOperation(sql, options), { code: "VES_SQLSERVER_BATCH_DENIED" }));
}

test("allows GO inside an identifier that shares its line", () => {
  assert.deepEqual(parseSqlServerReadOperation("SELECT id FROM public.go_orders", options).objects, [
    { schema: "public", name: "go_orders", type: "table" }
  ]);
});

test("batch separator detection stays linear on adversarial newline input", () => {
  const adversarial = `${"\n".repeat(60_000)}X`;
  const started = process.hrtime.bigint();
  assert.throws(() => parseSqlServerReadOperation(adversarial, options), { code: "VES_SQLSERVER_READ_FORM_DENIED" });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 1000, `parse took ${elapsedMs.toFixed(0)}ms; batch separator detection is no longer linear`);
});

for (const [label, observation] of [
  ["sysadmin", { sysadmin: true }],
  ["securityadmin", { securityAdmin: true }],
  ["db_owner", { dbOwner: true }],
  ["db_ddladmin", { dbDdlAdmin: true }],
  ["db_datawriter", { dbDataWriter: true }],
  ["write permission", { writePermissionCount: 1 }],
  ["impersonate", { impersonatePermission: true }]
]) {
  test(`principal with ${label} is not read-only`, async () => {
    const adapter = new SqlServerProbeAdapter({ connection: new SqlServerFixtureConnection(observation) });
    const evidence = await adapter.verifyIdentity({
      databaseId: "orders-production",
      planDigest: `sha256:${"1".repeat(64)}`,
      bounds: { timeoutMs: 2000 }
    });
    assert.equal(evidence.principalReadOnly, false);
  });
}

test("session requires independent negative write permission", async () => {
  const adapter = new SqlServerProbeAdapter({ connection: new SqlServerFixtureConnection({ sessionCanWrite: true }) });
  const session = await adapter.configureReadOnlySession({
    databaseId: "orders-production",
    planDigest: `sha256:${"1".repeat(64)}`,
    bounds: { timeoutMs: 2000 }
  });
  assert.equal(session.sessionReadOnly, false);
});

test("session applies XACT_ABORT, lock timeout, snapshot, and transaction", async () => {
  const connection = new SqlServerFixtureConnection();
  const adapter = new SqlServerProbeAdapter({ connection });
  assert.equal(
    (
      await adapter.configureReadOnlySession({
        databaseId: "orders-production",
        planDigest: `sha256:${"1".repeat(64)}`,
        bounds: { timeoutMs: 2000 }
      })
    ).sessionReadOnly,
    true
  );
  assert.deepEqual(
    connection.controlCalls.map(([sql]) => sql),
    [
      "SET XACT_ABORT ON",
      "SET LOCK_TIMEOUT @p1",
      "SET TRANSACTION ISOLATION LEVEL SNAPSHOT",
      "BEGIN TRANSACTION",
      "SELECT HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'UPDATE') AS can_write"
    ]
  );
});

test("adapter cancellation and termination delegate", async () => {
  const connection = new SqlServerFixtureConnection();
  const adapter = new SqlServerProbeAdapter({ connection });
  await adapter.cancel();
  await adapter.terminate();
  assert.deepEqual([connection.cancelled, connection.terminated], [true, true]);
});
