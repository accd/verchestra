import assert from "node:assert/strict";
import { test } from "node:test";

import { CedarPolicyAdapter, policyViewDigest } from "../../packages/policy/src/index.ts";
import { baseLayers, baseRequest, cedar, view } from "../helpers/policy-fixture.mjs";

// DDL-07 (#207): policyViewDigest(view) is a pure export, computable without a
// CedarEnginePort, so a live cedar-policy doctor probe can observe the digest
// without constructing an engine. This pins it byte-identical to what the
// adapter itself reports for the same view — the whole point of extracting
// it, not just moving code around.

test("policyViewDigest requires no engine and returns the sha256:<hex> shape", () => {
  const digest = policyViewDigest(view());
  assert.match(digest, /^sha256:[a-f0-9]{64}$/u);
});

test("policyViewDigest is byte-identical to the digest the real adapter reports", () => {
  const input = view();
  const standalone = policyViewDigest(input);

  const decision = new CedarPolicyAdapter({ engine: cedar }).authorize({
    view: input,
    request: baseRequest(),
    entities: []
  });

  assert.equal(standalone, decision.policyViewDigest);
});

test("policyViewDigest is byte-identical across a validation-only path too", () => {
  const input = view({ layers: { ...baseLayers(), project: { broken: "forbid (" } } });
  const standalone = policyViewDigest(input);

  const validation = new CedarPolicyAdapter({ engine: cedar }).validateView(input);

  assert.equal(standalone, validation.policyViewDigest);
  assert.equal(validation.valid, false);
});

test("policyViewDigest is deterministic for the same view", () => {
  const input = view();
  assert.equal(policyViewDigest(input), policyViewDigest(input));
});

test("policyViewDigest changes when the view's content changes", () => {
  const a = view();
  const b = view({ generation: 2 });
  assert.notEqual(policyViewDigest(a), policyViewDigest(b));
});

test("policyViewDigest falls back to a stable digest for a view that fails to normalize, matching the adapter", () => {
  // A layer value that is not a record of policy strings breaks
  // normalizedView's Object.entries walk, exercising the fallback path both
  // the standalone function and #compile take when normalization itself
  // throws — before any engine call, so the adapter's fallback and this
  // function's fallback must agree without needing a real engine result.
  const malformed = view({ layers: { builtIn: null } });
  const standalone = policyViewDigest(malformed);
  assert.match(standalone, /^sha256:[a-f0-9]{64}$/u);

  const validation = new CedarPolicyAdapter({ engine: cedar }).validateView(malformed);
  assert.equal(standalone, validation.policyViewDigest);
});
