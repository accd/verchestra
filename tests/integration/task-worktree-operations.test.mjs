// invariant: the operations the CLI used to perform by hand on a worktree
// handle (ADP-1) are operations of the worktree module: cleanup from the handle
// alone, cleanup of the worktree that holds a given commit, and the scratch
// checkout of a commit (ADR2-4). Each runs on real git in the SHA-1 and
// SHA-256 object formats, so none of them can assume a 40-digit object ID.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeGateProcessRunner, NodeGitWorktreeAdapter } from "../../packages/platform-node/src/index.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  commitFixtureTask,
  git,
  objectFormatRepository,
  registeredWorktreeCount,
  taskBranches,
  taskWorktreeFixture
} from "../helpers/git-object-format-fixture.mjs";

const links = [];

afterEach(async () => {
  await cleanupObjectFormatRepositories();
  await Promise.all(links.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const TASK_BRANCH = "refs/heads/vestra/run_c1/T1";

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`cleanup from the handle alone removes a ${objectFormat} worktree`, async () => {
    const fixture = await taskWorktreeFixture(format);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
    await fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
    await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
    assert.equal(taskBranches(fixture.repositoryRoot), "");
    await fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef);
  });

  test(`cleanup from the handle alone anchors a verified ${objectFormat} task commit first`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { commitId } = await commitFixtureTask(fixture);
    assert.equal(commitId.length, format.objectIdLength);
    await fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef);
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
  });

  test(`cleanup from the handle alone refuses unexplained ${objectFormat} history and keeps the worktree`, async () => {
    const fixture = await taskWorktreeFixture(format);
    await writeFile(join(fixture.worktreePath, "src", "value.txt"), "unexplained\n");
    git(fixture.worktreePath, "commit", "--quiet", "-am", "an unexplained commit");
    await assert.rejects(fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef), {
      code: "VES_GIT_WORKTREE_CONFLICT"
    });
    await access(fixture.worktreePath);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
  });

  test(`cleanup from the handle alone refuses text that is not a ${objectFormat} handle`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { worktreeRef } = fixture.handle;
    for (const invalid of [worktreeRef.slice(0, -1), `${worktreeRef}0`, "worktree:self-test", ""])
      await assert.rejects(fixture.worktrees.cleanupHandle(invalid), { code: "VES_GIT_WORKTREE_INPUT_INVALID" });
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
  });

  test(`a registered ${objectFormat} worktree whose directory was deleted is reported as not found`, async () => {
    const fixture = await taskWorktreeFixture(format);
    await rm(fixture.worktreePath, { recursive: true, force: true });
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2, "git still lists the worktree");
    await assert.rejects(fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef), {
      code: "VES_GIT_WORKTREE_NOT_FOUND"
    });
    await assert.rejects(fixture.worktrees.cleanup(fixture.handle), { code: "VES_GIT_WORKTREE_NOT_FOUND" });
  });

  test(`cleanup at a commit anchors and removes the ${objectFormat} worktree that holds it`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { commitId } = await commitFixtureTask(fixture);
    const commit = { commitId, baseCommit: fixture.baseCommit };
    assert.equal(await fixture.worktrees.cleanupAtCommit(commit), true);
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
    assert.equal(await fixture.worktrees.cleanupAtCommit(commit), false, "nothing holds the commit any more");
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
  });

  test(`cleanup at a commit leaves ${objectFormat} worktrees at another commit or outside its root alone`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const { commitId } = await commitFixtureTask(fixture);
    const elsewhere = join(fixture.root, "elsewhere", "0123456789abcdef0123456789abcdef");
    git(fixture.repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", elsewhere, commitId);
    const unnamed = join(fixture.worktreesRoot, "review");
    git(fixture.repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", unnamed, commitId);
    assert.equal(
      await fixture.worktrees.cleanupAtCommit({ commitId: fixture.baseCommit, baseCommit: fixture.baseCommit }),
      false
    );
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 4);
    assert.equal(await fixture.worktrees.cleanupAtCommit({ commitId, baseCommit: fixture.baseCommit }), true);
    await access(elsewhere);
    await access(unnamed);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 3);
    await assert.rejects(
      fixture.worktrees.cleanupAtCommit({ commitId: commitId.slice(-40).slice(1), baseCommit: "" }),
      {
        code: "VES_GIT_WORKTREE_INPUT_INVALID"
      }
    );
  });

  // why: a state root reached through a link (a linked home directory, macOS
  // /var, a Windows short name) lists its worktrees under the real path. The
  // comparison the CLI used to make by hand kept the linked path, found no
  // worktree, and silently skipped anchoring.
  test(`cleanup at a commit finds the ${objectFormat} worktree through a linked state root`, async () => {
    const linkParent = await mkdtemp(join(tmpdir(), "verchestra-git-link-"));
    links.push(linkParent);
    const fixture = await taskWorktreeFixture(format, {
      worktreesRoot: async (repository) => {
        await mkdir(join(repository.root, "real-state"), { recursive: true });
        await symlink(join(repository.root, "real-state"), join(linkParent, "state"), "junction");
        return join(linkParent, "state", "worktrees");
      }
    });
    assert.notEqual(fixture.worktreePath, join(fixture.worktreesRoot, fixture.handle.worktreeRef.split(":")[1]));
    const { commitId } = await commitFixtureTask(fixture);
    assert.equal(await fixture.worktrees.cleanupAtCommit({ commitId, baseCommit: fixture.baseCommit }), true);
    assert.equal(taskBranches(fixture.repositoryRoot), `${TASK_BRANCH} ${commitId}`);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
  });

  test(`a scratch checkout of a ${objectFormat} commit is registered for its use, accepted by the gate runner, and removed after`, async () => {
    const { root, repositoryRoot, baseCommit } = await objectFormatRepository(format);
    const scratchRoot = join(root, "verification", "mutations");
    const checkouts = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot: scratchRoot });
    const runner = new NodeGateProcessRunner({
      repositoryRoot,
      worktreesRoot: scratchRoot,
      commands: { node: { executable: process.execPath, protocols: ["exit-code"] } }
    });
    let seen;
    const result = await checkouts.withScratchCheckout(
      { name: "mutation:1", commitId: baseCommit },
      async (checkout) => {
        seen = checkout;
        assert.equal(dirname(checkout.directory), await realpath(scratchRoot));
        assert.equal(git(checkout.directory, "rev-parse", "HEAD"), baseCommit);
        assert.equal(registeredWorktreeCount(repositoryRoot), 2);
        return runner.run({ ...SCRATCH_GATE, worktreeRef: checkout.worktreeRef });
      }
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    await assert.rejects(access(seen.directory), { code: "ENOENT" });
    assert.equal(registeredWorktreeCount(repositoryRoot), 1);
  });
}

const SCRATCH_GATE = Object.freeze({
  gateId: "gate:value",
  commandRef: "node",
  args: ["-e", 'process.exit(require("node:fs").readFileSync("src/value.txt", "utf8") === "base\\n" ? 0 : 1)'],
  cwd: ".",
  timeoutMs: 60_000,
  outputLimitBytes: 1_000_000,
  resultProtocol: "exit-code"
});

async function scratchFixture() {
  const repository = await objectFormatRepository(OBJECT_FORMATS[0]);
  const scratchRoot = join(repository.root, "verification", "review");
  const checkouts = new NodeGitWorktreeAdapter({
    repositoryRoot: repository.repositoryRoot,
    worktreesRoot: scratchRoot
  });
  const directory = await checkouts.withScratchCheckout(
    { name: "review", commitId: repository.baseCommit },
    async (checkout) => checkout.directory
  );
  return { ...repository, scratchRoot, checkouts, directory };
}

test("a use that fails still has its scratch checkout removed, and its failure is the one reported", async () => {
  const { checkouts, baseCommit, directory, repositoryRoot } = await scratchFixture();
  const failure = new Error("the use failed");
  await assert.rejects(
    checkouts.withScratchCheckout({ name: "review", commitId: baseCommit }, async () => {
      throw failure;
    }),
    (error) => error === failure
  );
  await assert.rejects(access(directory), { code: "ENOENT" });
  assert.equal(registeredWorktreeCount(repositoryRoot), 1);
});

// why: a verification that is killed leaves its checkout registered and
// changed; the resumed one must judge the commit, not the leftover.
test("a checkout a killed verification left under the same name is replaced, not reused", async () => {
  const { checkouts, baseCommit, directory, repositoryRoot } = await scratchFixture();
  git(repositoryRoot, "worktree", "add", "--quiet", "--detach", "--", directory, baseCommit);
  await writeFile(join(directory, "src", "value.txt"), "left by a killed verification\n");
  await writeFile(join(directory, "leftover.txt"), "untracked\n");
  await checkouts.withScratchCheckout({ name: "review", commitId: baseCommit }, async (checkout) => {
    assert.equal(checkout.directory, directory);
    assert.equal(await readFile(join(checkout.directory, "src", "value.txt"), "utf8"), "base\n");
    await assert.rejects(access(join(checkout.directory, "leftover.txt")), { code: "ENOENT" });
  });
  assert.equal(registeredWorktreeCount(repositoryRoot), 1);
});

// invariant: the defect this replaces. The composition root removed its
// scratch checkouts with every Git failure swallowed, so a checkout Git kept
// registered was left behind in silence.
test("a scratch checkout Git keeps registered after its removal is reported", async () => {
  const { checkouts, baseCommit, repositoryRoot } = await scratchFixture();
  await assert.rejects(
    checkouts.withScratchCheckout({ name: "review", commitId: baseCommit }, async (checkout) => {
      git(repositoryRoot, "worktree", "lock", "--reason", "held by a test", "--", checkout.directory);
      return "the use succeeded";
    }),
    { code: "VES_GIT_WORKTREE_COMMAND_FAILED", message: "Scratch checkout is still registered after its removal" }
  );
  assert.equal(registeredWorktreeCount(repositoryRoot), 2, "the locked checkout is still registered");
});

test("a link in the scratch checkout's place is refused before anything is deleted through it", async () => {
  const { checkouts, baseCommit, directory, root } = await scratchFixture();
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await writeFile(join(elsewhere, "keep.txt"), "not a scratch checkout\n");
  await symlink(elsewhere, directory, "junction");
  let used = false;
  await assert.rejects(
    checkouts.withScratchCheckout({ name: "review", commitId: baseCommit }, async () => {
      used = true;
    }),
    { code: "VES_GIT_WORKTREE_ESCAPE" }
  );
  assert.equal(used, false);
  assert.equal(await readFile(join(elsewhere, "keep.txt"), "utf8"), "not a scratch checkout\n");
});

test("a scratch checkout of text that is not a complete object ID is refused before any effect", async () => {
  const { repositoryRoot, baseCommit, root } = await objectFormatRepository(OBJECT_FORMATS[0]);
  const scratchRoot = join(root, "verification", "mutations");
  const checkouts = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot: scratchRoot });
  for (const commitId of [baseCommit.slice(1), `${baseCommit}0`, "HEAD", ""])
    await assert.rejects(
      checkouts.withScratchCheckout({ name: "review", commitId }, async () => undefined),
      { code: "VES_GIT_WORKTREE_INPUT_INVALID" },
      commitId
    );
  await assert.rejects(access(scratchRoot), { code: "ENOENT" });
});

// invariant: the defect this replaces. A 64-digit base cut to its last 40
// digits names no worktree, so the cleanup it was passed to refused and the
// caller's catch hid the refusal.
test("the last 40 digits of a SHA-256 handle are not its base, and cleanup refuses them", async () => {
  const fixture = await taskWorktreeFixture(OBJECT_FORMATS[1]);
  const { worktreeRef } = fixture.handle;
  await assert.rejects(fixture.worktrees.cleanup({ worktreeRef, baseCommit: worktreeRef.slice(-40) }), {
    code: "VES_GIT_WORKTREE_INPUT_INVALID"
  });
  assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
  await fixture.worktrees.cleanupHandle(worktreeRef);
  assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
});
