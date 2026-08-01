// Contract for scripts/test-scope.mjs: an empty required scope fails closed;
// the single declared-empty scope (release, until T73) passes with an explicit
// non-evidence statement instead of a silent green.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = fileURLToPath(new URL("../../scripts/test-scope.mjs", import.meta.url));

// The spawned script itself spawns `node --test`; the test-runner context
// variables must not leak into it or the grandchild skips running files.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST")));

function runScope(scope, roots) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, scope, ...roots], { encoding: "utf8", env: cleanEnv });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("an empty undeclared scope fails closed and names its roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-scope-"));
  const result = runScope("integration", [join(root, "does-not-exist")]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /integration: 0 tests found under .*does-not-exist — an empty required scope cannot pass/u
  );
});

test("the release scope is declared empty until T73 and says it is not evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-scope-"));
  const result = runScope("release", [join(root, "public-regression"), join(root, "system")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /release: 0 tests — declared empty until T73 \(#14\)/u);
  assert.match(result.stdout, /not release evidence/u);
});

test("a scope with tests runs them and reports their outcome", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-scope-"));
  await mkdir(join(root, "cases"), { recursive: true });
  await writeFile(join(root, "cases", "passing.test.mjs"), 'import test from "node:test"; test("passes", () => {});\n');
  assert.equal(runScope("unit", [join(root, "cases")]).status, 0);
  await writeFile(
    join(root, "cases", "failing.test.mjs"),
    'import test from "node:test"; import assert from "node:assert"; test("fails", () => assert.fail("no"));\n'
  );
  assert.equal(runScope("unit", [join(root, "cases")]).status, 1);
});

test("a declared-empty scope that gains tests runs them and flags the stale declaration", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-scope-"));
  await mkdir(join(root, "system"), { recursive: true });
  await writeFile(join(root, "system", "real.test.mjs"), 'import test from "node:test"; test("real", () => {});\n');
  const result = runScope("release", [join(root, "system")]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /release: tests exist now — remove the stale declared-empty entry/u);
});
