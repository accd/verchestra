import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CENSUS_SCOPE_EXCLUSIONS,
  collectCensusCandidates,
  validateCensusInventory
} from "../../scripts/canonical-json-census.mjs";

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
    invalidExceptionPaths: [],
    invalidReasons: [],
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
    assert.equal(
      entry.reason,
      "Closed presentation, fixture, or repository-diagnostic ordering only; not a trust or persistent identity."
    );
  }
});

test("a locally named canonicalizer is detected even when it does not use the historical vocabulary", async () => {
  const disposableRoot = await mkdtemp(join(tmpdir(), "verchestra-canonical-json-census-"));
  try {
    await Promise.all(
      ["packages/application/src/regression", "apps", "scripts"].map((directory) =>
        mkdir(join(disposableRoot, directory), { recursive: true })
      )
    );
    await writeFile(
      join(disposableRoot, "packages/application/src/regression/campaigns.ts"),
      "export function canonicalizeReleaseReceipt(value: unknown): string { return JSON.stringify(value); }\n",
      "utf8"
    );

    assert.deepEqual(await collectCensusCandidates(disposableRoot), [
      {
        path: "packages/application/src/regression/campaigns.ts",
        signals: { canonicalizer: 1, digest: 0, localeCompare: 0, serialization: 1 }
      }
    ]);
  } finally {
    await rm(disposableRoot, { force: true, recursive: true });
  }
});

test("a canonical-prefix serializer is detected without a name allowlist", async () => {
  const disposableRoot = await mkdtemp(join(tmpdir(), "verchestra-canonical-json-census-"));
  try {
    await Promise.all(
      ["packages/application/src/self-test", "apps", "scripts"].map((directory) =>
        mkdir(join(disposableRoot, directory), { recursive: true })
      )
    );
    await writeFile(
      join(disposableRoot, "packages/application/src/self-test/self-test.ts"),
      "function canonicalDriverReview(value: unknown): string { return JSON.stringify(value); }\n",
      "utf8"
    );

    assert.deepEqual(await collectCensusCandidates(disposableRoot), [
      {
        path: "packages/application/src/self-test/self-test.ts",
        signals: { canonicalizer: 0, digest: 0, localeCompare: 0, serialization: 1 }
      }
    ]);
  } finally {
    await rm(disposableRoot, { force: true, recursive: true });
  }
});

test("the reviewed serialization scope exclusions are closed", () => {
  assert.deepEqual([...CENSUS_SCOPE_EXCLUSIONS.keys()].sort(), [
    "apps/site/scripts/check-built-site.mjs",
    "apps/site/tests/e2e/site.spec.ts",
    "apps/vestra-cli/src/self-test-driver-fake.mjs",
    "apps/vestra-cli/src/self-test-full-crash-child.ts",
    "packages/drivers/src/claude-code-driver.ts",
    "packages/drivers/src/codex-driver.ts",
    "packages/self-test/src/git-fixtures.ts",
    "scripts/agent-context.mjs",
    "scripts/canonical-json-census-refresh.mjs",
    "scripts/canonical-json-census.mjs",
    "scripts/requirements-trace.mjs",
    "scripts/select-gates.mjs"
  ]);
  for (const reason of CENSUS_SCOPE_EXCLUSIONS.values()) assert.ok(reason.length > 0);
});

test("the presentation exception rejects a persistent or trust path", async () => {
  const { entries } = await inventory();
  const presentation = entries.find((entry) => entry.classification === "presentation-or-fixture");
  assert.ok(presentation);
  const result = validateCensusInventory([], {
    entries: [
      {
        ...presentation,
        path: "packages/application/src/regression/campaigns.ts"
      }
    ]
  });

  assert.deepEqual(result.invalidExceptionPaths, ["packages/application/src/regression/campaigns.ts"]);
});

test("an inventory entry without its reviewed reason is rejected", () => {
  const path = "packages/example/src/identity.ts";
  const result = validateCensusInventory(
    [{ path, signals: { canonicalizer: 0, digest: 1, localeCompare: 0, serialization: 0 } }],
    {
      entries: [
        {
          path,
          classification: "raw-byte-digest",
          reason: "",
          signals: { canonicalizer: 0, digest: 1, localeCompare: 0, serialization: 0 }
        }
      ]
    }
  );

  assert.deepEqual(result.invalidReasons, [path]);
});

test("a new unclassified canonicalization signal is rejected", async () => {
  const candidates = [
    {
      path: "packages/example/src/identity.ts",
      signals: { canonicalizer: 1, digest: 1, localeCompare: 0, serialization: 0 }
    }
  ];
  const result = validateCensusInventory(candidates, { entries: [] });

  assert.deepEqual(result.missingPaths, ["packages/example/src/identity.ts"]);
});

test("a duplicate classification and a stale source entry are rejected", () => {
  const candidates = [
    {
      path: "packages/example/src/identity.ts",
      signals: { canonicalizer: 0, digest: 1, localeCompare: 0, serialization: 0 }
    }
  ];
  const result = validateCensusInventory(candidates, {
    entries: [
      {
        path: "packages/example/src/identity.ts",
        classification: "raw-byte-digest",
        signals: { canonicalizer: 0, digest: 1, localeCompare: 0, serialization: 0 }
      },
      {
        path: "packages/example/src/identity.ts",
        classification: "raw-byte-digest",
        signals: { canonicalizer: 0, digest: 1, localeCompare: 0, serialization: 0 }
      },
      {
        path: "packages/example/src/stale.ts",
        classification: "raw-byte-digest",
        signals: { canonicalizer: 0, digest: 1, localeCompare: 0, serialization: 0 }
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
