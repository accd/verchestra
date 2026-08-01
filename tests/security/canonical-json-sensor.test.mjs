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
