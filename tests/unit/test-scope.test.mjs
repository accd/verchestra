// Contract for scripts/test-scope.mjs: an empty required scope fails closed.
// T73 filled the last declared-empty scope (release), so no scope is exempt.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const SCRIPT = fileURLToPath(new URL("../../scripts/test-scope.mjs", import.meta.url));

// The spawned script itself spawns `node --test`; the test-runner context
// variables must not leak into it or the grandchild skips running files.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST")));

function runScope(scope, roots, environment = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, scope, ...roots], {
      encoding: "utf8",
      env: { ...cleanEnv, ...environment }
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("an empty undeclared scope fails closed and names its roots", async (t) => {
  const root = await temporaryDirectory(t, "verchestra-scope-");
  const result = runScope("integration", [join(root, "does-not-exist")]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /integration: 0 tests found under .*does-not-exist — an empty required scope cannot pass/u
  );
});

test("the release scope now fails closed when empty, with no declared-empty exception", async (t) => {
  const root = await temporaryDirectory(t, "verchestra-scope-");
  const result = runScope("release", [join(root, "public-regression"), join(root, "system")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release: 0 tests found under .* — an empty required scope cannot pass/u);
});

test("a scope with tests runs them and reports their outcome", async (t) => {
  const root = await temporaryDirectory(t, "verchestra-scope-");
  await mkdir(join(root, "cases"), { recursive: true });
  await writeFile(join(root, "cases", "passing.test.mjs"), 'import test from "node:test"; test("passes", () => {});\n');
  assert.equal(runScope("unit", [join(root, "cases")]).status, 0);
  await writeFile(
    join(root, "cases", "failing.test.mjs"),
    'import test from "node:test"; import assert from "node:assert"; test("fails", () => assert.fail("no"));\n'
  );
  assert.equal(runScope("unit", [join(root, "cases")]).status, 1);
});

test("a single test file is a scope root of its own", async (t) => {
  const root = await temporaryDirectory(t, "verchestra-scope-");
  await writeFile(join(root, "passing.test.mjs"), 'import test from "node:test"; test("passes", () => {});\n');
  await writeFile(join(root, "helper.mjs"), "export const value = 1;\n");
  assert.equal(runScope("unit", [join(root, "passing.test.mjs")]).status, 0);
  const helperOnly = runScope("unit", [join(root, "helper.mjs")]);
  assert.equal(helperOnly.status, 1);
  assert.match(helperOnly.stderr, /unit: 0 tests found under .*helper\.mjs/u);
});

// invariant: each case points the script at a temporary directory it owns, so
// an empty directory afterwards proves the guard removed both the leak and its
// own private directory, and that the leak never reached the caller's.
const ownedTemporary = (temporary) => ({ TMPDIR: temporary, TEMP: temporary, TMP: temporary });

// why: every guard case writes one test file, run alone under a fresh root,
// against a temporary directory the case owns.
async function guardedScope(t, file, fsImport, body) {
  const root = await temporaryDirectory(t, "verchestra-scope-");
  const temporary = await temporaryDirectory(t, "verchestra-scope-tmp-");
  const source = [
    `import { ${fsImport} } from "node:fs";`,
    'import { tmpdir } from "node:os";',
    'import { join } from "node:path";',
    'import test from "node:test";',
    ...body,
    ""
  ];
  await writeFile(join(root, file), source.join("\n"));
  return { result: runScope("unit", [root], ownedTemporary(temporary)), temporary };
}

test("a scope whose tests leave anything in the temporary directory fails and names it", async (t) => {
  const { result, temporary } = await guardedScope(t, "leaking.test.mjs", "mkdtempSync", [
    'test("leaks", () => { mkdtempSync(join(tmpdir(), "leaked-fixture-")); });'
  ]);
  assert.equal(result.status, 1, "a passing test that leaks still fails the scope");
  assert.match(
    result.stderr,
    /unit: tests left 1 entries in their temporary directory; every test must remove what it creates:\n {2}leaked-fixture-[A-Za-z0-9]{6}\n/u
  );
  assert.deepEqual(await readdir(temporary), []);
});

test("a scope whose tests remove what they create passes and leaves nothing behind", async (t) => {
  const { result, temporary } = await guardedScope(t, "owning.test.mjs", "mkdtempSync, rmSync", [
    'test("owns", (t) => {',
    '  const path = mkdtempSync(join(tmpdir(), "owned-fixture-"));',
    "  t.after(() => rmSync(path, { recursive: true, force: true }));",
    "});"
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /tests left/u);
  assert.deepEqual(await readdir(temporary), []);
});

test("Node's shared compile cache is the one entry a scope may leave, and it is still removed", async (t) => {
  const { result, temporary } = await guardedScope(t, "caching.test.mjs", "mkdirSync", [
    'test("caches", () => { mkdirSync(join(tmpdir(), "node-compile-cache")); });'
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(temporary), []);
});
