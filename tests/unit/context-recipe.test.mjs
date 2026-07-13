import assert from "node:assert/strict";
import { test } from "node:test";
import { ContextSnapshotResolver, ContextSourceError } from "../../packages/agent-runtime/src/index.ts";
import {
  digest,
  evaluatedAt,
  ports,
  recipe,
  selector,
  stable,
  workspaceId
} from "../helpers/context-source-fixture.mjs";

function resolver(sourcePorts = ports()) {
  return new ContextSnapshotResolver({ digest, sources: sourcePorts });
}

const invalidRecipes = [
  ["schema", { schemaVersion: 2 }],
  ["recipe id", { recipeId: "recipe-bad" }],
  ["task id", { taskId: "task-bad" }],
  ["no required sources", { requiredSources: [] }],
  ["duplicate selector", { optionalSources: [selector("repository", 11)] }],
  ["unsupported kind", { requiredSources: [selector("database", 21)] }],
  ["unsafe source id", { requiredSources: [selector("repository", 21, { sourceId: "bad source" })] }],
  ["empty query", { requiredSources: [selector("repository", 21, { query: {} })] }],
  ["zero max age", { requiredSources: [selector("repository", 21, { maximumAgeSeconds: 0 })] }],
  ["bad classification", { requiredSources: [selector("repository", 21, { classification: "private" })] }],
  ["empty obligation", { semanticObligations: [""] }],
  ["duplicate obligation", { semanticObligations: ["same", "same"] }],
  ["invalid budget", { priorityBudgets: [{ priority: "mandatory", maximumTokens: -1 }] }],
  [
    "duplicate budget",
    {
      priorityBudgets: [
        { priority: "mandatory", maximumTokens: 1 },
        { priority: "mandatory", maximumTokens: 2 }
      ]
    }
  ],
  ["bad freshness", { freshnessPolicy: { defaultMaximumAgeSeconds: 0 } }],
  ["bad trust ref", { trustPolicyRef: "bad ref" }],
  ["bad purpose", { egressPurpose: "bad purpose" }]
];

for (const [name, override] of invalidRecipes) {
  test(`recipe rejects ${name}`, async () => {
    await assert.rejects(
      resolver().resolve({ workspaceId, recipe: recipe(override), evaluatedAt }),
      (error) => error instanceof ContextSourceError && error.code === "VES_CONTEXT_RECIPE_INVALID"
    );
  });
}

test("canonical recipe digest is independent of selector and query-key ordering", async () => {
  const left = recipe();
  const right = recipe({
    requiredSources: [...left.requiredSources].reverse().map((entry) => ({
      ...entry,
      query: { terms: entry.query.terms, scope: entry.query.scope }
    })),
    optionalSources: [...left.optionalSources].reverse()
  });
  const [a, b] = await Promise.all([
    resolver().resolve({ workspaceId, recipe: left, evaluatedAt }),
    resolver().resolve({ workspaceId, recipe: right, evaluatedAt })
  ]);
  assert.equal(a.recipeDigest, b.recipeDigest);
  assert.equal(a.snapshotId, b.snapshotId);
});

test("resolved snapshots and their nested collections are immutable", async () => {
  const result = await resolver().resolve({ workspaceId, recipe: recipe(), evaluatedAt });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.sources), true);
  assert.equal(Object.isFrozen(result.sources[0].fragments), true);
  assert.equal(Object.isFrozen(result.sources[0].fragments[0].source), true);
  assert.throws(() => result.sources.push({}), TypeError);
});

test("workspace identity must be canonical", async () => {
  await assert.rejects(
    resolver().resolve({ workspaceId: stable("project", 99), recipe: recipe(), evaluatedAt }),
    (error) => error.code === "VES_CONTEXT_RECIPE_INVALID"
  );
});
