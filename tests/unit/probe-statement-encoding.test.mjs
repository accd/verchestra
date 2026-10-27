import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMySqlFamilyReadOperation } from "../../packages/data-probe/src/mysql-family-adapter.ts";
import { parseOracleReadOperation } from "../../packages/data-probe/src/oracle-adapter.ts";
import { parsePostgreSqlReadOperation } from "../../packages/data-probe/src/postgresql-adapter.ts";
import { parseSapAseReadOperation } from "../../packages/data-probe/src/sap-ase-adapter.ts";
import { parseSqliteReadOperation } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { parseSqlServerReadOperation } from "../../packages/data-probe/src/sqlserver-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";

// The statement-encoding boundary every SQL dialect shares: printable ASCII
// plus TAB, LF and CR, and no backslash. Each control character just outside
// that set -- NUL, the one below TAB, VT, the last C0 code, DEL -- must be
// denied, and the three permitted whitespace characters must still parse.
const options = {
  kind: "select",
  protectedRequestRef: request().operation.protectedRequestRef,
  parameterClassifications: []
};

const DIALECTS = [
  ["PostgreSQL", parsePostgreSqlReadOperation, "public.orders", "VES_POSTGRES_ENCODING_DENIED", {}],
  ["MySQL", parseMySqlFamilyReadOperation, "public.orders", "VES_MYSQL_FAMILY_ENCODING_DENIED", { engine: "mysql" }],
  ["SQL Server", parseSqlServerReadOperation, "public.orders", "VES_SQLSERVER_ENCODING_DENIED", {}],
  ["SQLite", parseSqliteReadOperation, "main.orders", "VES_SQLITE_ENCODING_DENIED", {}],
  ["Oracle", parseOracleReadOperation, "hr.orders", "VES_ORACLE_ENCODING_DENIED", {}],
  ["SAP ASE", parseSapAseReadOperation, "dbo.orders", "VES_SAP_ASE_ENCODING_DENIED", {}]
];

const DENIED = [
  ["NUL", "\u0000"],
  ["U+0008", "\u0008"],
  ["VT", "\u000b"],
  ["FF", "\u000c"],
  ["U+001F", "\u001f"],
  ["DEL", "\u007f"],
  ["backslash", "\\"]
];

// PostgreSQL alone also denies `$` outside a positional parameter on the same
// encoding line, which closes dollar quoting.
test("PostgreSQL denies a dollar quote but keeps positional parameters", () => {
  assert.throws(() => parsePostgreSqlReadOperation("SELECT $$x$$ FROM public.orders", options), {
    code: "VES_POSTGRES_ENCODING_DENIED"
  });
  const operation = parsePostgreSqlReadOperation("SELECT id FROM public.orders WHERE status = $1", {
    ...options,
    parameterClassifications: ["internal"]
  });
  assert.equal(operation.objects.length, 1);
});

for (const [dialect, parse, object, code, extra] of DIALECTS) {
  const parseWith = (sql) => parse(sql, { ...options, ...extra });

  test(`${dialect} accepts TAB, LF and CR between tokens`, () => {
    const operation = parseWith(`SELECT\tid\r\nFROM ${object}`);
    assert.equal(operation.objects.length, 1);
  });

  for (const [label, character] of DENIED) {
    test(`${dialect} denies ${label} in a statement`, () => {
      assert.throws(() => parseWith(`SELECT id FROM ${object}${character}`), { code });
    });
  }
}
