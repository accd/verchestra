import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HermeticBundleError,
  buildHermeticDistributionBundle,
  verifyHermeticDistributionBundle
} from "../../packages/distribution/src/index.ts";
import { bundleInput, components, sha } from "../helpers/hermetic-bundle-fixture.mjs";

test("complete release closure builds one content-addressed offline manifest", () => {
  const bundle = buildHermeticDistributionBundle(bundleInput());
  assert.match(bundle.releaseDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(bundle.runtimeResolver, false);
  assert.equal(bundle.components.length, 16);
  assert.equal(verifyHermeticDistributionBundle(bundle).releaseDigest, bundle.releaseDigest);
});

test("component order cannot change release identity", () => {
  const one = buildHermeticDistributionBundle(bundleInput());
  const two = buildHermeticDistributionBundle(bundleInput({ components: components().reverse() }));
  assert.deepEqual(two, one);
});

test("both canonical launchers are exact members of the target closure", () => {
  const bundle = buildHermeticDistributionBundle(bundleInput());
  assert.deepEqual(
    bundle.components.filter((entry) => entry.kind === "launcher").map((entry) => entry.componentId),
    ["launcher:verchestra", "launcher:vestra"]
  );
});

test("manifest contains no runtime dependency resolver authority", () => {
  const serialized = JSON.stringify(buildHermeticDistributionBundle(bundleInput())).toLowerCase();
  for (const forbidden of ["https://", "npm:", "semverrange", "registry", "resolvercommand", "installscript"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("changing one component digest changes release identity", () => {
  const changed = components();
  changed[1].contentDigest = sha("changed-core");
  assert.notEqual(
    buildHermeticDistributionBundle(bundleInput()).releaseDigest,
    buildHermeticDistributionBundle(bundleInput({ components: changed })).releaseDigest
  );
});

test("bundle and nested closure are immutable", () => {
  const bundle = buildHermeticDistributionBundle(bundleInput());
  assert.equal(Object.isFrozen(bundle), true);
  assert.equal(Object.isFrozen(bundle.target), true);
  assert.equal(Object.isFrozen(bundle.components), true);
  assert.equal(Object.isFrozen(bundle.components[0].licenseRefs), true);
});

// #58/T4j: hermetic-bundle.ts used to sort components with
// String.prototype.localeCompare and hand-roll its own recursive
// canonicalizer with the same comparator for object keys — both
// locale-dependent. Mocking localeCompare with a comparator that reverses
// ASCII case order simulates a hostile/divergent locale without depending
// on any specific installed ICU locale actually disagreeing today.
function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

test("release digest is byte-identical across two divergent locale collations, for a mixed-case componentId set", () => {
  const mixedCase = components().map((entry) =>
    entry.componentId === "driver:claude"
      ? { ...entry, componentId: "driver:Claude", contentDigest: sha("driver:Claude") }
      : entry
  );
  const input = bundleInput({ components: mixedCase });
  const plain = buildHermeticDistributionBundle(input);
  const underHostileLocale = withHostileLocaleCompare(() => buildHermeticDistributionBundle(input));
  assert.equal(plain.releaseDigest, underHostileLocale.releaseDigest);
  assert.deepEqual(
    plain.components.map((entry) => entry.componentId),
    underHostileLocale.components.map((entry) => entry.componentId)
  );
  // Code-unit order specifically: uppercase sorts before lowercase in UTF-16,
  // so "driver:Claude" sorts before "driver:claude"-shaped neighbors that
  // start the same but continue lowercase.
  const driverIds = plain.components.map((entry) => entry.componentId).filter((id) => id.startsWith("driver:"));
  assert.deepEqual(driverIds, ["driver:Claude"]);
});

for (const kind of [
  "node-runtime",
  "core-code",
  "schema",
  "migration",
  "policy",
  "cedar-wasm",
  "sqlite-native",
  "driver",
  "connector",
  "skill",
  "license",
  "sbom",
  "provenance",
  "evaluation"
]) {
  test(`missing required ${kind} closure prevents bundle`, () => {
    assert.throws(
      () =>
        buildHermeticDistributionBundle(
          bundleInput({ components: components().filter((entry) => entry.kind !== kind) })
        ),
      HermeticBundleError
    );
  });
}

for (const launcher of ["launcher:vestra", "launcher:verchestra"]) {
  test(`missing ${launcher} prevents bundle`, () => {
    assert.throws(
      () =>
        buildHermeticDistributionBundle(
          bundleInput({ components: components().filter((entry) => entry.componentId !== launcher) })
        ),
      { code: "VES_DISTRIBUTION_CLOSURE_INCOMPLETE" }
    );
  });
}
