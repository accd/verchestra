import assert from "node:assert/strict";
import { test } from "node:test";

import { sqlServerFixture } from "../helpers/sqlserver-probe-fixture.mjs";

test("SQL Server database identity mismatch is denied by the supervisor", async () => {
  const fixture = await sqlServerFixture({ connection: { databaseId: "other" } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_IDENTITY_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SQL Server writable session evidence blocks execution", async () => {
  const fixture = await sqlServerFixture({ connection: { sessionCanWrite: true } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("SQL Server statement timeout cancels the connection and promotes no partial evidence", async () => {
  const fixture = await sqlServerFixture({
    bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { delayMs: 100 }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(fixture.connection.cancelled, true);
  assert.deepEqual([fixture.results.commits, fixture.results.rollbacks], [0, 1]);
});

test("SQL Server row bound rejects the result and promotes no partial evidence", async () => {
  const fixture = await sqlServerFixture({
    bounds: { timeoutMs: 2000, rowLimit: 1, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { rows: [{ id: 1 }, { id: 2 }] }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_ROW_LIMIT" });
  assert.deepEqual([fixture.results.commits, fixture.results.rollbacks], [0, 1]);
});

test("SQL Server byte bound rejects the result and promotes no partial evidence", async () => {
  const fixture = await sqlServerFixture({
    bounds: { timeoutMs: 2000, rowLimit: 100, byteLimit: 1, concurrencyLimit: 1 },
    connection: { rows: [{ payload: "large" }] }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_BYTE_LIMIT" });
  assert.deepEqual([fixture.results.commits, fixture.results.rollbacks], [0, 1]);
});

test("SQL Server protected values reach only the connection stream", async () => {
  const fixture = await sqlServerFixture({ parameters: ["paid"] });
  await fixture.supervisor.execute();
  assert.deepEqual(fixture.connection.lastParameters, ["paid"]);
  assert.equal(JSON.stringify(fixture.plan).includes("paid"), false);
});
