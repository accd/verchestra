import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMongoDbReadOperation } from "../../packages/data-probe/src/mongodb-adapter.ts";
import { parseMySqlFamilyReadOperation } from "../../packages/data-probe/src/mysql-family-adapter.ts";
import { parseOracleReadOperation } from "../../packages/data-probe/src/oracle-adapter.ts";
import { parsePostgreSqlReadOperation } from "../../packages/data-probe/src/postgresql-adapter.ts";
import { parseSapAseReadOperation } from "../../packages/data-probe/src/sap-ase-adapter.ts";
import { parseSqliteReadOperation } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { parseSqlServerReadOperation } from "../../packages/data-probe/src/sqlserver-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { findCommand } from "../helpers/mongodb-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const longName = "a".repeat(70);

// One entry per SQL engine: its parser, its error-code prefix, a valid
// statement with one bind, and a statement whose object identity is too long
// when the engine checks it.
const engines = [
  {
    name: "Oracle",
    prefix: "VES_ORACLE",
    parse: (sql, options) => parseOracleReadOperation(sql, options),
    valid: "SELECT id FROM sales.orders WHERE status = :p1"
  },
  {
    name: "SQLite",
    prefix: "VES_SQLITE",
    parse: (sql, options) => parseSqliteReadOperation(sql, options),
    valid: "SELECT id FROM main.orders WHERE status = ?"
  },
  {
    name: "MySQL",
    prefix: "VES_MYSQL_FAMILY",
    parse: (sql, options) => parseMySqlFamilyReadOperation(sql, { engine: "mysql", ...options }),
    valid: "SELECT id FROM public.orders WHERE status = ?",
    tooLong: `SELECT id FROM public.${longName}`
  },
  {
    name: "SQL Server",
    prefix: "VES_SQLSERVER",
    parse: (sql, options) => parseSqlServerReadOperation(sql, options),
    valid: "SELECT id FROM dbo.orders WHERE status = @p1"
  },
  {
    name: "PostgreSQL",
    prefix: "VES_POSTGRES",
    parse: (sql, options) => parsePostgreSqlReadOperation(sql, options),
    valid: "SELECT id FROM public.orders WHERE status = $1",
    tooLong: `SELECT id FROM public.${longName}`
  },
  {
    name: "SAP ASE",
    prefix: "VES_SAP_ASE",
    parse: (sql, options) => parseSapAseReadOperation(sql, options),
    valid: "SELECT id FROM dbo.orders WHERE status = ?"
  }
];

const options = (overrides = {}) => ({
  kind: "select",
  protectedRequestRef: ref,
  parameterClassifications: ["internal"],
  ...overrides
});

for (const engine of engines) {
  const code = (suffix) => `${engine.prefix}_${suffix}`;

  test(`${engine.name}: the valid statement parses to one table and one classification`, () => {
    const operation = engine.parse(engine.valid, options());
    assert.equal(operation.objects.length, 1);
    assert.equal(operation.objects[0].type, "table");
    assert.deepEqual(operation.parameterClassifications, ["internal"]);
  });

  for (const statement of [42, null, "", "S".repeat(131_073)])
    test(`${engine.name}: a statement that is not a bounded string is refused before any other check`, () =>
      assert.throws(() => engine.parse(statement, options({ protectedRequestRef: "bad", kind: "other" })), {
        code: code("REQUEST_INVALID"),
        message: /statement is invalid/u
      }));

  test(`${engine.name}: a non-ASCII statement with a comment is refused for its encoding first`, () =>
    assert.throws(() => engine.parse(`${engine.valid} -- é`, options()), { code: code("ENCODING_DENIED") }));

  test(`${engine.name}: a statement with a comment and a semicolon is refused for the comment first`, () =>
    assert.throws(() => engine.parse(`${engine.valid}; -- x`, options()), { code: code("COMMENT_DENIED") }));

  test(`${engine.name}: a statement check runs before the request reference check`, () =>
    assert.throws(() => engine.parse(`${engine.valid} /* x */`, options({ protectedRequestRef: "bad" })), {
      code: code("COMMENT_DENIED")
    }));

  test(`${engine.name}: an invalid request reference is refused before the classifications`, () =>
    assert.throws(
      () =>
        engine.parse(
          engine.valid,
          options({ protectedRequestRef: "protected-request:short", parameterClassifications: ["top"] })
        ),
      { code: code("REQUEST_INVALID"), message: /reference is invalid/u }
    ));

  for (const classifications of [["top-secret"], "internal", Array.from({ length: 65 }, () => "internal")])
    test(`${engine.name}: invalid parameter classifications are refused`, () =>
      assert.throws(() => engine.parse(engine.valid, options({ parameterClassifications: classifications })), {
        code: code("PARAMETERS_INVALID"),
        message: /classifications are invalid/u
      }));

  test(`${engine.name}: binds that do not match the classifications are refused`, () =>
    assert.throws(() => engine.parse(engine.valid, options({ parameterClassifications: [] })), {
      code: code("PARAMETERS_INVALID")
    }));

  if (engine.tooLong !== undefined)
    test(`${engine.name}: an object identifier longer than the engine allows is refused`, () =>
      assert.throws(() => engine.parse(engine.tooLong, options({ parameterClassifications: [] })), {
        code: code("OBJECT_INVALID"),
        message: /identity is invalid/u
      }));
}

test("MySQL family: an unknown engine is refused before the statement is read", () =>
  assert.throws(() => parseMySqlFamilyReadOperation(42, options({ engine: "percona" })), {
    code: "VES_MYSQL_FAMILY_ENGINE_INVALID"
  }));

test("Oracle: an unqualified non-catalog object is refused as an invalid object", () =>
  assert.throws(() => parseOracleReadOperation("SELECT id FROM orders", options({ parameterClassifications: [] })), {
    code: "VES_ORACLE_OBJECT_INVALID",
    message: /schema qualified/u
  }));

test("Oracle: an approved catalog view is refused outside introspection", () =>
  assert.throws(
    () => parseOracleReadOperation("SELECT table_name FROM all_tables", options({ parameterClassifications: [] })),
    {
      code: "VES_ORACLE_CATALOG_DENIED"
    }
  ));

test("Oracle: the SYS schema is refused", () =>
  assert.throws(() => parseOracleReadOperation("SELECT id FROM sys.obj$", options({ parameterClassifications: [] })), {
    code: "VES_ORACLE_CATALOG_DENIED",
    message: /system schema/u
  }));

test("SQLite: a catalog table other than sqlite_schema is refused", () =>
  assert.throws(
    () =>
      parseSqliteReadOperation(
        "SELECT name FROM main.sqlite_master",
        options({ kind: "introspect", parameterClassifications: [] })
      ),
    { code: "VES_SQLITE_CATALOG_DENIED" }
  ));

test("SQLite: a common table expression reference is not reported as an object", () => {
  const operation = parseSqliteReadOperation(
    "WITH recent AS (SELECT id FROM main.orders) SELECT count(*) FROM recent",
    options({ parameterClassifications: [] })
  );
  assert.deepEqual(operation.objects, [{ schema: "main", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["count"]);
});

test("SQLite: an object in an attached database is refused", () =>
  assert.throws(
    () => parseSqliteReadOperation("SELECT id FROM other.orders", options({ parameterClassifications: [] })),
    {
      code: "VES_SQLITE_DATABASE_CONTROL_DENIED",
      message: /main database/u
    }
  ));

const mongoOptions = (classifications = ["internal"]) => ({
  protectedRequestRef: ref,
  parameterClassifications: classifications
});

test("MongoDB: an $exists control with a boolean is accepted and recorded", () => {
  const operation = parseMongoDbReadOperation(
    findCommand({ filter: { status: { $eq: { $param: 0 } }, region: { $exists: true } } }),
    mongoOptions()
  );
  assert.deepEqual(operation.functions, ["eq", "exists"]);
});

test("MongoDB: an $exists control that is not a boolean is refused as a literal", () =>
  assert.throws(
    () => parseMongoDbReadOperation(findCommand({ filter: { region: { $exists: "yes" } } }), mongoOptions([])),
    {
      code: "VES_MONGODB_LITERAL_DENIED",
      message: /exists control/u
    }
  ));

for (const operands of [[], "status", Array.from({ length: 33 }, () => ({ status: { $exists: true } }))])
  test("MongoDB: a logical filter without a bounded operand list is refused", () =>
    assert.throws(() => parseMongoDbReadOperation(findCommand({ filter: { $and: operands } }), mongoOptions([])), {
      code: "VES_MONGODB_COMMAND_INVALID",
      message: /logical filter/u
    }));

test("MongoDB: a field outside the field grammar is refused before its condition is read", () =>
  assert.throws(
    () => parseMongoDbReadOperation(findCommand({ filter: { "Order-Status": "paid" } }), mongoOptions([])),
    {
      code: "VES_MONGODB_FIELD_DENIED"
    }
  ));

for (const condition of [{}, { $gt: 1, $gte: 1, $lt: 1, $lte: 1, $ne: 1 }])
  test("MongoDB: a field condition without one to four operators is refused", () =>
    assert.throws(() => parseMongoDbReadOperation(findCommand({ filter: { status: condition } }), mongoOptions([])), {
      code: "VES_MONGODB_COMMAND_INVALID",
      message: /field condition/u
    }));

test("MongoDB: an unapproved logical operator is refused before its operands are read", () =>
  assert.throws(() => parseMongoDbReadOperation(findCommand({ filter: { $nor: "status" } }), mongoOptions([])), {
    code: "VES_MONGODB_OPERATOR_DENIED"
  }));

test("MongoDB: nested logical filters record each operator", () => {
  const operation = parseMongoDbReadOperation(
    findCommand({ filter: { $or: [{ $and: [{ status: { $in: { $param: 0 } } }] }, { region: { $exists: false } }] } }),
    mongoOptions()
  );
  assert.deepEqual(operation.functions, ["and", "exists", "in", "or"]);
});

test("MongoDB: the command kind is checked before the database", () =>
  assert.throws(
    () =>
      parseMongoDbReadOperation({ kind: "mapReduce", database: "admin", collection: "system.users" }, mongoOptions([])),
    { code: "VES_MONGODB_SERVER_EXECUTION_DENIED" }
  ));

test("MongoDB: the database is checked before the collection", () =>
  assert.throws(
    () => parseMongoDbReadOperation(findCommand({ database: "admin", collection: "system.users" }), mongoOptions()),
    {
      code: "VES_MONGODB_DATABASE_DENIED"
    }
  ));

test("MongoDB: the collection is checked before the request reference", () =>
  assert.throws(
    () =>
      parseMongoDbReadOperation(findCommand({ collection: "system.users" }), {
        protectedRequestRef: "bad",
        parameterClassifications: ["internal"]
      }),
    { code: "VES_MONGODB_COLLECTION_DENIED" }
  ));

test("MongoDB: invalid parameter classifications are refused before the command body", () =>
  assert.throws(
    () => parseMongoDbReadOperation(findCommand({ filter: { status: "paid" } }), mongoOptions(["top-secret"])),
    {
      code: "VES_MONGODB_PARAMETERS_INVALID",
      message: /classifications are invalid/u
    }
  ));

test("MongoDB: explain requires the query planner verbosity", () =>
  assert.throws(
    () => parseMongoDbReadOperation(findCommand({ kind: "explain", verbosity: "executionStats" }), mongoOptions()),
    { code: "VES_MONGODB_COMMAND_INVALID", message: /verbosity/u }
  ));

test("MongoDB: introspection reads only the collections catalog", () => {
  const operation = parseMongoDbReadOperation(
    { kind: "introspect", database: "sales", collection: "collections_catalog" },
    mongoOptions([])
  );
  assert.deepEqual(operation.objects, [{ schema: "sales", name: "collections_catalog", type: "catalog" }]);
  assert.throws(
    () => parseMongoDbReadOperation({ kind: "introspect", database: "sales", collection: "orders" }, mongoOptions([])),
    { code: "VES_MONGODB_COLLECTION_DENIED" }
  );
});
