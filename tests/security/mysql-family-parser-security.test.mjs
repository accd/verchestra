import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMySqlFamilyReadOperation } from "../../packages/data-probe/src/mysql-family-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { mysqlFamilyFixture } from "../helpers/mysql-family-probe-fixture.mjs";

for (const engine of ["mysql", "mariadb"]) {
  const options = {
    engine,
    kind: "select",
    protectedRequestRef: request().operation.protectedRequestRef,
    parameterClassifications: []
  };
  for (const [label, sql, code] of [
    ["procedure", "CALL public.export_orders()", "VES_MYSQL_FAMILY_WRITE_DENIED"],
    ["outfile", "SELECT id FROM public.orders INTO OUTFILE ?", "VES_MYSQL_FAMILY_EXPORT_DENIED"],
    ["dumpfile", "SELECT id FROM public.orders INTO DUMPFILE ?", "VES_MYSQL_FAMILY_EXPORT_DENIED"],
    ["load data", "LOAD DATA INFILE ? INTO TABLE public.orders", "VES_MYSQL_FAMILY_WRITE_DENIED"],
    ["handler", "HANDLER public.orders READ FIRST", "VES_MYSQL_FAMILY_WRITE_DENIED"],
    ["multi statement", "SELECT id FROM public.orders; DELETE FROM public.orders", "VES_MYSQL_FAMILY_MULTI_STATEMENT"],
    ["hash comment", "SELECT id FROM public.orders # hidden", "VES_MYSQL_FAMILY_COMMENT_DENIED"],
    ["version comment", "SELECT id FROM public.orders /*!50000 FOR UPDATE */", "VES_MYSQL_FAMILY_COMMENT_DENIED"],
    ["literal", "SELECT id FROM public.orders WHERE status = 'paid'", "VES_MYSQL_FAMILY_LITERAL_DENIED"],
    ["backtick", "SELECT id FROM `public`.`orders`", "VES_MYSQL_FAMILY_LITERAL_DENIED"],
    ["sleep", "SELECT sleep(?) FROM public.orders", "VES_MYSQL_FAMILY_FUNCTION_DENIED"],
    ["load_file", "SELECT load_file(?) FROM public.orders", "VES_MYSQL_FAMILY_FUNCTION_DENIED"],
    ["system metadata", "SELECT user FROM mysql.user", "VES_MYSQL_FAMILY_CATALOG_DENIED"],
    ["unqualified object", "SELECT id FROM orders", "VES_MYSQL_FAMILY_OBJECT_INVALID"],
    ["Unicode homoglyph", "SЕLECT id FROM public.orders", "VES_MYSQL_FAMILY_ENCODING_DENIED"]
  ]) {
    test(`${engine}: parser denies ${label}`, () => {
      assert.throws(() => parseMySqlFamilyReadOperation(sql, options), { code });
    });
  }

  test(`${engine}: unsafe information_schema relation is denied`, () => {
    assert.throws(
      () =>
        parseMySqlFamilyReadOperation("SELECT * FROM information_schema.user_privileges", {
          ...options,
          kind: "introspect"
        }),
      { code: "VES_MYSQL_FAMILY_CATALOG_DENIED" }
    );
  });

  test(`${engine}: parameter count mismatch fails before stream`, async () => {
    const fixture = await mysqlFamilyFixture(engine, { parameters: [] });
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_MYSQL_FAMILY_PARAMETERS_INVALID" });
    assert.equal(fixture.connection.streamCalls, 0);
  });
}
