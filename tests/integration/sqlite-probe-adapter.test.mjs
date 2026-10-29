import assert from "node:assert/strict";
import { test } from "node:test";
import { realSqliteFixture, sqliteFixture } from "../helpers/sqlite-probe-fixture.mjs";

test("SQLite real file SELECT preserves exact bytes and digest", async (t) => {
  const f = await realSqliteFixture();
  t.after(() => f.cleanup());
  const result = await f.supervisor.execute();
  const after = await f.after();
  assert.equal(result.rowCount, 1);
  assert.deepEqual(after.bytes, f.before);
  assert.equal(after.digest, f.beforeDigest);
});
test("SQLite real file CTE preserves exact bytes", async (t) => {
  const f = await realSqliteFixture({
    sql: "WITH paid AS (SELECT id FROM main.orders WHERE status = ?) SELECT count(*) FROM paid"
  });
  t.after(() => f.cleanup());
  await f.supervisor.execute();
  assert.deepEqual((await f.after()).bytes, f.before);
});
test("SQLite real catalog introspection preserves exact bytes", async (t) => {
  const f = await realSqliteFixture({
    sql: "SELECT name FROM main.sqlite_schema",
    kind: "introspect",
    parameterClassifications: [],
    parameters: []
  });
  t.after(() => f.cleanup());
  await f.supervisor.execute();
  assert.deepEqual((await f.after()).bytes, f.before);
});
test("SQLite real connection proves defensive query-only state", async (t) => {
  const f = await realSqliteFixture();
  t.after(() => f.cleanup());
  const identity = await f.worker.verifyIdentity(f.plan);
  const session = await f.worker.configureReadOnlySession(f.plan);
  assert.deepEqual([identity.principalReadOnly, session.sessionReadOnly], [true, true]);
});
test("SQLite product mismatch is rejected", async () => {
  const f = await sqliteFixture({ connection: { product: "sqlite-compatible" } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_SQLITE_PRODUCT_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
test("SQLite additional attached database evidence is rejected", async () => {
  const f = await sqliteFixture({ connection: { attachedDatabaseCount: 2 } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_IDENTITY_NOT_READ_ONLY" });
  assert.equal(f.connection.streamCalls, 0);
});
test("SQLite timeout cancels without promotion", async () => {
  const f = await sqliteFixture({
    bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { delayMs: 100 }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(f.connection.cancelled, true);
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("SQLite row limit rolls back without promotion", async () => {
  const f = await sqliteFixture({
    bounds: { timeoutMs: 2000, rowLimit: 1, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { rows: [{ id: 1 }, { id: 2 }] }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_ROW_LIMIT" });
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("SQLite byte limit rolls back without promotion", async () => {
  const f = await sqliteFixture({
    bounds: { timeoutMs: 2000, rowLimit: 100, byteLimit: 1, concurrencyLimit: 1 },
    connection: { rows: [{ payload: "large" }] }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_BYTE_LIMIT" });
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});

// invariant: a real SQLite read binds every parameter of one classification,
// in order (.specs/features/probe-multi-parameter/checks.md C4).
test("a real SQLite read binds two parameters of one classification", async (t) => {
  for (const [parameters, ids] of [
    [["paid", 10], [1]],
    [["paid", 60], []]
  ]) {
    const f = await realSqliteFixture({
      sql: "SELECT id FROM main.orders WHERE status = ? AND amount > ?",
      parameters,
      parameterClassifications: ["internal", "internal"]
    });
    t.after(() => f.cleanup());
    const rows = [];
    const append = f.results.append.bind(f.results);
    f.results.append = async (transactionId, chunk) => {
      rows.push(...chunk);
      return append(transactionId, chunk);
    };
    const result = await f.supervisor.execute();
    assert.equal(result.status, "complete");
    assert.equal(result.rowCount, ids.length);
    assert.deepEqual(
      rows.map((row) => row.id),
      ids
    );
  }
});
