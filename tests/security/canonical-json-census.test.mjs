import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  CENSUS_SCOPE_EXCLUSIONS,
  PROVEN_LOCAL_CANONICALIZERS,
  collectCensusCandidates,
  collectLocalCanonicalizerFacts,
  localCanonicalizerFacts,
  validateCensusInventory,
  validateLocalCanonicalizers
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

test("the compatibility matrix names the canonical census and the ordered verticals", async () => {
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
    /registries,\s+connectors,\s+extension host,\s+drivers,\s+memory,\s+policy bundles/u
  );
  // Every vertical is now done, so the matrix must say what is still true
  // rather than reading as complete: two V1-only comparators are retained by
  // design and the scanner's own fingerprint helper keeps its V1 sites.
  assert.match(matrix, /What is \*not\*\s+claimed/u);
  assert.match(matrix, /V1-only\s+verification comparators are retained by design/u);
});

// #395: a migrated-v2 source may carry its own canonicalizer instead of importing
// canonicalizeJsonV2 only where the import is forbidden and a named byte-equality
// proof exists (docs/canonical-json-compatibility.md, "Proven local canonicalizers").
test("every migrated-v2 local canonicalizer imports the V2 encoder or is a proven, allowlisted copy", async () => {
  const census = await inventory();
  const facts = await collectLocalCanonicalizerFacts(root, census);

  assert.ok(facts.length > 0);
  assert.deepEqual(validateLocalCanonicalizers(facts, census), {
    staleAllowlistPaths: [],
    unnamedProofPaths: [],
    unprovenPaths: []
  });
  assert.deepEqual([...PROVEN_LOCAL_CANONICALIZERS.keys()], ["scripts/agent-readiness.mjs"]);
  for (const [path, proof] of PROVEN_LOCAL_CANONICALIZERS) {
    const entry = census.entries.find((candidate) => candidate.path === path);
    assert.equal(entry?.classification, "migrated-v2", `${path} must stay a trust classification`);
    assert.ok(entry.reason.includes(proof), `${path}'s census reason must name ${proof}`);
    const source = await readFile(join(root, proof), "utf8");
    assert.match(source, /import \{ canonicalizeJsonV2 \} from/u, `${proof} must compare against the V2 encoder`);
    assert.ok(source.includes(`scripts/${path.split("/").at(-1)}`), `${proof} must exercise ${path}`);
    assert.match(source, /assert\.equal\(canonicalJson\(value\), canonicalizeJsonV2\(value\)\)/u);
  }
});

test("a local canonicalizer without the V2 import or an allowlisted proof is rejected", () => {
  const path = "scripts/new-signer.mjs";
  const census = {
    entries: [{ path, classification: "migrated-v2", reason: "Signs a manifest.", signals: {} }]
  };
  const local = localCanonicalizerFacts(
    "// canonicalizeJsonV2 is mentioned here but never imported.\nfunction canonicalJson(value) { return JSON.stringify(value); }\n"
  );
  assert.deepEqual(local, { definesLocal: true, importsV2: false });
  assert.deepEqual(validateLocalCanonicalizers([{ path, ...local }], census, new Map()).unprovenPaths, [path]);

  const imported = localCanonicalizerFacts(
    'import {\n  canonicalizeJsonV2\n} from "@verchestra/domain";\nconst canonicalJson = (value) => canonicalizeJsonV2(value);\n'
  );
  assert.deepEqual(imported, { definesLocal: true, importsV2: true });
  assert.deepEqual(validateLocalCanonicalizers([{ path, ...imported }], census, new Map()).unprovenPaths, []);
});

test("an allowlisted local canonicalizer must name its proof and the allowlist cannot go stale", () => {
  const path = "scripts/new-signer.mjs";
  const proof = "tests/agent-readiness/new-signer.test.mjs";
  const local = { path, definesLocal: true, importsV2: false };
  const allowlist = new Map([[path, proof]]);
  const withReason = (reason) => ({ entries: [{ path, classification: "migrated-v2", reason, signals: {} }] });

  assert.deepEqual(validateLocalCanonicalizers([local], withReason("Proven local copy."), allowlist), {
    staleAllowlistPaths: [],
    unnamedProofPaths: [path],
    unprovenPaths: []
  });
  assert.deepEqual(validateLocalCanonicalizers([local], withReason(`Proven by ${proof}.`), allowlist), {
    staleAllowlistPaths: [],
    unnamedProofPaths: [],
    unprovenPaths: []
  });
  // Once the source imports the V2 encoder, its exception must be removed.
  assert.deepEqual(
    validateLocalCanonicalizers([{ ...local, importsV2: true }], withReason(`Proven by ${proof}.`), allowlist)
      .staleAllowlistPaths,
    [path]
  );
});
