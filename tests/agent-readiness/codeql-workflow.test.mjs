// Issue #131: the ruleset requires a check context named `CodeQL`, and the
// default setup produces no check at all for a pull request from a fork. A
// required check that never reports can never be satisfied, so an outside
// contribution cannot reach a mergeable state however green it is.
//
// An in-repository workflow closes that, but it introduces a failure mode the
// default setup did not have: an aggregate job carrying the required name can
// report success while the analysis it depends on failed. These tests hold that
// shut.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/codeql.yml", import.meta.url), "utf8");

// The languages the repository's scanning actually resolves to. Replacing the
// default setup must change who is scanned, never what is scanned.
const ANALYZED_LANGUAGES = ["actions", "javascript-typescript"];

test("the workflow publishes the exact check context the ruleset requires", () => {
  // `Analyze (<language>)` is what a matrix produces, so a job must carry the
  // bare `CodeQL` name or the required context is never satisfied.
  assert.match(workflow, /^ {2}codeql:$/mu);
  assert.match(workflow, /^ {4}name: CodeQL$/mu);
  assert.match(workflow, /^ {4}needs: \[analyze\]$/mu);
});

test("the aggregate check fails when the analysis it names did not succeed", () => {
  // Without this the job is a rubber stamp: it would report success on a branch
  // whose analysis errored, which is worse than the gap it replaces because it
  // looks like coverage.
  assert.match(workflow, /^ {4}if: always\(\)$/mu);
  assert.match(workflow, /if: needs\.analyze\.result != 'success'/u);
  assert.match(workflow, /exit 1/u);
});

test("the analysis runs for pull requests, which is the gap being closed", () => {
  assert.match(workflow, /^ {2}pull_request:\n {4}branches: \[main\]$/mu);
  assert.match(workflow, /^ {2}push:\n {4}branches: \[main\]$/mu);
  // The default setup also scans on a cadence; dropping that would be a quiet
  // reduction in coverage rather than a migration.
  assert.match(workflow, /^ {2}schedule:$/mu);
});

test("every analyzed language of the configuration it replaces is covered", () => {
  const matrix = /language: \[([^\]]+)\]/u.exec(workflow);
  assert.ok(matrix, "the workflow must declare its languages in a closed list");
  assert.deepEqual(
    matrix[1]
      .split(",")
      .map((entry) => entry.trim())
      .sort(),
    [...ANALYZED_LANGUAGES].sort()
  );
});

test("every action is pinned to a commit with the version it claims", () => {
  const uses = [...workflow.matchAll(/uses: (\S+)@([a-f0-9]{40}) # (\S+)/gu)];
  assert.equal(uses.length, 3, "checkout plus codeql init and analyze");
  for (const [, action, , version] of uses)
    assert.ok(version.length > 0, `${action} must record the version its SHA resolves to`);
  // init and analyze ship from one repository, so a split pin would mean one of
  // them was updated without the other.
  const codeql = uses.filter(([, action]) => action.startsWith("github/codeql-action/"));
  assert.equal(codeql.length, 2);
  assert.equal(new Set(codeql.map(([, , sha]) => sha)).size, 1, "codeql-action steps must share one pin");
});

test("the workflow grants no more than the analysis needs", () => {
  // Read-only at the top, write scoped to the job that uploads results. A
  // workflow-wide write would hand every job in the file more authority than the
  // work requires.
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.match(workflow, /^ {6}security-events: write$/mu);
  assert.doesNotMatch(workflow, /^permissions:\n {2}security-events: write/mu);
});
