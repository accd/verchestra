// invariant: the Flow of .specs/features/database-registration/plan.md. A
// Workspace registration's access policy is validated by the one normalizer
// the probe planner applies, exported as normalizeDatabaseAccessPolicy, so
// `vestra database add` accepts exactly the policies a probe plan would.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as dataProbe from "../../packages/data-probe/src/index.ts";
import { adapter, policy, registration, request } from "../helpers/database-probe-fixture.mjs";

function refusalOf(run) {
  try {
    const result = run();
    if (result instanceof Promise)
      return result.then(
        () => undefined,
        (error) => error.code
      );
    return undefined;
  } catch (error) {
    return error.code;
  }
}

test("the planner normalizes its policy with the exported function", async () => {
  assert.equal(typeof dataProbe.normalizeDatabaseAccessPolicy, "function");
  const store = new dataProbe.MemoryDatabaseRegistrationStore();
  const registry = new dataProbe.DatabaseRegistry({ store });
  await registry.register(registration());
  const planner = new dataProbe.ProbePlanner({ registry, adapters: [adapter()] });
  const cases = [
    ["a valid policy", policy(), undefined],
    ["maxRows 0", policy({ maxRows: 0 }), "VES_PROBE_POLICY_INVALID"],
    ["an extra key", { ...policy(), maxColumns: 10 }, "VES_PROBE_POLICY_INVALID"],
    ["no allowed object", policy({ allowedObjects: [] }), "VES_PROBE_POLICY_INVALID"]
  ];
  for (const [label, candidate, expected] of cases) {
    const normalizer = await refusalOf(() => dataProbe.normalizeDatabaseAccessPolicy(candidate));
    const planner_ = await refusalOf(() => planner.plan(request(), candidate));
    assert.equal(normalizer, expected, `normalizer: ${label}`);
    // why: the planner refuses with the policy code exactly where the
    // exported normalizer does, and plans where it accepts.
    assert.equal(planner_, expected, `planner: ${label}`);
  }
  const normalized = dataProbe.normalizeDatabaseAccessPolicy(policy({ allowedFunctions: ["sum", "avg", "avg"] }));
  assert.deepEqual(normalized.allowedFunctions, ["avg", "sum"]);
  assert.ok(Object.isFrozen(normalized));
  const plan = await planner.plan(request(), policy());
  assert.equal(plan.policyRef, dataProbe.normalizeDatabaseAccessPolicy(policy()).policyRef);
});
