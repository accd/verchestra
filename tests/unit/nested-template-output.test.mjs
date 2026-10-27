import assert from "node:assert/strict";
import { test } from "node:test";

import { contextRecipe, stableUuid } from "../../apps/vestra-cli/src/task/task-context.ts";
import { verifierPrompt } from "../../apps/vestra-cli/src/task/task-codex.ts";
import { assertNoNetworkAttempts } from "../../packages/application/src/self-test/self-test.ts";
import { explainDecision } from "../../packages/policy/src/index.ts";
import { view } from "../helpers/policy-fixture.mjs";

// These pin the exact text that template literals used to build by nesting one
// template inside another (SonarCloud S4624): flattening them must not change
// a byte of what they render.

const decision = (verdict, determiningPolicies) => ({
  decision: verdict,
  code: verdict === "allow" ? "VES_POLICY_ALLOW" : "VES_POLICY_FORBID_DENY",
  explanation: "evaluated",
  determiningPolicies
});

test("a policy explanation summary names its determining policies by verdict", () => {
  const unnamed = view({ layers: {} });
  const summary = (verdict, policies) => explainDecision(decision(verdict, policies), unnamed).summary;
  assert.equal(summary("allow", []), "allowed: evaluated");
  assert.equal(summary("allow", ["org.p1", "team.p2"]), "allowed: evaluated (org.p1, team.p2)");
  assert.equal(summary("deny", []), "denied: evaluated");
  assert.equal(
    summary("deny", ["org.p1", "team.p2"]),
    "denied: evaluated (unknown policy org.p1, unknown policy team.p2)"
  );
});

test("a refused self-test network attempt lists every intercepted target", () => {
  assert.doesNotThrow(() => assertNoNetworkAttempts([]));
  assert.throws(
    () =>
      assertNoNetworkAttempts([
        { api: "fetch", target: "a.example:443" },
        { api: "net.connect", target: "b.example:80" }
      ]),
    (error) =>
      error.code === "VES_SELFTEST_NETWORK_ATTEMPT" &&
      error.message.includes(
        "self-test scenario attempted a network connection: fetch a.example:443, net.connect b.example:80"
      )
  );
});

test("a context recipe derives every identifier from the run and its parts", () => {
  const recipe = contextRecipe("run-1", {
    task: { taskId: "T1", changeScope: ["src", "docs"] },
    sourceRevision: "abc123"
  });
  assert.equal(recipe.recipeId, `recipe_${stableUuid("run-1:recipe")}`);
  assert.equal(recipe.taskId, `task_${stableUuid("run-1:T1")}`);
  assert.deepEqual(
    recipe.requiredSources.map((source) => source.selectorId),
    [
      `selector_${stableUuid("run-1:task-request")}`,
      `selector_${stableUuid("run-1:scope:src")}`,
      `selector_${stableUuid("run-1:scope:docs")}`
    ]
  );
});

test("a verifier prompt lists each done criterion as a bullet", () => {
  const prompt = verifierPrompt(
    {
      task: {
        taskId: "T1",
        expectedCommitBoundary: "one change",
        requirementIds: ["R-1", "R-2"],
        doneCriteria: ["tests pass", "docs updated"]
      }
    },
    "",
    "c0ffee"
  );
  assert.ok(prompt.includes("\n\nRequirements: R-1, R-2\n\nDone criteria:\n- tests pass\n- docs updated\n\n"));
});
