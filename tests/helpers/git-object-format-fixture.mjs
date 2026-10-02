// invariant: a disposable Git repository in a named object format, created
// with the fixed system git. The SHA-256 cases exist to prove that no task
// worktree operation assumes a 40-digit object ID, so a repository that is not
// in the requested format must fail the test instead of passing as SHA-1.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemGit } from "./system-git.mjs";

export const OBJECT_FORMATS = Object.freeze([
  Object.freeze({ objectFormat: "sha1", objectIdLength: 40 }),
  Object.freeze({ objectFormat: "sha256", objectIdLength: 64 })
]);

const roots = [];

export function git(cwd, ...args) {
  return execFileSync(systemGit(), args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function initialize(repositoryRoot, objectFormat) {
  try {
    git(repositoryRoot, "init", "--quiet", `--object-format=${objectFormat}`, "-b", "main");
  } catch (error) {
    assert.fail(
      `the installed git (${git(repositoryRoot, "--version")}) cannot create a ${objectFormat} repository; ` +
        `git 2.29 or newer is required and this test does not pass without it: ${String(error.stderr ?? error)}`
    );
  }
  assert.equal(
    git(repositoryRoot, "rev-parse", "--show-object-format"),
    objectFormat,
    `the fixture repository is not in the ${objectFormat} object format`
  );
}

export async function objectFormatRepository({ objectFormat, objectIdLength }) {
  const root = await mkdtemp(join(tmpdir(), `verchestra-git-${objectFormat}-`));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await writeFile(join(repositoryRoot, "src", "value.txt"), "base\n");
  initialize(repositoryRoot, objectFormat);
  // why: a Windows runner converts LF to CRLF on checkout by default, so the
  // worktree would not hold the committed bytes the assertions compare.
  git(repositoryRoot, "config", "core.autocrlf", "false");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "config", "commit.gpgsign", "false");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "base");
  const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
  assert.equal(baseCommit.length, objectIdLength, `a ${objectFormat} commit ID has ${objectIdLength} digits`);
  return { root, repositoryRoot, worktreesRoot: join(root, "worktrees"), baseCommit };
}

export async function cleanupObjectFormatRepositories() {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
}

const digest = (character) => `sha256:${character.repeat(64)}`;
// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement these suites do not test.
const REQUIREMENT_ID = ["VES", "EXE", "001"].join("-");

// invariant: a task worktree as a run creates it: registered by the real
// adapter under the fixture's worktrees root, with task-commit anchoring on.
export async function taskWorktreeFixture(format, options = {}) {
  const { NodeGitWorktreeAdapter } = await import("../../packages/platform-node/src/index.ts");
  const repository = await objectFormatRepository(format);
  const worktreesRoot = (await options.worktreesRoot?.(repository)) ?? repository.worktreesRoot;
  const { repositoryRoot } = repository;
  const worktrees = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot, anchorTaskCommits: true });
  const handle = await worktrees.create({
    workspaceId: "workspace_c1",
    runId: "run_c1",
    taskId: "T1",
    sourceStateDigest: digest("2"),
    sourceRevision: repository.baseCommit,
    changeScope: ["src"],
    protectedPaths: [".git"]
  });
  assert.equal(handle.baseCommit.length, format.objectIdLength);
  const worktreePath = await worktrees.resolvePath(handle.worktreeRef);
  return { ...repository, repositoryRoot, worktreesRoot, worktrees, handle, worktreePath };
}

// invariant: the one verified task commit of the fixture's run is written by
// the real atomic commit adapter, so its trailers are the ones a run writes.
export async function commitFixtureTask(fixture, overrides = {}) {
  const { NodeAtomicGitCommitAdapter } = await import("../../packages/platform-node/src/index.ts");
  await writeFile(join(fixture.worktreePath, "src", "value.txt"), "implemented\n");
  const inspection = await fixture.worktrees.inspect(fixture.handle);
  const receipt = await new NodeAtomicGitCommitAdapter({
    repositoryRoot: fixture.repositoryRoot,
    worktreesRoot: fixture.worktreesRoot
  }).commitAtomic({
    workspaceId: "workspace_c1",
    runId: "run_c1",
    taskId: "T1",
    requirementIds: [REQUIREMENT_ID],
    worktreeRef: fixture.handle.worktreeRef,
    baseCommit: fixture.baseCommit,
    subject: "feat(src): implement the task",
    expectedChangedPaths: inspection.changedPaths,
    expectedChangeDigest: inspection.changeDigest,
    gatePlanDigest: digest("1"),
    gateEvidenceDigest: digest("5"),
    gateEvidenceRefs: ["evidence:gate:1"],
    idempotencyKey: digest("3"),
    ...overrides
  });
  return { commitId: receipt.commitId, changeDigest: inspection.changeDigest };
}

export function registeredWorktreeCount(repositoryRoot) {
  return git(repositoryRoot, "worktree", "list", "--porcelain")
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("worktree ")).length;
}

export function taskBranches(repositoryRoot) {
  return git(repositoryRoot, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/vestra/");
}
