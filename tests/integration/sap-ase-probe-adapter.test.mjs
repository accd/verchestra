import assert from "node:assert/strict";
import { test } from "node:test";

import { sapAseFixture } from "../helpers/sap-ase-probe-fixture.mjs";

test("SAP ASE rejects a non-ASE server identity", async () => {
  const fixture = await sapAseFixture({ connection: { product: "sql-anywhere" } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_SAP_ASE_PRODUCT_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE database identity mismatch is denied by the supervisor", async () => {
  const fixture = await sapAseFixture({ connection: { databaseId: "other" } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_IDENTITY_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE writable session evidence blocks execution", async () => {
  const fixture = await sapAseFixture({ connection: { sessionWriteCount: 1 } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE active dangerous role blocks execution", async () => {
  const fixture = await sapAseFixture({ connection: { sessionDangerousRoleCount: 1 } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SAP ASE timeout cancels execution and promotes no partial evidence", async () => {
  const fixture = await sapAseFixture({
    bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { delayMs: 100 }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(fixture.connection.cancelled, true);
  assert.deepEqual([fixture.results.commits, fixture.results.rollbacks], [0, 1]);
});

test("SAP ASE row bound rolls back without partial promotion", async () => {
  const fixture = await sapAseFixture({
    bounds: { timeoutMs: 2000, rowLimit: 1, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { rows: [{ id: 1 }, { id: 2 }] }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_ROW_LIMIT" });
  assert.deepEqual([fixture.results.commits, fixture.results.rollbacks], [0, 1]);
});

test("SAP ASE byte bound rolls back without partial promotion", async () => {
  const fixture = await sapAseFixture({
    bounds: { timeoutMs: 2000, rowLimit: 100, byteLimit: 1, concurrencyLimit: 1 },
    connection: { rows: [{ payload: "large" }] }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_BYTE_LIMIT" });
  assert.deepEqual([fixture.results.commits, fixture.results.rollbacks], [0, 1]);
});

test("SAP ASE protected values reach only the prepared connection stream", async () => {
  const fixture = await sapAseFixture({ parameters: ["paid"] });
  await fixture.supervisor.execute();
  assert.deepEqual(fixture.connection.lastParameters, ["paid"]);
  assert.equal(JSON.stringify(fixture.plan).includes("paid"), false);
});
