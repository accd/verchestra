// Contract for scripts/test-scope.mjs: an empty required scope fails closed.
// T73 filled the last declared-empty scope (release), so no scope is exempt.
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

test("the release scope now fails closed when empty, with no declared-empty exception", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-scope-"));
  const result = runScope("release", [join(root, "public-regression"), join(root, "system")]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release: 0 tests found under .* — an empty required scope cannot pass/u);
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
