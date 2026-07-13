import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import { adapter, operation, policy, registration, request } from "../helpers/database-probe-fixture.mjs";

async function planner(reg = registration()) {
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(reg);
  return new ProbePlanner({ registry, adapters: [adapter(reg.engine)] });
}

for (const [label, field, values] of [
  [
    "objects",
    "objects",
    [
      { schema: "analytics", name: "order_totals", type: "view" },
      { schema: "public", name: "orders", type: "table" }
    ]
  ],
  ["functions", "functions", ["sum", "count", "avg"]],
  ["parameter classifications", "parameterClassifications", ["restricted", "internal", "confidential"]]
]) {
  test(`plan digest is invariant to ${label} order`, async () => {
    const subject = await planner();
    const first = await subject.plan(request({ operation: operation({ [field]: values }) }), policy());
    const second = await subject.plan(request({ operation: operation({ [field]: [...values].reverse() }) }), policy());
    assert.equal(first.planDigest, second.planDigest);
  });
}

for (const [field, value] of [
  ["timeoutMs", 1],
  ["timeoutMs", 5_000],
  ["rowLimit", 1],
  ["rowLimit", 1_000],
  ["byteLimit", 1],
  ["byteLimit", 1_000_000],
  ["concurrencyLimit", 1],
  ["concurrencyLimit", 2]
]) {
  test(`${field} accepts exact policy boundary ${value}`, async () => {
    const subject = await planner();
    const input = request({ bounds: { ...request().bounds, [field]: value } });
    assert.equal((await subject.plan(input, policy())).bounds[field], value);
  });
}

test("every supported engine has one neutral planner route", async () => {
  for (const engine of ["postgresql", "mysql", "mariadb", "sqlserver", "oracle", "sqlite", "mongodb"]) {
    const subject = await planner(registration({ engine }));
    assert.equal((await subject.plan(request(), policy())).engine, engine);
  }
});

test("changing a bound field changes the plan digest", async () => {
  const subject = await planner();
  const first = await subject.plan(request(), policy());
  const second = await subject.plan(request({ grantRef: "capability-grant-002" }), policy());
  assert.notEqual(first.planDigest, second.planDigest);
});
