import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePostgreSqlReadOperation } from "../../packages/data-probe/src/postgresql-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { postgresFixture } from "../helpers/postgresql-probe-fixture.mjs";

const options = {
  kind: "select",
  protectedRequestRef: request().operation.protectedRequestRef,
  parameterClassifications: []
};

for (const [label, sql, code] of [
  [
    "INSERT",
    "WITH changed AS (INSERT INTO public.orders VALUES (1) RETURNING *) SELECT * FROM changed",
    "VES_POSTGRES_WRITE_DENIED"
  ],
  ["UPDATE", "UPDATE public.orders SET status = $1", "VES_POSTGRES_WRITE_DENIED"],
  ["DELETE", "DELETE FROM public.orders", "VES_POSTGRES_WRITE_DENIED"],
  ["COPY", "COPY public.orders TO STDOUT", "VES_POSTGRES_WRITE_DENIED"],
  ["locking SELECT", "SELECT id FROM public.orders FOR UPDATE", "VES_POSTGRES_LOCK_DENIED"],
  ["multi statement", "SELECT id FROM public.orders; DROP TABLE public.orders", "VES_POSTGRES_MULTI_STATEMENT"],
  ["line comment", "SELECT id FROM public.orders -- hidden", "VES_POSTGRES_COMMENT_DENIED"],
  ["block comment", "SELECT id FROM public.orders /* hidden */", "VES_POSTGRES_COMMENT_DENIED"],
  ["inline literal", "SELECT id FROM public.orders WHERE status = 'paid'", "VES_POSTGRES_LITERAL_DENIED"],
  ["dollar quote", "SELECT $$secret$$ FROM public.orders", "VES_POSTGRES_ENCODING_DENIED"],
  ["NUL", "SELECT id FROM public.orders\0", "VES_POSTGRES_ENCODING_DENIED"],
  ["Unicode homoglyph", "SЕLECT id FROM public.orders", "VES_POSTGRES_ENCODING_DENIED"],
  ["unqualified object", "SELECT id FROM orders", "VES_POSTGRES_OBJECT_INVALID"],
  ["write function", "SELECT pg_read_file($1) FROM public.orders", "VES_POSTGRES_FUNCTION_DENIED"],
  ["sleep function", "SELECT pg_sleep($1) FROM public.orders", "VES_POSTGRES_FUNCTION_DENIED"]
]) {
  test(`parser denies ${label}`, () => {
    assert.throws(() => parsePostgreSqlReadOperation(sql, options), { code });
  });
}

test("catalog access requires explicit introspection kind", () => {
  assert.throws(() => parsePostgreSqlReadOperation("SELECT tablename FROM pg_catalog.pg_tables", options), {
    code: "VES_POSTGRES_CATALOG_DENIED"
  });
});

test("unknown catalog relation is denied even for introspection", () => {
  assert.throws(
    () =>
      parsePostgreSqlReadOperation("SELECT * FROM pg_catalog.pg_authid", {
        ...options,
        kind: "introspect"
      }),
    { code: "VES_POSTGRES_CATALOG_DENIED" }
  );
});

test("parameter count mismatch fails before connection execution", async () => {
  const fixture = await postgresFixture({ sql: "SELECT id FROM public.orders WHERE status = $1", parameters: [] });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_POSTGRES_PARAMETERS_INVALID" });
  assert.equal(fixture.connection.streamCalls, 0);
});

test("malformed protected JSON fails without leaking its content", async () => {
  const fixture = await postgresFixture();
  fixture.parameters.set(fixture.plan.operation.protectedRequestRef, new TextEncoder().encode('{"password":"secret"'));
  await assert.rejects(fixture.supervisor.execute(), {
    code: "VES_POSTGRES_REQUEST_INVALID",
    message: "Protected PostgreSQL request is invalid"
  });
});
