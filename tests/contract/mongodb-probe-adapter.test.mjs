import assert from "node:assert/strict";
import { test } from "node:test";
import { MongoDbProbeAdapter, parseMongoDbReadOperation } from "../../packages/data-probe/src/mongodb-adapter.ts";
import { request } from "../helpers/database-probe-fixture.mjs";
import { findCommand, mongoDbFixture } from "../helpers/mongodb-probe-fixture.mjs";

const ref = request().operation.protectedRequestRef;
const parse = (command, classifications = []) =>
  parseMongoDbReadOperation(command, { protectedRequestRef: ref, parameterClassifications: classifications });

test("MongoDB normalizes a parameterized find without values", () => {
  const operation = parse(findCommand(), ["internal"]);
  assert.deepEqual(operation.objects, [{ schema: "sales", name: "orders", type: "table" }]);
  assert.deepEqual(operation.functions, ["eq"]);
  assert.equal(JSON.stringify(operation).includes("paid"), false);
});
test("MongoDB normalizes a closed aggregate pipeline", () => {
  const operation = parse(
    {
      kind: "aggregate",
      database: "sales",
      collection: "orders",
      pipeline: [
        { $match: { status: { $eq: { $param: 0 } } } },
        { $project: { _id: 1, status: 1 } },
        { $sort: { _id: 1 } },
        { $limit: 10 }
      ]
    },
    ["internal"]
  );
  assert.deepEqual(operation.functions, ["eq", "limit", "match", "project", "sort"]);
});
test("MongoDB normalizes explain as a bounded read", () => {
  const operation = parse({ ...findCommand(), kind: "explain", verbosity: "queryPlanner" }, ["internal"]);
  assert.equal(operation.kind, "select");
});
test("MongoDB normalizes collection introspection", () => {
  const operation = parse({ kind: "introspect", database: "sales", collection: "collections_catalog" });
  assert.deepEqual(operation.objects, [{ schema: "sales", name: "collections_catalog", type: "catalog" }]);
});
test("MongoDB handshake binds exact component and read capability", async () => {
  const f = await mongoDbFixture();
  const h = await f.worker.handshake();
  assert.deepEqual(h.component, MongoDbProbeAdapter.component);
  assert.deepEqual(h.capabilities, ["database-read"]);
});
test("MongoDB verifies exact scoped read role evidence", async () => {
  const f = await mongoDbFixture();
  const e = await f.worker.verifyIdentity(f.plan);
  assert.equal(e.principalReadOnly, true);
  assert.equal(e.product, "mongodb");
  assert.match(e.principalFingerprint, /^sha256:/u);
});
test("MongoDB configures typed bounded read execution", async () => {
  const f = await mongoDbFixture();
  const e = await f.worker.configureReadOnlySession(f.plan);
  assert.deepEqual([e.sessionReadOnly, e.transactionReadOnly], [true, true]);
  assert.deepEqual(f.connection.controls, {
    typedReadSurface: true,
    genericCommandDisabled: true,
    readConcern: "majority",
    maxTimeMS: 2000,
    batchSize: 100,
    noCursorTimeout: false
  });
});
test("MongoDB streams documents through T41", async () => {
  const f = await mongoDbFixture({ connection: { rows: [{ id: 1 }, { id: 2 }] } });
  const result = await f.supervisor.execute();
  assert.deepEqual([result.status, result.rowCount], ["complete", 2]);
});
test("MongoDB rejects a protected command that differs from plan", async () => {
  const f = await mongoDbFixture();
  f.parameters.set(
    f.plan.operation.protectedRequestRef,
    new TextEncoder().encode(
      JSON.stringify({ schemaVersion: 1, command: findCommand({ collection: "other" }), parameters: ["paid"] })
    )
  );
  await assert.rejects(f.supervisor.execute(), { code: "VES_MONGODB_PLAN_MISMATCH" });
  assert.equal(f.connection.streamCalls, 0);
});
test("MongoDB cancellation and termination delegate", async () => {
  const f = await mongoDbFixture();
  await f.worker.cancel();
  await f.worker.terminate();
  assert.deepEqual([f.connection.cancelled, f.connection.terminated], [true, true]);
});
