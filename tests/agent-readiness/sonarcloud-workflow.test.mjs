// SonarCloud runs as a CI analysis so it can import coverage. These tests hold
// the properties that make that analysis honest: it measures the product code,
// uploads a report that exists, and never hands its token to the code under
// review.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const workflow = read(".github/workflows/sonarcloud.yml");
const properties = read("sonar-project.properties");

function property(key) {
  const joined = properties.replace(/\\\r?\n\s*/gu, "");
  const match = new RegExp(`^${key.replaceAll(".", "\\.")}=(.*)$`, "mu").exec(joined);
  assert.ok(match, `sonar-project.properties must declare ${key}`);
  return match[1].trim();
}

test("the analysis targets the project and imports the merged coverage report", () => {
  assert.equal(property("sonar.projectKey"), "accd_verchestra");
  assert.equal(property("sonar.organization"), "verchestra");
  assert.equal(property("sonar.javascript.lcov.reportPaths"), "coverage/lcov.info");
  assert.match(workflow, /^ {6}VES_COVERAGE_DIR: coverage$/mu);
  assert.match(workflow, /node scripts\/merge-coverage\.mjs coverage$/mu);
});

test("test code is analysed as tests, never as product sources", () => {
  const tests = property("sonar.test.inclusions").split(",");
  const excluded = property("sonar.exclusions").split(",");
  for (const pattern of ["tests/**", "apps/site/tests/**", "spikes/*/test/**", "**/*.test.*"]) {
    assert.ok(tests.includes(pattern), `${pattern} must be a test inclusion`);
    assert.ok(excluded.includes(pattern), `${pattern} must be excluded from sources`);
  }
  assert.ok(excluded.includes("packages/contracts/src/generated.ts"), "generated contracts are not hand-written code");
});

test("coverage is measured by the in-process scopes of gate:full", () => {
  assert.match(workflow, /for stage in test:unit test:contract test:integration test:fault; do/u);
});

test("runs for pull requests and main, with read-only defaults", () => {
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]$/mu);
  assert.match(workflow, /^ {2}pull_request:\n {4}branches: \[main\]$/mu);
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.doesNotMatch(workflow, /: write$/mu);
  assert.match(workflow, /fetch-depth: 0/u, "new-code detection needs the full history");
});

test("the token reaches only the presence check and the scan, never the test steps", () => {
  const steps = workflow.split(/^ {6}- name: /mu).slice(1);
  const holders = steps.filter((step) => step.includes("secrets.SONAR_TOKEN")).map((step) => step.split("\n")[0]);
  assert.deepEqual(holders, ["Check the analysis token", "Analyze"]);
  assert.doesNotMatch(workflow.split(/^ {4}steps:$/mu)[0], /SONAR_TOKEN/u, "no job- or workflow-level token");
  assert.match(workflow, /if: steps\.token\.outputs\.configured == 'true'/u);
});

test("every action is pinned to a commit with the version it claims", () => {
  const uses = [...workflow.matchAll(/uses: (\S+)/gu)].map((match) => match[1]);
  const pinned = [...workflow.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (v\S+)/gu)];
  assert.equal(pinned.length, uses.length, "no action may float on a tag or branch");
  assert.ok(
    pinned.some(([, action]) => action === "SonarSource/sonarqube-scan-action"),
    "the scan uses the official action"
  );
});
