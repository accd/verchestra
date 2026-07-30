import assert from "node:assert/strict";
import { test } from "node:test";
import { DeterministicContextCompiler } from "../../packages/agent-runtime/src/index.ts";
import {
  compileInput,
  compilerFixture,
  compilerRecipe,
  manyFragments,
  snapshotFixture
} from "../helpers/context-compiler-fixture.mjs";

function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) =>
    permutations(values.filter((_, candidate) => candidate !== index)).map((tail) => [value, ...tail])
  );
}

for (const [index, order] of permutations([0, 1, 2, 3]).entries()) {
  test(`property: canonical manifest is invariant to source/fragment permutation ${index + 1}`, async () => {
    const base = await snapshotFixture();
    const snapshot = {
      ...base.snapshot,
      sources: order.map((entry) => ({
        ...base.snapshot.sources[entry],
        fragments: [...base.snapshot.sources[entry].fragments].reverse()
      }))
    };
    const compiler = new DeterministicContextCompiler(compilerFixture());
    const result = await compiler.compile(compileInput(base.inputRecipe, snapshot));
    assert.equal(result.manifestId, (await compiler.compile(compileInput(base.inputRecipe, base.snapshot))).manifestId);
  });
}

test("stable rank is priority then trust then source and fragment identity", async () => {
  const base = await snapshotFixture();
  const result = await new DeterministicContextCompiler(compilerFixture()).compile(
    compileInput(base.inputRecipe, base.snapshot)
  );
  assert.deepEqual(
    result.fragments.map((entry) => entry.priority),
    ["mandatory", "high", "medium", "low"]
  );
  assert.equal(result.fragments[0].trust, "verified-evidence");
});

test("content duplicates retain one canonical fragment and record the other", async () => {
  const duplicate = manyFragments("repository", 2, () => "same bytes");
  const base = await snapshotFixture({ ports: { repository: { resolve: async () => duplicate } } });
  const result = await new DeterministicContextCompiler(compilerFixture()).compile(
    compileInput(base.inputRecipe, base.snapshot)
  );
  assert.equal(result.fragments.filter((entry) => entry.content === "same bytes").length, 1);
  assert.equal(
    result.omissions.some((entry) => entry.reason === "duplicate"),
    true
  );
});

for (const priority of ["high", "medium", "low"]) {
  test(`${priority} priority budget omits whole optional fragments with exact evidence`, async () => {
    const inputRecipe = compilerRecipe({
      priorityBudgets: [
        { priority: "mandatory", maximumTokens: 100 },
        { priority, maximumTokens: 1 }
      ]
    });
    const base = await snapshotFixture({ recipe: inputRecipe });
    const result = await new DeterministicContextCompiler(compilerFixture()).compile(
      compileInput(base.inputRecipe, base.snapshot)
    );
    const omitted = result.omissions.find((entry) => entry.priority === priority);
    assert.equal(omitted.reason, "priority-budget");
    assert.equal(omitted.estimatedTokens > 1, true);
    assert.equal(typeof omitted.affectsFreshness, "boolean");
    assert.equal(typeof omitted.affectsConfidence, "boolean");
  });
}

test("overall model capacity omits lowest ranked optional content first", async () => {
  const base = await snapshotFixture();
  const result = await new DeterministicContextCompiler(compilerFixture()).compile(
    compileInput(base.inputRecipe, base.snapshot, { capacityTokens: 15 })
  );
  assert.equal(result.fragments[0].priority, "mandatory");
  assert.equal(
    result.omissions.some((entry) => entry.reason === "model-capacity"),
    true
  );
  assert.equal(result.estimatedTokens <= 15, true);
});

test("semantic obligations are canonical, digested, and included in signing input", async () => {
  const base = await snapshotFixture();
  const fixture = compilerFixture();
  const result = await new DeterministicContextCompiler(fixture).compile(compileInput(base.inputRecipe, base.snapshot));
  assert.match(result.semanticObligationsDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(result.semanticObligations, [...base.inputRecipe.semanticObligations].sort());
  assert.equal(fixture.calls.at(-1).kind, "sign");
  assert.equal(fixture.calls.at(-1).input.semanticObligationsDigest, result.semanticObligationsDigest);
});

test("pipeline authorizes exact included fragments before signing", async () => {
  const base = await snapshotFixture();
  const fixture = compilerFixture();
  const result = await new DeterministicContextCompiler(fixture).compile(compileInput(base.inputRecipe, base.snapshot));
  assert.deepEqual(
    fixture.calls.map((entry) => entry.kind),
    ["egress", "sign"]
  );
  assert.deepEqual(
    fixture.calls[0].input.fragments.map((entry) => entry.fragmentId),
    result.fragments.map((entry) => entry.fragmentId)
  );
});

test("source findings and contradictions survive into the signed manifest", async () => {
  const stale = manyFragments("tracker", 1);
  stale.retrievedAt = "2026-07-13T10:00:00.000Z";
  stale.fragments[0].claims = [{ factKey: "system:runtime", value: "node-22" }];
  const base = await snapshotFixture({ ports: { tracker: { resolve: async () => stale } } });
  const result = await new DeterministicContextCompiler(compilerFixture()).compile(
    compileInput(base.inputRecipe, base.snapshot)
  );
  assert.equal(
    result.sourceFindings.some((entry) => entry.kind === "stale"),
    true
  );
  assert.equal(
    result.omissions.some((entry) => entry.reason === "stale"),
    true
  );
  assert.equal(result.contradictions.length, 1);
});

test("manifest records the token estimator identity inside the signed material", async () => {
  const base = await snapshotFixture();
  const fixture = compilerFixture();
  const result = await new DeterministicContextCompiler(fixture).compile(compileInput(base.inputRecipe, base.snapshot));
  assert.equal(result.tokenEstimatorId, "chars-div-4@1");
  assert.equal(fixture.calls.at(-1).input.tokenEstimatorId, "chars-div-4@1");
  const other = await new DeterministicContextCompiler(
    compilerFixture({ tokenEstimatorId: "other-estimator@2" })
  ).compile(compileInput(base.inputRecipe, base.snapshot));
  assert.equal(other.tokenEstimatorId, "other-estimator@2");
  assert.notEqual(other.manifestId, result.manifestId);
});

test("a blank, padded, or absent token estimator identity is refused at construction", async () => {
  for (const tokenEstimatorId of ["", "   ", "\t", " chars-div-4@1", "chars-div-4@1 ", undefined, null, 1]) {
    assert.throws(
      () => new DeterministicContextCompiler(compilerFixture({ tokenEstimatorId })),
      (error) => error.name === "ContextCompilerError" && error.code === "VES_CONTEXT_INPUT_INVALID",
      `expected ${JSON.stringify(tokenEstimatorId)} to be refused`
    );
  }
});

test("an accepted token estimator identity is sealed exactly as supplied", async () => {
  const base = await snapshotFixture();
  const result = await new DeterministicContextCompiler(compilerFixture({ tokenEstimatorId: "chars div 4@1" })).compile(
    compileInput(base.inputRecipe, base.snapshot)
  );
  assert.equal(result.tokenEstimatorId, "chars div 4@1");
});
