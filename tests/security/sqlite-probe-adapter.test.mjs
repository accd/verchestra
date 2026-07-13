import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSqliteReadOperation } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { realSqliteFixture, sqliteFixture } from "../helpers/sqlite-probe-fixture.mjs";

const options = {
  kind: "select",
  protectedRequestRef: request().operation.protectedRequestRef,
  parameterClassifications: []
};
for (const [label, sql, code] of [
  ["semicolon batch", "SELECT id FROM main.orders; DELETE FROM main.orders", "VES_SQLITE_BATCH_DENIED"],
  ["line comment", "SELECT id FROM main.orders -- hidden", "VES_SQLITE_COMMENT_DENIED"],
  ["block comment", "SELECT /* hidden */ id FROM main.orders", "VES_SQLITE_COMMENT_DENIED"],
  ["ATTACH", "ATTACH DATABASE ? AS stolen", "VES_SQLITE_DATABASE_CONTROL_DENIED"],
  ["DETACH", "DETACH DATABASE stolen", "VES_SQLITE_DATABASE_CONTROL_DENIED"],
  ["write PRAGMA", "PRAGMA writable_schema=ON", "VES_SQLITE_PRAGMA_DENIED"],
  ["read PRAGMA", "PRAGMA table_info(orders)", "VES_SQLITE_PRAGMA_DENIED"],
  ["load_extension", "SELECT load_extension(?) FROM main.orders", "VES_SQLITE_FUNCTION_DENIED"],
  ["INSERT", "INSERT INTO main.orders(status) VALUES (?)", "VES_SQLITE_WRITE_DENIED"],
  ["UPDATE", "UPDATE main.orders SET status = ?", "VES_SQLITE_WRITE_DENIED"],
  ["DELETE", "DELETE FROM main.orders", "VES_SQLITE_WRITE_DENIED"],
  ["CREATE", "CREATE TABLE main.stolen(id INTEGER)", "VES_SQLITE_WRITE_DENIED"],
  ["DROP", "DROP TABLE main.orders", "VES_SQLITE_WRITE_DENIED"],
  ["ALTER", "ALTER TABLE main.orders ADD COLUMN stolen TEXT", "VES_SQLITE_WRITE_DENIED"],
  ["VACUUM", "VACUUM", "VES_SQLITE_WRITE_DENIED"],
  ["REINDEX", "REINDEX main.orders", "VES_SQLITE_WRITE_DENIED"],
  ["ANALYZE", "ANALYZE main.orders", "VES_SQLITE_WRITE_DENIED"],
  ["transaction", "BEGIN TRANSACTION", "VES_SQLITE_WRITE_DENIED"],
  ["unqualified object", "SELECT id FROM orders", "VES_SQLITE_OBJECT_INVALID"],
  ["temp object", "SELECT id FROM temp.orders", "VES_SQLITE_DATABASE_CONTROL_DENIED"],
  ["sqlite internal table", "SELECT rootpage FROM main.sqlite_master", "VES_SQLITE_CATALOG_DENIED"],
  ["catalog outside introspection", "SELECT name FROM main.sqlite_schema", "VES_SQLITE_CATALOG_DENIED"],
  ["unsafe function", "SELECT randomblob(?) FROM main.orders", "VES_SQLITE_FUNCTION_DENIED"],
  ["string literal", "SELECT id FROM main.orders WHERE status = 'paid'", "VES_SQLITE_LITERAL_DENIED"],
  ["numeric literal", "SELECT id FROM main.orders WHERE id = 1", "VES_SQLITE_LITERAL_DENIED"],
  ["quoted identifier", 'SELECT id FROM "main"."orders"', "VES_SQLITE_LITERAL_DENIED"],
  ["recursive CTE", "WITH RECURSIVE x AS (SELECT id FROM main.orders) SELECT id FROM x", "VES_SQLITE_RECURSIVE_DENIED"],
  ["Unicode homoglyph", "SЕLECT id FROM main.orders", "VES_SQLITE_ENCODING_DENIED"]
])
  test(`SQLite denies ${label}`, () => assert.throws(() => parseSqliteReadOperation(sql, options), { code }));

test("SQLite malformed protected request is sanitized", async () => {
  const f = await sqliteFixture();
  f.parameters.set(f.plan.operation.protectedRequestRef, new TextEncoder().encode("not-json"));
  await assert.rejects(f.supervisor.execute(), { code: "VES_SQLITE_REQUEST_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
test("SQLite real read-only connection rejects a write and preserves bytes", async (t) => {
  const f = await realSqliteFixture();
  t.after(() => f.cleanup());
  await f.worker.configureReadOnlySession(f.plan);
  assert.throws(() => f.connection.prepareForTest("DELETE FROM orders"));
  assert.deepEqual((await f.after()).bytes, f.before);
});
test("SQLite extension loading cannot be re-enabled", async (t) => {
  const f = await realSqliteFixture();
  t.after(() => f.cleanup());
  assert.throws(() => f.connection.enableExtensionForTest());
  assert.deepEqual((await f.after()).bytes, f.before);
});
