import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMongoDbReadOperation } from "../../packages/data-probe/src/mongodb-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { findCommand, mongoDbFixture } from "../helpers/mongodb-probe-fixture.mjs";

const options = { protectedRequestRef: request().operation.protectedRequestRef, parameterClassifications: [] };
for (const [label, command, code] of [
  ["insert", { kind: "insert", database: "sales", collection: "orders" }, "VES_MONGODB_WRITE_DENIED"],
  ["update", { kind: "update", database: "sales", collection: "orders" }, "VES_MONGODB_WRITE_DENIED"],
  ["delete", { kind: "delete", database: "sales", collection: "orders" }, "VES_MONGODB_WRITE_DENIED"],
  ["replace", { kind: "replace", database: "sales", collection: "orders" }, "VES_MONGODB_WRITE_DENIED"],
  ["findAndModify", { kind: "findAndModify", database: "sales", collection: "orders" }, "VES_MONGODB_WRITE_DENIED"],
  ["bulkWrite", { kind: "bulkWrite", database: "sales", collection: "orders" }, "VES_MONGODB_WRITE_DENIED"],
  ["mapReduce", { kind: "mapReduce", database: "sales", collection: "orders" }, "VES_MONGODB_SERVER_EXECUTION_DENIED"],
  [
    "$out",
    { kind: "aggregate", database: "sales", collection: "orders", pipeline: [{ $out: "other" }] },
    "VES_MONGODB_WRITE_DENIED"
  ],
  [
    "$merge",
    { kind: "aggregate", database: "sales", collection: "orders", pipeline: [{ $merge: "other" }] },
    "VES_MONGODB_WRITE_DENIED"
  ],
  ["$where", findCommand({ filter: { $where: { $param: 0 } } }), "VES_MONGODB_SERVER_EXECUTION_DENIED"],
  [
    "$function",
    {
      kind: "aggregate",
      database: "sales",
      collection: "orders",
      pipeline: [{ $project: { value: { $function: { $param: 0 } } } }]
    },
    "VES_MONGODB_SERVER_EXECUTION_DENIED"
  ],
  [
    "$accumulator",
    {
      kind: "aggregate",
      database: "sales",
      collection: "orders",
      pipeline: [{ $project: { value: { $accumulator: { $param: 0 } } } }]
    },
    "VES_MONGODB_SERVER_EXECUTION_DENIED"
  ],
  [
    "$lookup",
    { kind: "aggregate", database: "sales", collection: "orders", pipeline: [{ $lookup: {} }] },
    "VES_MONGODB_STAGE_DENIED"
  ],
  [
    "$unionWith",
    { kind: "aggregate", database: "sales", collection: "orders", pipeline: [{ $unionWith: "other" }] },
    "VES_MONGODB_STAGE_DENIED"
  ],
  [
    "$graphLookup",
    { kind: "aggregate", database: "sales", collection: "orders", pipeline: [{ $graphLookup: {} }] },
    "VES_MONGODB_STAGE_DENIED"
  ],
  [
    "$changeStream",
    { kind: "aggregate", database: "sales", collection: "orders", pipeline: [{ $changeStream: {} }] },
    "VES_MONGODB_STAGE_DENIED"
  ],
  ["$expr", findCommand({ filter: { $expr: { $param: 0 } } }), "VES_MONGODB_OPERATOR_DENIED"],
  ["$regex", findCommand({ filter: { status: { $regex: { $param: 0 } } } }), "VES_MONGODB_OPERATOR_DENIED"],
  ["$text", findCommand({ filter: { $text: { $param: 0 } } }), "VES_MONGODB_OPERATOR_DENIED"],
  ["$jsonSchema", findCommand({ filter: { $jsonSchema: { $param: 0 } } }), "VES_MONGODB_OPERATOR_DENIED"],
  ["raw string", findCommand({ filter: { status: "paid" } }), "VES_MONGODB_LITERAL_DENIED"],
  ["raw array", findCommand({ filter: { status: ["paid"] } }), "VES_MONGODB_LITERAL_DENIED"],
  ["admin database", findCommand({ database: "admin" }), "VES_MONGODB_DATABASE_DENIED"],
  ["local database", findCommand({ database: "local" }), "VES_MONGODB_DATABASE_DENIED"],
  ["config database", findCommand({ database: "config" }), "VES_MONGODB_DATABASE_DENIED"],
  ["system collection", findCommand({ collection: "system.users" }), "VES_MONGODB_COLLECTION_DENIED"],
  ["dollar collection", findCommand({ collection: "$cmd" }), "VES_MONGODB_COLLECTION_DENIED"],
  ["unknown command key", { ...findCommand(), bypassDocumentValidation: true }, "VES_MONGODB_COMMAND_INVALID"]
])
  test(`MongoDB denies ${label}`, () => assert.throws(() => parseMongoDbReadOperation(command, options), { code }));

test("MongoDB denies non-contiguous parameter references", () =>
  assert.throws(
    () =>
      parseMongoDbReadOperation(findCommand({ filter: { status: { $eq: { $param: 1 } } } }), {
        ...options,
        parameterClassifications: ["internal", "internal"]
      }),
    { code: "VES_MONGODB_PARAMETERS_INVALID" }
  ));
test("MongoDB denies unapproved database through planner", async () =>
  await assert.rejects(mongoDbFixture({ command: findCommand({ database: "other" }) }), {
    code: "VES_PROBE_SCHEMA_DENIED"
  }));
test("MongoDB denies unapproved collection through planner", async () =>
  await assert.rejects(mongoDbFixture({ command: findCommand({ collection: "secret" }) }), {
    code: "VES_PROBE_OBJECT_DENIED"
  }));
test("MongoDB malformed protected request is sanitized", async () => {
  const f = await mongoDbFixture();
  f.parameters.set(f.plan.operation.protectedRequestRef, new TextEncoder().encode("not-json"));
  await assert.rejects(f.supervisor.execute(), { code: "VES_MONGODB_REQUEST_INVALID" });
  assert.equal(f.connection.streamCalls, 0);
});
