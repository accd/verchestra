import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, test } from "node:test";

// Discrimination sensor for the RFC 8785 encoder (CJ-11): each mutation below
// reverts one of the two behaviour-level guarantees canonical-json.ts commits
// to (design.md, "The two byte-contract differences that matter") and proves
// a focused assertion catches it. Mutations run against a disposable copy of
// the module written alongside the original (so its relative import of
// ./canonical-guard.ts still resolves) and are removed afterward; the
// original source is asserted byte-identical after every run.

const sourcePath = fileURLToPath(new URL("../../packages/domain/src/canonical/canonical-json.ts", import.meta.url));
const sourceDir = dirname(sourcePath);

const disposablePaths = [];
afterEach(async () => {
  await Promise.all(disposablePaths.splice(0).map((path) => rm(path, { force: true })));
});

async function loadMutant(patch) {
  const original = await readFile(sourcePath, "utf8");
  const mutated = patch(original);
  assert.notEqual(mutated, original, "mutation must actually change the source");
  const disposablePath = join(sourceDir, `canonical-json.mutant-${randomUUID()}.ts`);
  disposablePaths.push(disposablePath);
  await writeFile(disposablePath, mutated, "utf8");
  const module = await import(pathToFileURL(disposablePath).href);
  return module.canonicalizeJsonV2;
}

test("mutation A: replacing code-unit member ordering with localeCompare is killed", async () => {
  const before = await readFile(sourcePath, "utf8");
  const mutantEncode = await loadMutant((source) => {
    const patched = source.replace(
      "Object.keys(value)\n    .sort()",
      "Object.keys(value)\n    .sort((left, right) => left.localeCompare(right))"
    );
    assert.notEqual(patched, source, "the .sort() call site must exist in the current source");
    return patched;
  });
  // "Z" (0x5A) sorts before "a" (0x61) by UTF-16 code unit; a locale-aware
  // compare (e.g. en collation) orders "a" before "Z" instead — exactly the
  // distinction tests/unit/canonical-json-v2.test.mjs:14 pins for the real
  // encoder. Under the mutation, member order flips.
  assert.equal(mutantEncode({ Z: 1, a: 2 }), '{"a":2,"Z":1}');
  assert.notEqual(mutantEncode({ Z: 1, a: 2 }), '{"Z":1,"a":2}');
  assert.equal(await readFile(sourcePath, "utf8"), before);
});

test("mutation B: replacing array-order preservation with sorting is killed", async () => {
  const before = await readFile(sourcePath, "utf8");
  const mutantEncode = await loadMutant((source) => {
    const target = 'return `[${value.map(encodeValue).join(",")}]`;';
    const patched = source.replace(target, 'return `[${[...value].map(encodeValue).sort().join(",")}]`;');
    assert.notEqual(patched, source, "the array-order encode line must exist in the current source");
    return patched;
  });
  // The real encoder never sorts arrays (tests/unit/canonical-json-v2.test.mjs:28,32).
  // Under the mutation, a reordered array collapses to the same bytes instead
  // of differing.
  assert.equal(mutantEncode([2, 1]), "[1,2]");
  assert.notEqual(mutantEncode([2, 1]), "[2,1]");
  assert.equal(await readFile(sourcePath, "utf8"), before);
});

const setsSourcePath = fileURLToPath(new URL("../../packages/domain/src/canonical/canonical-sets.ts", import.meta.url));
const setsSourceDir = dirname(setsSourcePath);

async function loadSetsMutant(patch) {
  const original = await readFile(setsSourcePath, "utf8");
  const mutated = patch(original);
  assert.notEqual(mutated, original, "mutation must actually change the source");
  const disposablePath = join(setsSourceDir, `canonical-sets.mutant-${randomUUID()}.ts`);
  disposablePaths.push(disposablePath);
  await writeFile(disposablePath, mutated, "utf8");
  const module = await import(pathToFileURL(disposablePath).href);
  return module.normalizeDeclaredSet;
}

// Mutation C: normalizeDeclaredSet is the single primitive every T4a owner
// (and every future T4 slice) delegates to for declared-set ordering
// (CJ4-09). A dedicated sensor here compositionally covers all of them,
// which matters because promotion-gate.ts's and campaigns.ts's own public
// APIs enforce a lowercase-only id format, so a locale-vs-code-unit output
// divergence is not reachable through their realistic call data.
test("mutation C: replacing normalizeDeclaredSet's code-unit compare with localeCompare is killed", async () => {
  const before = await readFile(setsSourcePath, "utf8");
  const mutantNormalize = await loadSetsMutant((source) => {
    const target = "if (a < b) return -1;\n    if (a > b) return 1;\n    return 0;";
    const patched = source.replace(target, "return a.localeCompare(b);");
    assert.notEqual(patched, source, "the code-unit compare body must exist in the current source");
    return patched;
  });
  // Same case-order divergence as mutation A: code unit puts "Z" (0x5A)
  // before "a" (0x61); a locale-aware compare orders "a" before "Z".
  assert.deepEqual(
    mutantNormalize(["a", "Z"], (value) => value),
    ["a", "Z"]
  );
  assert.notDeepEqual(
    mutantNormalize(["a", "Z"], (value) => value),
    ["Z", "a"]
  );
  assert.equal(await readFile(setsSourcePath, "utf8"), before);
});

// CJ4-09: one discrimination mutation per T4a owner, in addition to mutation
// C above. These are static rather than dynamic-import mutants: each owner's
// public API enforces a lowercase-only id format (promotion-gate.ts's and
// campaigns.ts's ID regex) or a closed check/capability/remediation catalog
// (doctor.ts), so a locale-vs-code-unit output divergence is not reachable
// through realistic call data. Each mutation instead reverts the exact
// migrated call site back to its pre-T4a form and proves the resulting text
// is distinguishable from the real, migrated source — the same signal
// tests/security/canonical-json-locale-allowlist.test.mjs polices
// continuously once its ceiling for that owner is tightened to 0.
const OWNER_MUTATIONS = [
  {
    file: "packages/application/src/promotion/promotion-gate.ts",
    from: "normalizeDeclaredSet(oracle.entries, (entry) => entry.campaignId)",
    to: "[...oracle.entries].sort((left, right) => left.campaignId.localeCompare(right.campaignId))"
  },
  {
    file: "packages/application/src/regression/campaigns.ts",
    from: "normalizeDeclaredSet(results, (result) => result.id)",
    to: "[...results].sort((left, right) => left.id.localeCompare(right.id))"
  },
  {
    file: "packages/application/src/doctor/doctor.ts",
    from: "normalizeDeclaredSet([...new Set(values)], (value) => value)",
    to: "[...new Set(values)].sort((left, right) => left.localeCompare(right))"
  },
  {
    file: "packages/application/src/self-test/self-test.ts",
    from: "normalizeDeclaredSet(\n      checks.map((check) => `${check.checkId}:${check.status}`),\n      (entry) => entry\n    )",
    to: "[...checks].map((check) => `${check.checkId}:${check.status}`).sort((left, right) => left.localeCompare(right))"
  }
];

for (const { file, from, to } of OWNER_MUTATIONS) {
  test(`mutation: reverting ${file} to ambient-locale ordering is a detectable regression`, async () => {
    const path = fileURLToPath(new URL(`../../${file}`, import.meta.url));
    const current = await readFile(path, "utf8");
    assert.equal(
      current.includes(".localeCompare("),
      false,
      `${file} must not carry .localeCompare( after the T4a migration`
    );
    assert.ok(current.includes(from), `${file} must still carry its migrated call site verbatim`);
    const reverted = current.replace(from, to);
    assert.notEqual(reverted, current, "the mutation must actually change the source");
    assert.ok(reverted.includes(".localeCompare("), "the reverted source must reintroduce ambient-locale ordering");
  });
}
