import assert from "node:assert/strict";
import { access, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeAtomicGitCommitAdapter, NodeGitWorktreeAdapter } from "../../packages/platform-node/src/index.ts";
import { cleanupWorktreeTools, git, worktreeToolFixture } from "../helpers/worktree-tool-fixture.mjs";

afterEach(cleanupWorktreeTools);

const digest = (character) => `sha256:${character.repeat(64)}`;
const branch = (repositoryRoot) =>
  git(repositoryRoot, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/vestra/");

async function commitTask(fixture) {
  await writeFile(join(fixture.worktreePath, "src", "value.txt"), "implemented\n");
  const inspection = await fixture.worktrees.inspect(fixture.handle);
  const receipt = await new NodeAtomicGitCommitAdapter({
    repositoryRoot: fixture.repositoryRoot,
    worktreesRoot: fixture.worktreesRoot
  }).commitAtomic({
    workspaceId: "workspace_tool",
    runId: "run_405",
    taskId: "T405.3",
    requirementIds: ["VES-EXE-001"],
    worktreeRef: fixture.handle.worktreeRef,
    baseCommit: fixture.baseCommit,
    subject: "feat(app): implement the task",
    expectedChangedPaths: inspection.changedPaths,
    expectedChangeDigest: inspection.changeDigest,
    gatePlanDigest: digest("1"),
    gateEvidenceDigest: digest("2"),
    gateEvidenceRefs: ["evidence:gate:1"],
    idempotencyKey: digest("3")
  });
  return receipt.commitId;
}

test("cleanup anchors the verified task commit on its task branch before removing the worktree", async () => {
  const fixture = await worktreeToolFixture({ anchorTaskCommits: true });
  const commitId = await commitTask(fixture);
  await fixture.worktrees.cleanup(fixture.handle);
  assert.equal(branch(fixture.repositoryRoot), `refs/heads/vestra/run_405/T405.3 ${commitId}`);
  await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
  assert.equal(git(fixture.repositoryRoot, "cat-file", "-t", commitId), "commit");
  await fixture.worktrees.cleanup(fixture.handle);
  assert.equal(branch(fixture.repositoryRoot), `refs/heads/vestra/run_405/T405.3 ${commitId}`);
});

test("an existing task branch at another commit keeps the worktree and the branch untouched", async () => {
  const fixture = await worktreeToolFixture({ anchorTaskCommits: true });
  git(fixture.repositoryRoot, "update-ref", "refs/heads/vestra/run_405/T405.3", fixture.baseCommit);
  await commitTask(fixture);
  await assert.rejects(fixture.worktrees.cleanup(fixture.handle), { code: "VES_GIT_WORKTREE_CONFLICT" });
  assert.equal(branch(fixture.repositoryRoot), `refs/heads/vestra/run_405/T405.3 ${fixture.baseCommit}`);
  await access(fixture.worktreePath);
});

test("a commit without verified task trailers is never anchored and its worktree is kept", async () => {
  const fixture = await worktreeToolFixture({ anchorTaskCommits: true });
  await writeFile(join(fixture.worktreePath, "src", "value.txt"), "unexplained\n");
  git(fixture.worktreePath, "commit", "--quiet", "-am", "an unexplained commit");
  await assert.rejects(fixture.worktrees.cleanup(fixture.handle), { code: "VES_GIT_WORKTREE_CONFLICT" });
  assert.equal(branch(fixture.repositoryRoot), "");
  await access(fixture.worktreePath);
});

test("a worktree without a task commit is removed without creating a branch", async () => {
  const fixture = await worktreeToolFixture({ anchorTaskCommits: true });
  await fixture.worktrees.cleanup(fixture.handle);
  assert.equal(branch(fixture.repositoryRoot), "");
  await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
});

test("the default adapter keeps its previous cleanup behavior and creates no task branch", async () => {
  const fixture = await worktreeToolFixture();
  await commitTask(fixture);
  await fixture.worktrees.cleanup(fixture.handle);
  assert.equal(branch(fixture.repositoryRoot), "");
  await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
});

test("anchoring refuses run and task IDs that cannot name a task branch before creating a worktree", async () => {
  const fixture = await worktreeToolFixture();
  const anchoring = new NodeGitWorktreeAdapter({
    repositoryRoot: fixture.repositoryRoot,
    worktreesRoot: fixture.worktreesRoot,
    anchorTaskCommits: true
  });
  const before = await readdir(fixture.worktreesRoot);
  for (const [runId, taskId] of [
    ["run:405", "T405.3"],
    ["run_405", "T405/3"],
    ["run_405", "T405..3"],
    ["run_405", "T405.lock"]
  ]) {
    await assert.rejects(
      anchoring.create({
        workspaceId: "workspace_tool",
        runId,
        taskId,
        sourceStateDigest: digest("4"),
        sourceRevision: fixture.baseCommit,
        changeScope: ["src"],
        protectedPaths: [".git"]
      }),
      { code: "VES_GIT_WORKTREE_INPUT_INVALID" },
      `${runId}/${taskId}`
    );
  }
  assert.deepEqual(await readdir(fixture.worktreesRoot), before);
});
