import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { collectCensusCandidates, validateCensusInventory } from "../../scripts/canonical-json-census.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const inventoryPath = fileURLToPath(new URL("../../docs/canonical-json-census.json", import.meta.url));
const matrixPath = fileURLToPath(new URL("../../docs/canonical-json-compatibility.md", import.meta.url));

async function inventory() {
  return JSON.parse(await readFile(inventoryPath, "utf8"));
}

test("the canonical JSON census classifies every detected product source exactly once", async () => {
  const candidates = await collectCensusCandidates(root);
  const result = validateCensusInventory(candidates, await inventory());

  assert.deepEqual(result, {
    duplicatePaths: [],
    invalidClassifications: [],
    missingPaths: [],
    signalMismatches: [],
    stalePaths: []
  });
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => Object.values(candidate.signals).some((count) => count > 0)));
});

test("the presentation or fixture exception is closed and cannot hide structured identity signals", async () => {
  const { entries } = await inventory();
  const presentationEntries = entries.filter((entry) => entry.classification === "presentation-or-fixture");

  assert.ok(presentationEntries.length > 0);
  for (const entry of presentationEntries) {
    assert.equal(entry.signals.canonicalizer, 0, `${entry.path} cannot use a local canonicalizer`);
    assert.ok(entry.signals.localeCompare > 0, `${entry.path} must be an ordering exception`);
  }
});

test("a new unclassified canonicalization signal is rejected", async () => {
  const candidates = [
    {
      path: "packages/example/src/identity.ts",
      signals: { canonicalizer: 1, digest: 1, localeCompare: 0 }
    }
  ];
  const result = validateCensusInventory(candidates, { entries: [] });

  assert.deepEqual(result.missingPaths, ["packages/example/src/identity.ts"]);
});

test("a duplicate classification and a stale source entry are rejected", () => {
  const candidates = [
    {
      path: "packages/example/src/identity.ts",
      signals: { canonicalizer: 0, digest: 1, localeCompare: 0 }
    }
  ];
  const result = validateCensusInventory(candidates, {
    entries: [
      {
        path: "packages/example/src/identity.ts",
        classification: "raw-byte-digest",
        signals: { canonicalizer: 0, digest: 1, localeCompare: 0 }
      },
      {
        path: "packages/example/src/identity.ts",
        classification: "raw-byte-digest",
        signals: { canonicalizer: 0, digest: 1, localeCompare: 0 }
      },
      {
        path: "packages/example/src/stale.ts",
        classification: "raw-byte-digest",
        signals: { canonicalizer: 0, digest: 1, localeCompare: 0 }
      }
    ]
  });

  assert.deepEqual(result.duplicatePaths, ["packages/example/src/identity.ts"]);
  assert.deepEqual(result.stalePaths, ["packages/example/src/stale.ts"]);
});

test("the compatibility matrix names the canonical census and the ordered pending verticals", async () => {
  const matrix = await readFile(matrixPath, "utf8");
  const evidence = matrix.indexOf("signed-evidence vertical");
  const release = matrix.indexOf("release vertical");
  const portableOwners = matrix.indexOf("portable-owner verticals");

  assert.match(matrix, /docs\/canonical-json-census\.json/u);
  assert.ok(evidence >= 0);
  assert.ok(release > evidence);
  assert.ok(portableOwners > release);
  assert.match(
    portableOwners >= 0 ? matrix.slice(portableOwners) : "",
    /registries,\s+connectors, extension host, drivers, memory, and policy bundles/u
  );
});
