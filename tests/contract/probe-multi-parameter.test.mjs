// invariant: a read with several parameters of one classification is planned
// with one classification per bind, so every engine's worker, which parses the
// statement again against the plan, runs it; and a bind count that differs from
// the classifications is still refused, at the parser and at the worker
// (.specs/features/probe-multi-parameter/checks.md C3, C5).
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSqliteReadOperation } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { findCommand, mongoDbFixture } from "../helpers/mongodb-probe-fixture.mjs";
import { mysqlFamilyFixture } from "../helpers/mysql-family-probe-fixture.mjs";
import { oracleFixture } from "../helpers/oracle-probe-fixture.mjs";
import { postgresFixture } from "../helpers/postgresql-probe-fixture.mjs";
import { sapAseFixture } from "../helpers/sap-ase-probe-fixture.mjs";
import { sqliteFixture } from "../helpers/sqlite-probe-fixture.mjs";
import { sqlServerFixture } from "../helpers/sqlserver-probe-fixture.mjs";

const TWO = ["internal", "internal"];
const VALUES = ["paid", "pending"];

const ENGINES = [
  [
    "postgresql",
    () =>
      postgresFixture({
        sql: "SELECT count(*) FROM public.orders WHERE status = $1 OR status = $2",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "mysql",
    () =>
      mysqlFamilyFixture("mysql", {
        sql: "SELECT count(*) FROM public.orders WHERE status = ? OR status = ?",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "mariadb",
    () =>
      mysqlFamilyFixture("mariadb", {
        sql: "SELECT count(*) FROM public.orders WHERE status = ? OR status = ?",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "sqlserver",
    () =>
      sqlServerFixture({
        sql: "SELECT count(*) FROM public.orders WHERE status = @p1 OR status = @p2",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "sybase",
    () =>
      sapAseFixture({
        sql: "select count(*) from dbo.orders where status = ? or status = ?",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "oracle",
    () =>
      oracleFixture({
        sql: "SELECT count(*) FROM hr.orders WHERE status = :p1 OR status = :p2",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "sqlite",
    () =>
      sqliteFixture({
        sql: "SELECT count(*) FROM main.orders WHERE status = ? OR status = ?",
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ],
  [
    "mongodb",
    () =>
      mongoDbFixture({
        command: findCommand({
          filter: { $or: [{ status: { $eq: { $param: 0 } } }, { status: { $eq: { $param: 1 } } }] }
        }),
        parameters: VALUES,
        parameterClassifications: TWO
      })
  ]
];

test("every engine runs a read with two parameters of one classification", async () => {
  assert.equal(ENGINES.length, 8);
  for (const [engine, fixture] of ENGINES) {
    const f = await fixture();
    assert.deepEqual(f.plan.operation.parameterClassifications, TWO, `${engine} planned one classification per bind`);
    const result = await f.supervisor.execute();
    assert.equal(result.status, "complete", `${engine} ran a read with two parameters`);
  }
});

test("a bind count that differs from its classifications is refused", async () => {
  assert.throws(
    () =>
      parseSqliteReadOperation("SELECT count(*) FROM main.orders WHERE status = ? OR status = ?", {
        kind: "select",
        protectedRequestRef: request().operation.protectedRequestRef,
        parameterClassifications: ["internal"]
      }),
    { code: "VES_SQLITE_PARAMETERS_INVALID" }
  );
  const f = await sqliteFixture({
    sql: "SELECT count(*) FROM main.orders WHERE status = ? OR status = ?",
    parameters: ["paid"],
    parameterClassifications: TWO
  });
  await assert.rejects(f.supervisor.execute(), { code: "VES_SQLITE_PARAMETERS_INVALID" });
  assert.equal(f.results.commits, 0);
});
