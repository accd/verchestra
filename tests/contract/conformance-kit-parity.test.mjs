import assert from "node:assert/strict";
import { test } from "node:test";

import { MongoDbFixtureConnection } from "../../packages/data-probe/src/mongodb-adapter.ts";
import { MySqlFamilyFixtureConnection } from "../../packages/data-probe/src/mysql-family-adapter.ts";
import { OracleFixtureConnection } from "../../packages/data-probe/src/oracle-adapter.ts";
import { PostgreSqlFixtureConnection } from "../../packages/data-probe/src/postgresql-adapter.ts";
import { SapAseFixtureConnection } from "../../packages/data-probe/src/sap-ase-adapter.ts";
import { SqliteReadConnection } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { SqlServerFixtureConnection } from "../../packages/data-probe/src/sqlserver-adapter.ts";
import { mongoDbFixture } from "../helpers/mongodb-probe-fixture.mjs";
import { mysqlFamilyFixture } from "../helpers/mysql-family-probe-fixture.mjs";
import { oracleFixture } from "../helpers/oracle-probe-fixture.mjs";
import { postgresFixture } from "../helpers/postgresql-probe-fixture.mjs";
import { realSqliteFixture } from "../helpers/sqlite-probe-fixture.mjs";
import { sapAseFixture } from "../helpers/sap-ase-probe-fixture.mjs";
import { sqlServerFixture } from "../helpers/sqlserver-probe-fixture.mjs";

// #233: every one of the 7 engine kits must accept a real implementation
// and drive it through the identical ProbeWorkerSupervisor bounds and
// assertions the fixture connection uses by default. SQLite is proven with
// an actual node:sqlite-backed connection (realSqliteFixture, unchanged by
// this issue). No live server is available in CI for the other six — per
// the repository's own edge-qualification decision (AD-017), only SQLite
// runs anywhere — so each is proven here with a *second, externally
// constructed* instance of its own FixtureConnection class passed through
// options.realConnection: the point under test is the seam (does an
// object the caller supplies, not the one the helper would build by
// default, actually reach the adapter and the supervisor?), which a fresh
// external instance answers exactly as a real driver connection would.

test("[parity] sqlite kit accepts a real connection (node:sqlite)", async () => {
  const fixture = await realSqliteFixture();
  try {
    assert.ok(fixture.connection instanceof SqliteReadConnection);
    const result = await fixture.supervisor.execute();
    assert.equal(result.status, "complete");
  } finally {
    await fixture.cleanup();
  }
});

test("[parity] postgresql kit accepts an externally supplied connection", async () => {
  const external = new PostgreSqlFixtureConnection();
  const fixture = await postgresFixture({ realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});

test("[parity] mysql-family kit (mysql) accepts an externally supplied connection", async () => {
  const external = new MySqlFamilyFixtureConnection({ engine: "mysql" });
  const fixture = await mysqlFamilyFixture("mysql", { realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});

test("[parity] mysql-family kit (mariadb) accepts an externally supplied connection", async () => {
  const external = new MySqlFamilyFixtureConnection({ engine: "mariadb" });
  const fixture = await mysqlFamilyFixture("mariadb", { realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});

test("[parity] sap-ase kit accepts an externally supplied connection", async () => {
  const external = new SapAseFixtureConnection();
  const fixture = await sapAseFixture({ realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});

test("[parity] oracle kit accepts an externally supplied connection", async () => {
  const external = new OracleFixtureConnection();
  const fixture = await oracleFixture({ realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});

test("[parity] sqlserver kit accepts an externally supplied connection", async () => {
  const external = new SqlServerFixtureConnection();
  const fixture = await sqlServerFixture({ realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});

test("[parity] mongodb kit accepts an externally supplied connection", async () => {
  const external = new MongoDbFixtureConnection();
  const fixture = await mongoDbFixture({ realConnection: external });
  assert.equal(fixture.connection, external);
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
});
