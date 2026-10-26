// Contract for the SonarCloud coverage pipeline: scripts/coverage-lcov.mjs
// merges per-scope LCOV, scripts/merge-coverage.mjs fails closed on nothing,
// and scripts/test-scope.mjs writes LCOV only when asked.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { mergeLcov } from "../../scripts/coverage-lcov.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const MERGE = fileURLToPath(new URL("../../scripts/merge-coverage.mjs", import.meta.url));
const SCOPE = fileURLToPath(new URL("../../scripts/test-scope.mjs", import.meta.url));
// A coverage run of this suite sets VES_COVERAGE_DIR; the nested scopes must not
// inherit it or they would write into the outer run's report directory.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST") && key !== "VES_COVERAGE_DIR")
);

function run(script, args, environment = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      encoding: "utf8",
      env: { ...cleanEnv, ...environment },
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

const unitReport = [
  "TN:",
  "SF:packages\\domain\\src\\a.ts",
  "FN:1,alpha",
  "FNDA:0,alpha",
  "BRDA:2,0,0,1",
  "BRDA:2,0,1,0",
  "DA:1,1",
  "DA:2,0",
  "end_of_record",
  ""
].join("\n");
const integrationReport = [
  "SF:packages/domain/src/a.ts",
  "FN:1,alpha",
  "FNDA:3,alpha",
  "BRDA:2,0,1,2",
  "DA:2,4",
  "DA:3,0",
  "end_of_record",
  "SF:apps/vestra-cli/src/b.ts",
  "BRDA:5,0,0,-",
  "DA:5,0",
  "end_of_record",
  ""
].join("\n");

test("a line, branch or function covered by any scope counts as covered", () => {
  const merged = mergeLcov([unitReport, integrationReport]);
  const a = merged.split("end_of_record")[1];
  assert.match(a, /SF:packages\/domain\/src\/a\.ts\n/u);
  assert.match(a, /FNDA:3,alpha\nFNF:1\nFNH:1\n/u);
  assert.match(a, /BRDA:2,0,0,1\nBRDA:2,0,1,2\nBRF:2\nBRH:2\n/u);
  assert.match(a, /DA:1,1\nDA:2,4\nDA:3,0\nLF:3\nLH:2\n/u);
});

test("Windows separators are normalised and files are ordered deterministically", () => {
  const merged = mergeLcov([unitReport, integrationReport]);
  assert.doesNotMatch(merged, /\\/u);
  assert.deepEqual(
    [...merged.matchAll(/^SF:(.+)$/gmu)].map((match) => match[1]),
    ["apps/vestra-cli/src/b.ts", "packages/domain/src/a.ts"]
  );
  assert.match(merged, /BRDA:5,0,0,0\nBRF:1\nBRH:0\n/u, "a branch never reached is recorded as not taken");
});

test("no reports merge to nothing", () => {
  assert.equal(mergeLcov([]), "");
  assert.equal(mergeLcov(["TN:\n"]), "");
});

test("the merge command fails closed on a directory with no records", async (t) => {
  const directory = await temporaryDirectory(t, "verchestra-coverage-");
  const result = run(MERGE, [directory]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /merge-coverage: no LCOV records under /u);
  assert.deepEqual(await readdir(directory), []);
});

test("the merge command writes lcov.info from every scope report", async (t) => {
  const directory = await temporaryDirectory(t, "verchestra-coverage-");
  await writeFile(join(directory, "unit.lcov"), unitReport);
  await writeFile(join(directory, "integration.lcov"), integrationReport);
  assert.equal(run(MERGE, [directory]).status, 0);
  assert.equal(await readFile(join(directory, "lcov.info"), "utf8"), mergeLcov([integrationReport, unitReport]));
});

test("a scope writes LCOV only when VES_COVERAGE_DIR asks for it", async (t) => {
  const root = await temporaryDirectory(t, "verchestra-coverage-scope-");
  await mkdir(join(root, "cases"));
  await writeFile(join(root, "cases", "passing.test.mjs"), 'import test from "node:test"; test("passes", () => {});\n');
  const output = join(root, "out");

  assert.equal(run(SCOPE, ["unit", join(root, "cases")]).status, 0);
  assert.deepEqual(await readdir(root), ["cases"], "without the variable nothing is written");

  const result = run(SCOPE, ["unit", join(root, "cases")], { VES_COVERAGE_DIR: output });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await readdir(output), ["unit.lcov"]);
  assert.match(result.stdout, /passes/u, "the scope still reports its tests on stdout");
});
