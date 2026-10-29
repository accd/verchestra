// invariant: every engine parser classifies each bind, so the planner keeps one
// classification per bind, sorted, and does not drop a repeated one
// (.specs/features/probe-multi-parameter/checks.md C1, C2). A plan with zero or
// one bind is the plan it was before, so its digests do not move.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import { adapter, operation, policy, registration, request } from "../helpers/database-probe-fixture.mjs";
import { sqliteFixture } from "../helpers/sqlite-probe-fixture.mjs";

async function planWith(parameterClassifications) {
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(registration());
  const planner = new ProbePlanner({ registry, adapters: [adapter()] });
  return planner.plan(request({ operation: operation({ parameterClassifications }) }), policy());
}

test("the planner keeps one classification per bind", async () => {
  assert.deepEqual((await planWith(["internal", "internal"])).operation.parameterClassifications, [
    "internal",
    "internal"
  ]);
  assert.deepEqual((await planWith(["public", "internal", "public"])).operation.parameterClassifications, [
    "internal",
    "public",
    "public"
  ]);
  await assert.rejects(planWith(["internal", "private"]), { code: "VES_PROBE_OPERATION_INVALID" });
});

test("plans with zero or one bind keep their digests", async () => {
  const one = await sqliteFixture();
  assert.equal(
    one.plan.statementFingerprint,
    "sha256:8cadb74e0584b94a15a7449dc159b69a53b00fe054cf9ba24be7590062adb428"
  );
  assert.equal(one.plan.planDigest, "sha256:ad1cadf015b572df1fb2760677c4e65e54f8ddd0c5838ef05c0832214f4036c3");
  const zero = await sqliteFixture({ sql: "SELECT count(*) FROM main.orders", parameterClassifications: [] });
  assert.equal(
    zero.plan.statementFingerprint,
    "sha256:162ccb5ea28fcc9f584822ea6053f995f97f983a7112d5b70fd85982648b09ad"
  );
  assert.equal(zero.plan.planDigest, "sha256:5617095ad7ff2c67c444f773257ac94283e248a64025358772a1dc3e16ca66bb");
});
