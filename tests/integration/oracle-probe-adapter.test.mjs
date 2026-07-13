import assert from "node:assert/strict";
import { test } from "node:test";
import { oracleFixture } from "../helpers/oracle-probe-fixture.mjs";

test("Oracle product mismatch is rejected", async () => {
  const f = await oracleFixture({ connection: { product: "oracle-compatible" } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_ORACLE_PRODUCT_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
test("Oracle database identity mismatch is denied", async () => {
  const f = await oracleFixture({ connection: { databaseId: "other" } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_IDENTITY_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
test("Oracle writable transaction evidence blocks execution", async () => {
  const f = await oracleFixture({ connection: { transactionReadOnly: false } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  assert.equal(f.connection.streamCalls, 0);
});
test("Oracle active write privilege blocks session execution", async () => {
  const f = await oracleFixture({ connection: { sessionWriteCount: 1 } });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  assert.equal(f.connection.streamCalls, 0);
});
test("Oracle timeout cancels and rolls back without promotion", async () => {
  const f = await oracleFixture({
    bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { delayMs: 100 }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(f.connection.cancelled, true);
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("Oracle row limit rolls back without promotion", async () => {
  const f = await oracleFixture({
    bounds: { timeoutMs: 2000, rowLimit: 1, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { rows: [{ id: 1 }, { id: 2 }] }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_ROW_LIMIT" });
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("Oracle byte limit rolls back without promotion", async () => {
  const f = await oracleFixture({
    bounds: { timeoutMs: 2000, rowLimit: 100, byteLimit: 1, concurrencyLimit: 1 },
    connection: { rows: [{ payload: "large" }] }
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_PROBE_BYTE_LIMIT" });
  assert.deepEqual([f.results.commits, f.results.rollbacks], [0, 1]);
});
test("Oracle protected values reach only the driver stream", async () => {
  const f = await oracleFixture({ parameters: ["paid"] });
  await f.supervisor.execute();
  assert.deepEqual(f.connection.lastParameters, ["paid"]);
  assert.equal(JSON.stringify(f.plan).includes("paid"), false);
});
