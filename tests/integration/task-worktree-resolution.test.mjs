// invariant: a worktree handle is resolved in one place (ADR2-4). The worktree
// module reads the handle before any effect, qualifies both roots, and proves
// the directory registered by Git, real, and contained in its root. The
// worktree adapter, the gate runner and the commit adapter each answer the
// module's refusals with the public codes they have always reported.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  NodeAtomicGitCommitAdapter,
  NodeGateProcessRunner,
  NodeGitWorktreeAdapter
} from "../../packages/platform-node/src/index.ts";
import { resolveWorktreeHandle, WorktreeRefusalError } from "../../packages/platform-node/src/task-worktree.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  git,
  objectFormatRepository,
  taskWorktreeFixture
} from "../helpers/git-object-format-fixture.mjs";

const links = [];
const SHA1 = OBJECT_FORMATS[0];
const UNLISTED_ID = "0123456789abcdef0123456789abcdef";
const digest = (character) => `sha256:${character.repeat(64)}`;
// why: a requirement ID spelled out here would enter the requirements register
// scan as evidence for a requirement this suite does not test.
const REQUIREMENT_ID = ["VES", "EXE", "001"].join("-");

afterEach(async () => {
  await cleanupObjectFormatRepositories();
  await Promise.all(links.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const rootsOf = ({ repositoryRoot, worktreesRoot }) => ({ repositoryRoot, worktreesRoot });

function refused(refusal) {
  return (error) => {
    assert.ok(error instanceof WorktreeRefusalError, `expected a refusal, got ${error}`);
    assert.equal(error.refusal, refusal);
    return true;
  };
}

async function linkParent() {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-resolution-link-"));
  links.push(parent);
  return parent;
}

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`a ${objectFormat} handle resolves to its registered canonical directory and the HEAD Git lists`, async () => {
    const fixture = await taskWorktreeFixture(format);
    const [id, baseCommit] = fixture.handle.worktreeRef.split(":").slice(1);
    const resolved = await resolveWorktreeHandle(rootsOf(fixture), fixture.handle.worktreeRef);
    assert.deepEqual(resolved.handle, { id, baseCommit });
    assert.equal(resolved.directory, join(await realpath(fixture.worktreesRoot), id));
    assert.equal(resolved.directory, fixture.worktreePath);
    assert.equal(resolved.repositoryRoot, await realpath(fixture.repositoryRoot));
    assert.equal(resolved.head, fixture.baseCommit);
    const bound = await resolveWorktreeHandle(rootsOf(fixture), fixture.handle.worktreeRef, { baseCommit });
    assert.equal(bound.directory, resolved.directory);
  });
}

test("text that is not a handle, or a handle bound to another base, is refused before any effect", async () => {
  const repository = await objectFormatRepository(SHA1);
  const valid = `worktree:${UNLISTED_ID}:${repository.baseCommit}`;
  for (const text of ["", "worktree:self-test", `${valid}0`, valid.slice(0, -1), `worktree:../${UNLISTED_ID}:a`])
    await assert.rejects(resolveWorktreeHandle(rootsOf(repository), text), refused("handle"), text);
  await assert.rejects(
    resolveWorktreeHandle(rootsOf(repository), valid, { baseCommit: "a".repeat(40) }),
    refused("handle")
  );
  await assert.rejects(access(repository.worktreesRoot), { code: "ENOENT" }, "a refused handle created a root");
});

test("a repository root that does not exist or is bare is refused", async () => {
  const repository = await objectFormatRepository(SHA1);
  const handle = `worktree:${UNLISTED_ID}:${repository.baseCommit}`;
  const absent = { ...rootsOf(repository), repositoryRoot: join(repository.root, "absent") };
  await assert.rejects(resolveWorktreeHandle(absent, handle), refused("repository"));
  const bare = join(repository.root, "bare.git");
  git(repository.root, "init", "--quiet", "--bare", bare);
  await assert.rejects(
    resolveWorktreeHandle({ ...rootsOf(repository), repositoryRoot: bare }, handle),
    refused("repository")
  );
});

test("a worktrees root whose own entry is a link, or that is the repository root, is refused", async () => {
  const fixture = await taskWorktreeFixture(SHA1);
  const linkedRoot = join(await linkParent(), "worktrees");
  await symlink(fixture.worktreesRoot, linkedRoot, "junction");
  await assert.rejects(
    resolveWorktreeHandle({ ...rootsOf(fixture), worktreesRoot: linkedRoot }, fixture.handle.worktreeRef),
    (error) => refused("root")(error) && error.message === "Worktree root is not a real directory"
  );
  await assert.rejects(
    resolveWorktreeHandle(
      { repositoryRoot: fixture.repositoryRoot, worktreesRoot: fixture.repositoryRoot },
      fixture.handle.worktreeRef
    ),
    refused("root")
  );
});

// why: macOS temp directories resolve /var -> /private/var and Windows returns
// 8.3 short names; a directory link reproduces that canonicalization on every
// platform, and the resolution must operate through it (T75 F3 and F5).
test("roots reached through a canonicalizing link resolve to the canonical directory", async () => {
  const fixture = await taskWorktreeFixture(SHA1);
  const alias = join(await linkParent(), "alias");
  await symlink(fixture.root, alias, "junction");
  assert.notEqual(alias, await realpath(alias), "the alias must actually canonicalize to a different path");
  const resolved = await resolveWorktreeHandle(
    { repositoryRoot: join(alias, "repository"), worktreesRoot: join(alias, "worktrees") },
    fixture.handle.worktreeRef
  );
  assert.equal(resolved.directory, fixture.worktreePath);
});

test("a directory Git does not list is unregistered, and a listed one that is gone is missing", async () => {
  const fixture = await taskWorktreeFixture(SHA1);
  await mkdir(join(fixture.worktreesRoot, UNLISTED_ID));
  await assert.rejects(
    resolveWorktreeHandle(rootsOf(fixture), `worktree:${UNLISTED_ID}:${fixture.baseCommit}`),
    refused("unregistered")
  );
  await rm(fixture.worktreePath, { recursive: true, force: true });
  await assert.rejects(resolveWorktreeHandle(rootsOf(fixture), fixture.handle.worktreeRef), refused("missing"));
});

test("a registered worktree directory replaced by a link is refused as an escape", async () => {
  const fixture = await taskWorktreeFixture(SHA1);
  const moved = join(await linkParent(), "moved");
  await rename(fixture.worktreePath, moved);
  await symlink(moved, fixture.worktreePath, "junction");
  await assert.rejects(resolveWorktreeHandle(rootsOf(fixture), fixture.handle.worktreeRef), refused("escape"));
});

// invariant: the adapters' public codes for every refusal of the one
// resolution. Each row builds its own case and asks all three adapters.
const CASES = Object.freeze([
  {
    refusal: "handle",
    build: async (fixture) => ({ ...fixture, worktreeRef: "worktree:self-test" }),
    codes: ["VES_GIT_WORKTREE_INPUT_INVALID", "VES_GATE_ADAPTER_HANDLE_INVALID", "VES_GATE_ADAPTER_HANDLE_INVALID"]
  },
  {
    refusal: "repository",
    build: async (fixture) => ({ ...fixture, repositoryRoot: join(fixture.root, "absent") }),
    codes: ["VES_GIT_WORKTREE_INPUT_INVALID", "VES_GATE_ADAPTER_INPUT_INVALID", "VES_GATE_ADAPTER_INPUT_INVALID"]
  },
  {
    refusal: "root",
    build: async (fixture) => {
      const worktreesRoot = join(await linkParent(), "worktrees");
      await symlink(fixture.worktreesRoot, worktreesRoot, "junction");
      return { ...fixture, worktreesRoot };
    },
    codes: ["VES_GIT_WORKTREE_ESCAPE", "VES_GATE_ADAPTER_PATH_ESCAPE", "VES_GATE_ADAPTER_PATH_ESCAPE"]
  },
  {
    refusal: "unregistered",
    build: async (fixture) => {
      await mkdir(join(fixture.worktreesRoot, UNLISTED_ID));
      return { ...fixture, worktreeRef: `worktree:${UNLISTED_ID}:${fixture.baseCommit}` };
    },
    codes: ["VES_GIT_WORKTREE_NOT_FOUND", "VES_GATE_ADAPTER_HANDLE_INVALID", "VES_GATE_ADAPTER_HANDLE_INVALID"]
  },
  {
    refusal: "missing",
    build: async (fixture) => {
      await rm(fixture.worktreePath, { recursive: true, force: true });
      return fixture;
    },
    codes: ["VES_GIT_WORKTREE_NOT_FOUND", "VES_GATE_ADAPTER_HANDLE_INVALID", "VES_GATE_ADAPTER_HANDLE_INVALID"]
  },
  {
    refusal: "escape",
    build: async (fixture) => {
      const moved = join(await linkParent(), "moved");
      await rename(fixture.worktreePath, moved);
      await symlink(moved, fixture.worktreePath, "junction");
      return fixture;
    },
    codes: ["VES_GIT_WORKTREE_ESCAPE", "VES_GATE_ADAPTER_PATH_ESCAPE", "VES_GATE_ADAPTER_PATH_ESCAPE"]
  }
]);

function commitRequest(baseCommit, worktreeRef) {
  return {
    workspaceId: "workspace_c1",
    runId: "run_c1",
    taskId: "T1",
    requirementIds: [REQUIREMENT_ID],
    worktreeRef,
    baseCommit,
    subject: "feat(src): implement the task",
    expectedChangedPaths: ["src/value.txt"],
    expectedChangeDigest: digest("4"),
    gatePlanDigest: digest("1"),
    gateEvidenceDigest: digest("5"),
    gateEvidenceRefs: ["evidence:gate:1"],
    idempotencyKey: digest("3")
  };
}

const GATE = Object.freeze({
  gateId: "gate:node",
  commandRef: "node",
  args: ["-e", "process.exit(0)"],
  cwd: ".",
  timeoutMs: 60_000,
  outputLimitBytes: 1_000_000,
  resultProtocol: "exit-code"
});

async function codesFor(scenario) {
  const roots = rootsOf(scenario);
  const worktreeRef = scenario.worktreeRef ?? scenario.handle.worktreeRef;
  const code = (operation) =>
    operation.then(
      () => "accepted",
      (error) => error.code
    );
  return [
    await code(new NodeGitWorktreeAdapter(roots).resolvePath(worktreeRef)),
    await code(
      new NodeGateProcessRunner({
        ...roots,
        commands: { node: { executable: process.execPath, protocols: ["exit-code"] } }
      }).run({ ...GATE, worktreeRef })
    ),
    await code(new NodeAtomicGitCommitAdapter(roots).reconcile(commitRequest(scenario.baseCommit, worktreeRef)))
  ];
}

for (const { refusal, build, codes } of CASES) {
  test(`each adapter answers a ${refusal} refusal with its own public code`, async () => {
    const scenario = await build(await taskWorktreeFixture(SHA1));
    assert.deepEqual(await codesFor(scenario), codes);
  });
}

test("the gate runner refuses a registered worktree that has moved off its handle's commit", async () => {
  const fixture = await taskWorktreeFixture(SHA1);
  git(fixture.worktreePath, "commit", "--quiet", "--allow-empty", "-m", "a commit on top");
  const runner = new NodeGateProcessRunner({
    ...rootsOf(fixture),
    commands: { node: { executable: process.execPath, protocols: ["exit-code"] } }
  });
  await assert.rejects(runner.run({ ...GATE, worktreeRef: fixture.handle.worktreeRef }), {
    code: "VES_GATE_ADAPTER_HANDLE_INVALID",
    message: "Gate target is not the expected registered worktree"
  });
});
