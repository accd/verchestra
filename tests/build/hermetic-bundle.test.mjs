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
