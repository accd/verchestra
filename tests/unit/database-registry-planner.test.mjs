import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import { adapter, policy, registration, request, workspaceId } from "../helpers/database-probe-fixture.mjs";

async function fixture(reg = registration(), engineAdapter = adapter()) {
  const store = new MemoryDatabaseRegistrationStore();
  const registry = new DatabaseRegistry({ store });
  await registry.register(reg);
  return { store, registry, engineAdapter, planner: new ProbePlanner({ registry, adapters: [engineAdapter] }) };
}

test("registration is canonical, sorted, immutable, and content addressed", async () => {
  const { registry } = await fixture(registration({ approvedSchemas: ["public", "analytics", "public"] }));
  const saved = await registry.resolve(workspaceId, "orders-production");
  assert.deepEqual(saved.approvedSchemas, ["analytics", "public"]);
  assert.match(saved.registrationDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(saved), true);
});

test("identical registration is idempotent", async () => {
  const store = new MemoryDatabaseRegistrationStore();
  const registry = new DatabaseRegistry({ store });
  assert.equal((await registry.register(registration())).created, true);
  assert.equal((await registry.register(registration())).created, false);
});

test("different content cannot overwrite a registered database identity", async () => {
  const { registry } = await fixture();
  await assert.rejects(registry.register(registration({ classification: "restricted" })), {
    code: "VES_DATABASE_REGISTRATION_CONFLICT"
  });
});

test("multiple databases coexist within one Workspace", async () => {
  const { registry } = await fixture();
  await registry.register(registration({ databaseId: "ledger", logicalCredentialName: "database.ledger.readonly" }));
  assert.equal((await registry.list(workspaceId)).length, 2);
});

test("same logical database identity is isolated by Workspace", async () => {
  const store = new MemoryDatabaseRegistrationStore();
  const registry = new DatabaseRegistry({ store });
  const other = "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab";
  await registry.register(registration());
  await registry.register(registration({ workspaceId: other }));
  assert.equal((await registry.list(workspaceId)).length, 1);
  assert.equal((await registry.list(other)).length, 1);
});

test("planner emits an engine-neutral content-addressed read plan", async () => {
  const { planner } = await fixture();
  const plan = await planner.plan(request(), policy());
  assert.equal(plan.engine, "postgresql");
  assert.deepEqual(plan.requiredIdentityChecks, ["database-principal-read-only", "engine-session-read-only"]);
  assert.equal(plan.logicalCredentialName, "database.orders.readonly");
  assert.match(plan.planDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("planner preserves classifications but no parameter values", async () => {
  const { planner } = await fixture();
  const plan = await planner.plan(request(), policy());
  assert.deepEqual(plan.operation.parameterClassifications, ["internal"]);
  assert.equal(JSON.stringify(plan).includes("parameterValue"), false);
});

test("planner binds purpose, policy, grant, database, and Workspace", async () => {
  const { planner } = await fixture();
  const plan = await planner.plan(request(), policy());
  assert.deepEqual(
    [plan.workspaceId, plan.databaseId, plan.purpose, plan.policyRef, plan.grantRef],
    [workspaceId, "orders-production", "schema-discovery", "policy.database.orders", "capability-grant-001"]
  );
});

test("introspection is a normalized read operation", async () => {
  const { planner } = await fixture();
  const input = request({ operation: { ...request().operation, kind: "introspect", functions: [] } });
  assert.equal((await planner.plan(input, policy())).operation.kind, "introspect");
});

test("adapter violations fail before a plan is returned", async () => {
  const engine = adapter("postgresql", [{ code: "ENGINE_OBJECT_DENIED", message: "Engine object is denied" }]);
  const { planner } = await fixture(registration(), engine);
  await assert.rejects(planner.plan(request(), policy()), { code: "VES_PROBE_ENGINE_POLICY_DENIED" });
  assert.equal(engine.calls, 1);
});

test("policy reference must match registration", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request(), policy({ policyRef: "policy.database.other" })), {
    code: "VES_PROBE_POLICY_MISMATCH"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("purpose must be registered", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request({ purpose: "customer-export" }), policy()), {
    code: "VES_PROBE_PURPOSE_DENIED"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("unknown database is rejected", async () => {
  const { planner, engineAdapter } = await fixture();
  await assert.rejects(planner.plan(request({ databaseId: "missing" }), policy()), {
    code: "VES_DATABASE_NOT_FOUND"
  });
  assert.equal(engineAdapter.calls, 0);
});

test("missing engine adapter is rejected", async () => {
  const { registry } = await fixture();
  const planner = new ProbePlanner({ registry, adapters: [] });
  await assert.rejects(planner.plan(request(), policy()), { code: "VES_PROBE_ENGINE_UNAVAILABLE" });
});

test("adapter engine identity is exact", async () => {
  const { registry } = await fixture();
  assert.throws(() => new ProbePlanner({ registry, adapters: [adapter("mysql"), adapter("mysql")] }), {
    code: "VES_PROBE_ADAPTER_INVALID"
  });
});

test("plan objects and functions are canonicalized", async () => {
  const { planner } = await fixture();
  const input = request({
    operation: {
      ...request().operation,
      objects: [
        { schema: "public", name: "orders", type: "table" },
        { schema: "public", name: "orders", type: "table" }
      ],
      functions: ["COUNT", "count"]
    }
  });
  const plan = await planner.plan(input, policy());
  assert.deepEqual(plan.operation.functions, ["count"]);
  assert.equal(plan.operation.objects.length, 1);
});

test("empty operation functions are accepted", async () => {
  const { planner } = await fixture();
  const input = request({ operation: { ...request().operation, functions: [] } });
  assert.deepEqual((await planner.plan(input, policy())).operation.functions, []);
});

test("non-production plans retain both defense-in-depth identity checks", async () => {
  const { planner } = await fixture(registration({ production: false, logicalEnvironment: "development" }));
  assert.equal((await planner.plan(request(), policy())).requiredIdentityChecks.length, 2);
});
