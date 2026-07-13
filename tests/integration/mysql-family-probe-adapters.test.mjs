import assert from "node:assert/strict";
import { test } from "node:test";

import { mysqlFamilyFixture } from "../helpers/mysql-family-probe-fixture.mjs";

for (const engine of ["mysql", "mariadb"]) {
  for (const [label, connection] of [
    ["write grants", { writePrivilegeCount: 1 }],
    ["FILE privilege", { filePrivilege: true }],
    ["SUPER privilege", { superPrivilege: true }],
    ["CREATE USER privilege", { createUserPrivilege: true }]
  ]) {
    test(`${engine}: principal with ${label} is not read-only`, async () => {
      const fixture = await mysqlFamilyFixture(engine, { connection });
      assert.equal((await fixture.worker.verifyIdentity(fixture.plan)).principalReadOnly, false);
    });
  }

  test(`${engine}: incompatible server family/version is quarantined`, async () => {
    const version = engine === "mysql" ? "5.7.44" : "10.1.48-MariaDB";
    const fixture = await mysqlFamilyFixture(engine, { connection: { version } });
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_MYSQL_FAMILY_VERSION_UNSUPPORTED" });
  });

  test(`${engine}: missing required server capability is quarantined`, async () => {
    const fixture = await mysqlFamilyFixture(engine, { connection: { capabilities: [] } });
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_MYSQL_FAMILY_CAPABILITY_MISSING" });
  });

  test(`${engine}: writable server session is denied`, async () => {
    const fixture = await mysqlFamilyFixture(engine, { connection: { transactionReadOnly: false } });
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_NOT_READ_ONLY" });
  });

  test(`${engine}: timeout invokes engine cancellation`, async () => {
    const fixture = await mysqlFamilyFixture(engine, {
      bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
      connection: { delayMs: 100 }
    });
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
    assert.equal(fixture.connection.cancelled, true);
  });

  test(`${engine}: protected values reach only the connection stream`, async () => {
    const fixture = await mysqlFamilyFixture(engine, { parameters: ["paid"] });
    await fixture.supervisor.execute();
    assert.deepEqual(fixture.connection.lastParameters, ["paid"]);
    assert.equal(JSON.stringify(fixture.plan).includes("paid"), false);
  });
}
