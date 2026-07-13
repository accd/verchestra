import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BackendContextSerializer,
  ContextSerializationError,
  SemanticEquivalenceOracle
} from "../../packages/agent-runtime/src/index.ts";
import { digest } from "../helpers/context-source-fixture.mjs";
import { manifestFixture, serializerFixture, targets } from "../helpers/context-serializer-fixture.mjs";

for (const target of targets) {
  test(`${target} serializer emits the exact native transport envelope`, async () => {
    const manifest = await manifestFixture();
    const fixture = serializerFixture();
    const output = new BackendContextSerializer({ digest, capacity: fixture.estimate }).serialize({
      manifest,
      target,
      maximumInputTokens: 10000
    });
    assert.equal(output.target, target);
    assert.equal(output.manifestId, manifest.manifestId);
    assert.deepEqual(
      Object.keys(output.transport).sort(),
      {
        pi: ["prompt", "systemPrompt"],
        "claude-code": ["streamJson"],
        codex: ["input"],
        opencode: ["parts"]
      }[target]
    );
    assert.equal(
      output.estimatedTokens,
      fixture.estimates[0].serialized === output.transport ? output.estimatedTokens : -1
    );
  });

  test(`${target} round-trip preserves the compiler meaning digest`, async () => {
    const manifest = await manifestFixture();
    const output = new BackendContextSerializer({ digest, capacity: serializerFixture().estimate }).serialize({
      manifest,
      target,
      maximumInputTokens: 10000
    });
    const result = new SemanticEquivalenceOracle({ digest }).verify(output, manifest.serializedMeaningDigest);
    assert.deepEqual(result, { equivalent: true, meaningDigest: manifest.serializedMeaningDigest });
  });

  test(`${target} preserves mandatory semantics and trust order`, async () => {
    const manifest = await manifestFixture();
    const output = new BackendContextSerializer({ digest, capacity: serializerFixture().estimate }).serialize({
      manifest,
      target,
      maximumInputTokens: 10000
    });
    const tree = new SemanticEquivalenceOracle({ digest }).extract(output);
    assert.deepEqual(tree.semanticObligations, manifest.semanticObligations);
    assert.deepEqual(
      tree.fragments.map((entry) => entry.fragmentId),
      manifest.fragments.map((entry) => entry.fragmentId)
    );
    assert.deepEqual(
      tree.fragments.map((entry) => entry.trust),
      manifest.fragments.map((entry) => entry.trust)
    );
  });

  test(`${target} uses the capacity estimator port on the final native envelope`, async () => {
    const manifest = await manifestFixture();
    const fixture = serializerFixture();
    const output = new BackendContextSerializer({ digest, capacity: fixture.estimate }).serialize({
      manifest,
      target,
      maximumInputTokens: 10000
    });
    assert.equal(fixture.estimates.length, 1);
    assert.equal(fixture.estimates[0].target, target);
    assert.deepEqual(fixture.estimates[0].serialized, output.transport);
  });
}

for (const target of targets) {
  test(`${target} fails before delivery when qualified capacity is insufficient`, async () => {
    const manifest = await manifestFixture();
    assert.throws(
      () =>
        new BackendContextSerializer({
          digest,
          capacity: { estimate: () => 101 }
        }).serialize({ manifest, target, maximumInputTokens: 100 }),
      (error) => error instanceof ContextSerializationError && error.code === "VES_CONTEXT_SERIALIZATION_INELIGIBLE"
    );
  });
}

test("unsupported backend fails closed", async () => {
  const manifest = await manifestFixture();
  assert.throws(
    () =>
      new BackendContextSerializer({ digest, capacity: serializerFixture().estimate }).serialize({
        manifest,
        target: "generic",
        maximumInputTokens: 10000
      }),
    (error) => error.code === "VES_CONTEXT_SERIALIZATION_TARGET_UNSUPPORTED"
  );
});

for (const [left, right] of [
  ["pi", "claude-code"],
  ["pi", "codex"],
  ["pi", "opencode"],
  ["claude-code", "codex"],
  ["claude-code", "opencode"],
  ["codex", "opencode"]
]) {
  test(`cross-backend oracle proves ${left} and ${right} equivalent`, async () => {
    const manifest = await manifestFixture();
    const serializer = new BackendContextSerializer({ digest, capacity: serializerFixture().estimate });
    const a = serializer.serialize({ manifest, target: left, maximumInputTokens: 10000 });
    const b = serializer.serialize({ manifest, target: right, maximumInputTokens: 10000 });
    const result = new SemanticEquivalenceOracle({ digest }).compare(a, b);
    assert.equal(result.equivalent, true);
    assert.equal(result.meaningDigest, manifest.serializedMeaningDigest);
  });
}
