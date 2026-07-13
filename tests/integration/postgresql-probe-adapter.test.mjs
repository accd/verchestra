import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresFixture } from "../helpers/postgresql-probe-fixture.mjs";

for (const [label, connection] of [
  ["superuser", { superuser: true }],
  ["create role", { createRole: true }],
  ["create database", { createDatabase: true }],
  ["replication", { replication: true }],
  ["bypass RLS", { bypassRls: true }],
  ["write privilege", { writePrivilegeCount: 1 }]
]) {
  test(`principal with ${label} is not read-only`, async () => {
    const { worker, plan } = await postgresFixture({ connection });
    assert.equal((await worker.verifyIdentity(plan)).principalReadOnly, false);
  });
}

test("database identity mismatch is preserved for supervisor denial", async () => {
  const fixture = await postgresFixture({ connection: { databaseId: "other" } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_IDENTITY_INVALID" });
});

test("server reporting writable transaction is denied", async () => {
  const fixture = await postgresFixture({ connection: { transactionReadOnly: "off" } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
});

test("statement timeout cancels the PostgreSQL request", async () => {
  const fixture = await postgresFixture({
    bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    connection: { delayMs: 100 }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(fixture.connection.cancelled, true);
});

test("protected positional parameters reach only the connection stream", async () => {
  const fixture = await postgresFixture({ parameters: ["paid"] });
  await fixture.supervisor.execute();
  assert.deepEqual(fixture.connection.lastParameters, ["paid"]);
  assert.equal(JSON.stringify(fixture.plan).includes("paid"), false);
});
