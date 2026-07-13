import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import { adapter, operation, policy, registration, request, workspaceId } from "../helpers/database-probe-fixture.mjs";

async function fixture(reg = registration()) {
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(reg);
  const engineAdapter = adapter(reg.engine);
  return { registry, engineAdapter, planner: new ProbePlanner({ registry, adapters: [engineAdapter] }) };
}

for (const field of ["credentialValue", "connectionString", "password", "url"]) {
  test(`registration rejects secret-bearing field ${field}`, async () => {
    const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
    await assert.rejects(registry.register({ ...registration(), [field]: "postgres://admin:secret@host/db" }), {
      code: "VES_DATABASE_REGISTRATION_INVALID"
    });
  });
}

for (const engine of ["unknown", "postgres", "sql-server", "redis"]) {
  test(`registration rejects unknown engine ${engine}`, async () => {
    const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
    await assert.rejects(registry.register(registration({ engine })), { code: "VES_DATABASE_ENGINE_UNSUPPORTED" });
  });
}

test("raw SQL is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(
    planner.plan(request({ operation: { ...operation(), sql: "SELECT 1; DROP TABLE orders" } }), policy()),
    { code: "VES_PROBE_OPERATION_INVALID" }
  );
  assert.equal(engineAdapter.calls, 0);
});

test("multi-statement operation is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request({ operation: operation({ statementCount: 2 }) }), policy()), {
    code: "VES_PROBE_MULTI_STATEMENT_DENIED"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("write operation is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request({ operation: operation({ kind: "update" }) }), policy()), {
    code: "VES_PROBE_WRITE_DENIED"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("unapproved schema is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  const hostile = operation({ objects: [{ schema: "private", name: "users", type: "table" }] });
  await assert.rejects(planner.plan(request({ operation: hostile }), policy()), { code: "VES_PROBE_SCHEMA_DENIED" });
  assert.equal(engineAdapter.calls, 0);
});

test("unapproved object is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  const hostile = operation({ objects: [{ schema: "public", name: "users", type: "table" }] });
  await assert.rejects(planner.plan(request({ operation: hostile }), policy()), { code: "VES_PROBE_OBJECT_DENIED" });
  assert.equal(engineAdapter.calls, 0);
});

test("catalog access is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  const hostile = operation({ objects: [{ schema: "public", name: "pg_catalog", type: "catalog" }] });
  await assert.rejects(planner.plan(request({ operation: hostile }), policy()), { code: "VES_PROBE_CATALOG_DENIED" });
  assert.equal(engineAdapter.calls, 0);
});

test("denied function is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request({ operation: operation({ functions: ["pg_read_file"] }) }), policy()), {
    code: "VES_PROBE_FUNCTION_DENIED"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("unknown function is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request({ operation: operation({ functions: ["mystery"] }) }), policy()), {
    code: "VES_PROBE_FUNCTION_DENIED"
  });
  assert.equal(engineAdapter.calls, 0);
});

for (const [field, value] of [
  ["timeoutMs", 5_001],
  ["rowLimit", 1_001],
  ["byteLimit", 1_000_001],
  ["concurrencyLimit", 3],
  ["timeoutMs", 0],
  ["rowLimit", -1]
]) {
  test(`${field} bound ${value} is rejected before engine validation`, async () => {
    const { planner, engineAdapter } = await fixture();
    await assert.rejects(planner.plan(request({ bounds: { ...request().bounds, [field]: value } }), policy()), {
      code: "VES_PROBE_BOUNDS_DENIED"
    });
    assert.equal(engineAdapter.calls, 0);
  });
}

test("cross-Workspace request is rejected before engine validation", async () => {
  const { planner, engineAdapter } = await fixture();
  const other = "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab";
  await assert.rejects(planner.plan(request({ workspaceId: other }), policy()), { code: "VES_DATABASE_NOT_FOUND" });
  assert.equal(engineAdapter.calls, 0);
});

test("credential logical name remains metadata and no value reaches the adapter", async () => {
  const seen = [];
  const engineAdapter = {
    engine: "postgresql",
    validateNormalizedOperation(op, reg) {
      seen.push(JSON.stringify([op, reg]));
      return [];
    }
  };
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration());
  const planner = new ProbePlanner({ registry, adapters: [engineAdapter] });
  await planner.plan(request(), policy());
  assert.equal(seen.join("").includes("credential-value"), false);
});

test("protected request reference cannot be a path or inline statement", async () => {
  const { planner, engineAdapter } = await fixture();
  for (const protectedRequestRef of ["../query.sql", "SELECT * FROM users", "C:\\query.sql"])
    await assert.rejects(planner.plan(request({ operation: operation({ protectedRequestRef }) }), policy()), {
      code: "VES_PROBE_OPERATION_INVALID"
    });
  assert.equal(engineAdapter.calls, 0);
});

test("hostile object identifiers are rejected", async () => {
  const { planner, engineAdapter } = await fixture();
  const hostile = operation({ objects: [{ schema: "public", name: "orders;drop", type: "table" }] });
  await assert.rejects(planner.plan(request({ operation: hostile }), policy()), {
    code: "VES_PROBE_OPERATION_INVALID"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("registration serialization contains logical binding but no credential material", async () => {
  const { registry } = await fixture();
  const serialized = JSON.stringify(await registry.resolve(workspaceId, "orders-production"));
  assert.equal(serialized.includes("database.orders.readonly"), true);
  for (const prohibited of ["connectionString", "credentialValue", "password", "postgres://"])
    assert.equal(serialized.includes(prohibited), false);
});
