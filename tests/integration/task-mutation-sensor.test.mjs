// invariant: verification's mutation sensor runs in a temporary repository
// (ADR2-4). It reverts one implementation file of the task commit in a scratch
// checkout the worktree module creates and removes, runs the gates that cover
// the criterion's requirement there, and counts the mutant killed exactly when
// the gate's own verdict fails. The user's checkout does not move.
import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { activeStateDigest, MutationSensor } from "../../apps/vestra-cli/src/task/task-mutation-sensor.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  git,
  objectFormatRepository,
  registeredWorktreeCount
} from "../helpers/git-object-format-fixture.mjs";

afterEach(cleanupObjectFormatRepositories);

// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement this suite does not test.
const requirement = (number) => ["VES", "EXE", String(number).padStart(3, "0")].join("-");
const VALUE = requirement(1);
const CREATED = requirement(2);
const UNWATCHED = requirement(3);
const SUMMARY = requirement(4);

const VALUE_TEST = [
  'import test from "node:test";',
  'import { readFileSync } from "node:fs";',
  'const implemented = readFileSync("src/value.txt", "utf8") === "implemented\\n";',
  'test("value", { todo: implemented ? false : "reverted" }, () => {});',
  'test("other", () => {});',
  ""
].join("\n");

function gate(gateId, requirementIds, overrides) {
  return {
    gateId,
    requirementIds,
    declaredCommand: `node ${gateId}`,
    commandRef: "node",
    args: [],
    cwd: ".",
    timeoutMs: 60_000,
    outputLimitBytes: 1_000_000,
    resultProtocol: "exit-code",
    minimumTests: 0,
    ...overrides
  };
}

const exits = (expression) => ["-e", `const fs = require("node:fs"); process.exit(${expression} ? 0 : 1)`];

const GATES = Object.freeze([
  gate("gate:value", [VALUE], { args: exits('fs.readFileSync("src/value.txt", "utf8") === "implemented\\n"') }),
  gate("gate:created", [CREATED], { args: exits('fs.existsSync("src/created.txt")') }),
  gate("gate:unwatched", [UNWATCHED], { args: exits("true") }),
  gate("gate:summary", [SUMMARY], {
    commandRef: "node-test",
    args: ["tests/value.test.mjs"],
    resultProtocol: "test-summary",
    minimumTests: 1
  })
]);

const PROFILES = Object.freeze({
  node: { executable: process.execPath, protocols: ["exit-code"] },
  "node-test": { executable: process.execPath, fixedArgs: ["--test"], protocols: ["test-summary"] }
});

// invariant: the task commit changes one file, creates one, and adds the test
// the summary gate runs; the user's checkout is left at that commit, clean.
async function taskRepository() {
  const repository = await objectFormatRepository(OBJECT_FORMATS[0]);
  const { repositoryRoot } = repository;
  await writeFile(join(repositoryRoot, "src", "value.txt"), "implemented\n");
  await writeFile(join(repositoryRoot, "src", "created.txt"), "created\n");
  await mkdir(join(repositoryRoot, "tests"));
  await writeFile(join(repositoryRoot, "tests", "value.test.mjs"), VALUE_TEST);
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "the task");
  const commitId = git(repositoryRoot, "rev-parse", "HEAD");
  const verificationRoot = join(repository.root, "verification");
  const sensor = new MutationSensor({
    workspace: { repositoryRoot, verificationRoot },
    runId: "run_sensor",
    sourceRevision: repository.baseCommit,
    changeScope: ["src"],
    gates: GATES,
    profiles: PROFILES
  });
  return { ...repository, commitId, sensor, verificationRoot };
}

function request(commitId, requirementId, path) {
  const criterionId = `AC-${requirementId}`;
  return {
    commitId,
    criterion: { criterionId, requirementId },
    mutation: {
      mutationId: `mutation:${requirementId}`,
      criterionId,
      operator: "revert-implementation",
      targetRef: `path:${path}`,
      expectedFailureRef: `gates:${requirementId}`
    },
    expectedOutcomeDigest: `sha256:${"0".repeat(64)}`
  };
}

for (const [label, requirementId, path, killed] of [
  ["a reverted file its gate reads is killed", VALUE, "src/value.txt", true],
  ["a removed file the task created is killed", CREATED, "src/created.txt", true],
  ["a reverted file no gate of its requirement reads survives", UNWATCHED, "src/value.txt", false],
  // why: the verifier's own copy of the verdict counted this mutant as
  // surviving; the gate would have refused to commit it.
  ["a mutant whose test summary reports a todo test is killed", SUMMARY, "src/value.txt", true]
]) {
  test(`${label}, in a scratch checkout that is gone afterwards`, async () => {
    const fixture = await taskRepository();
    const before = await activeStateDigest(fixture.repositoryRoot);
    const result = await fixture.sensor.run(request(fixture.commitId, requirementId, path));
    assert.equal(result.killed, killed);
    assert.equal(result.expectedFailureObserved, killed);
    assert.equal(result.scratchIsolationVerified, true);
    assert.match(result.evidenceRef, /^mutation:[a-f0-9]{32}$/u);
    assert.equal(result.activeStateBeforeDigest, before);
    assert.equal(result.activeStateAfterDigest, before);
    assert.equal(git(fixture.repositoryRoot, "rev-parse", "HEAD"), fixture.commitId);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
    assert.deepEqual(await readdir(join(fixture.verificationRoot, "run_sensor", "mutations")), []);
  });
}

test("a mutation target outside the change scope is refused and its checkout is still removed", async () => {
  const fixture = await taskRepository();
  await assert.rejects(fixture.sensor.run(request(fixture.commitId, VALUE, "tests/value.test.mjs")), {
    code: "VES_TASK_MUTATION_INVALID"
  });
  assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
  assert.deepEqual(await readdir(join(fixture.verificationRoot, "run_sensor", "mutations")), []);
});
