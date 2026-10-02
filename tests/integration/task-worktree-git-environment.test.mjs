// invariant: every git process of the task path runs with a scrubbed
// environment (ADP-1). Git reads its repository, index, configuration, and
// helper programs from GIT_* variables before it looks at its working
// directory, so an inherited environment could aim a worktree operation at
// another repository. These cases plant such an environment in this process
// and prove that the runner, the worktree adapter, the commit adapter, and
// the gate runner still act only on the repository they were given, while git
// still finds the user's configuration and commit identity.
import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeGateProcessRunner } from "../../packages/platform-node/src/index.ts";
import { gitEnvironment, runGit, runGitBytes } from "../../packages/platform-node/src/task-worktree.ts";
import {
  OBJECT_FORMATS,
  cleanupObjectFormatRepositories,
  commitFixtureTask,
  createTaskWorktree,
  git,
  objectFormatRepository,
  registeredWorktreeCount,
  taskBranches,
  taskWorktreeFixture
} from "../helpers/git-object-format-fixture.mjs";

const roots = [];
const SHA256 = OBJECT_FORMATS[1];
const ADMITTED = Object.freeze([
  "CI",
  "FORCE_COLOR",
  "NO_COLOR",
  "PATH",
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL"
]);

afterEach(async () => {
  await cleanupObjectFormatRepositories();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

// hazard: the fixture's own git calls inherit this process's environment, so
// every fixture call happens outside this scope and only product code runs
// inside it. The previous values are restored whatever the callback does.
async function withEnvironment(overrides, callback) {
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function scratch(prefix) {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

// why: a second repository with its own history and a configuration file that
// rewrites identity; every hostile variable points into it.
async function hostileEnvironment() {
  const other = await objectFormatRepository(OBJECT_FORMATS[0]);
  await writeFile(join(other.repositoryRoot, "src", "value.txt"), "hostile\n");
  git(other.repositoryRoot, "commit", "--quiet", "-am", "hostile history");
  const root = await scratch("verchestra-git-hostile-");
  const configuration = join(root, "hostile.gitconfig");
  await writeFile(configuration, "[user]\n\tname = Hostile Global\n\temail = hostile-global@verchestra.invalid\n");
  const execPath = join(root, "exec-path");
  await mkdir(execPath);
  const environment = {
    GIT_DIR: join(other.repositoryRoot, ".git"),
    GIT_WORK_TREE: other.repositoryRoot,
    GIT_INDEX_FILE: join(other.repositoryRoot, ".git", "index"),
    GIT_OBJECT_DIRECTORY: join(other.repositoryRoot, ".git", "objects"),
    GIT_COMMON_DIR: join(other.repositoryRoot, ".git"),
    GIT_CONFIG_GLOBAL: configuration,
    GIT_CONFIG_SYSTEM: configuration,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "user.name",
    GIT_CONFIG_VALUE_0: "Hostile Count",
    GIT_CONFIG_KEY_1: "core.hooksPath",
    GIT_CONFIG_VALUE_1: execPath,
    GIT_CONFIG_PARAMETERS: "'user.email=hostile-parameters@verchestra.invalid'",
    GIT_EXEC_PATH: execPath,
    GIT_EDITOR: join(execPath, "hostile-editor"),
    GIT_PAGER: join(execPath, "hostile-pager"),
    VERCHESTRA_TEST_UNRELATED_SECRET: "not for git"
  };
  const head = git(other.repositoryRoot, "rev-parse", "HEAD");
  return { other, environment, execPath, head };
}

function otherRepositoryUntouched(hostile) {
  assert.equal(git(hostile.other.repositoryRoot, "rev-parse", "HEAD"), hostile.head);
  assert.equal(registeredWorktreeCount(hostile.other.repositoryRoot), 1);
  assert.equal(taskBranches(hostile.other.repositoryRoot), "");
  assert.equal(git(hostile.other.repositoryRoot, "status", "--porcelain=v1"), "");
}

test("the git environment admits only the scrubbed process variables, the user's configuration home, and the commit identity", async () => {
  const hostile = await hostileEnvironment();
  const identity = {
    XDG_CONFIG_HOME: join(hostile.execPath, "xdg"),
    GIT_AUTHOR_NAME: "Environment Author",
    GIT_AUTHOR_EMAIL: "author@verchestra.invalid",
    GIT_COMMITTER_NAME: "Environment Committer",
    GIT_COMMITTER_EMAIL: "committer@verchestra.invalid"
  };
  const environment = await withEnvironment({ ...hostile.environment, ...identity }, async () => gitEnvironment());
  for (const key of Object.keys(environment)) assert.ok(ADMITTED.includes(key), `${key} reached git`);
  for (const key of Object.keys(hostile.environment)) assert.equal(environment[key], undefined, key);
  for (const [key, value] of Object.entries(identity)) assert.equal(environment[key], value, key);
  assert.equal(environment["PATH"], process.env["PATH"]);
  assert.equal(environment["HOME"], process.env["HOME"]);
});

test("a hostile GIT_DIR, work tree, and index do not redirect the runner", async () => {
  const hostile = await hostileEnvironment();
  const { repositoryRoot, baseCommit } = await objectFormatRepository(SHA256);
  const observed = await withEnvironment(hostile.environment, async () => ({
    head: (await runGit(repositoryRoot, ["rev-parse", "HEAD"])).stdout.trim(),
    top: (await runGit(repositoryRoot, ["rev-parse", "--show-toplevel"])).stdout.trim(),
    format: (await runGit(repositoryRoot, ["rev-parse", "--show-object-format"])).stdout.trim(),
    blob: await runGitBytes(repositoryRoot, ["cat-file", "blob", "HEAD:src/value.txt"], 1024)
  }));
  assert.equal(observed.head, baseCommit);
  assert.notEqual(observed.head, hostile.head);
  assert.equal(await realpath(observed.top), await realpath(repositoryRoot));
  assert.equal(observed.format, "sha256");
  assert.deepEqual(observed.blob, Buffer.from("base\n"));
});

test("hostile GIT_CONFIG_* variables inject no configuration", async () => {
  const hostile = await hostileEnvironment();
  const { repositoryRoot } = await objectFormatRepository(SHA256);
  const observed = await withEnvironment(hostile.environment, async () => ({
    name: (await runGit(repositoryRoot, ["config", "--get", "user.name"])).stdout.trim(),
    email: (await runGit(repositoryRoot, ["config", "--get", "user.email"])).stdout.trim(),
    hooks: await runGit(repositoryRoot, ["config", "--get", "core.hooksPath"]).then(
      (output) => output.stdout.trim(),
      () => "unset"
    )
  }));
  assert.equal(observed.name, "Verchestra Qualification");
  assert.equal(observed.email, "qualification@verchestra.invalid");
  assert.notEqual(observed.hooks, hostile.execPath);
});

test("a hostile GIT_EXEC_PATH and pager do not reach git", async () => {
  const hostile = await hostileEnvironment();
  const { repositoryRoot } = await objectFormatRepository(SHA256);
  const observed = await withEnvironment(hostile.environment, async () => ({
    execPath: (await runGit(repositoryRoot, ["--exec-path"])).stdout.trim(),
    pager: (await runGit(repositoryRoot, ["var", "GIT_PAGER"])).stdout.trim()
  }));
  assert.notEqual(observed.execPath, hostile.execPath);
  assert.doesNotMatch(observed.pager, /hostile/u);
});

const GATE = Object.freeze({
  gateId: "gate:value",
  commandRef: "node",
  args: [
    "-e",
    'process.exit(require("node:fs").readFileSync("src/value.txt", "utf8") === "base\\n" && process.env.GIT_DIR === undefined ? 0 : 1)'
  ],
  cwd: ".",
  timeoutMs: 60_000,
  outputLimitBytes: 1_000_000,
  resultProtocol: "exit-code"
});

for (const format of OBJECT_FORMATS) {
  const { objectFormat } = format;

  test(`worktree, gate, commit, and cleanup act on their own ${objectFormat} repository under a hostile environment`, async () => {
    const hostile = await hostileEnvironment();
    const repository = await objectFormatRepository(format);
    const { fixture, gate, commitId } = await withEnvironment(hostile.environment, async () => {
      const created = await createTaskWorktree(repository);
      const runner = new NodeGateProcessRunner({
        repositoryRoot: created.repositoryRoot,
        worktreesRoot: created.worktreesRoot,
        commands: { node: { executable: process.execPath, protocols: ["exit-code"] } }
      });
      const result = await runner.run({ ...GATE, worktreeRef: created.handle.worktreeRef });
      return { fixture: created, gate: result, ...(await commitFixtureTask(created)) };
    });
    assert.equal(gate.exitCode, 0);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 2);
    assert.equal(git(fixture.worktreePath, "rev-parse", "HEAD"), commitId);
    assert.equal(git(fixture.worktreePath, "rev-parse", "HEAD^"), repository.baseCommit);
    assert.equal(
      git(fixture.repositoryRoot, "show", "-s", "--format=%an <%ae> / %cn <%ce>", commitId),
      "Verchestra Qualification <qualification@verchestra.invalid> / Verchestra Qualification <qualification@verchestra.invalid>"
    );
    otherRepositoryUntouched(hostile);

    await withEnvironment(hostile.environment, () => fixture.worktrees.cleanupHandle(fixture.handle.worktreeRef));
    assert.equal(taskBranches(fixture.repositoryRoot), `refs/heads/vestra/run_c1/T1 ${commitId}`);
    assert.equal(registeredWorktreeCount(fixture.repositoryRoot), 1);
    await assert.rejects(access(fixture.worktreePath), { code: "ENOENT" });
    otherRepositoryUntouched(hostile);
  });
}

// why: the scrub must not cost git what it legitimately needs. A task commit
// takes its identity from the user's configuration under HOME or
// XDG_CONFIG_HOME, or from the identity variables, exactly as before.
const IDENTITY_SOURCES = Object.freeze({
  "the configuration under HOME": async (home) => {
    await writeFile(join(home, ".gitconfig"), "[user]\n\tname = Home Author\n\temail = home@verchestra.invalid\n");
    return { environment: {}, expected: "Home Author <home@verchestra.invalid>" };
  },
  "the configuration under XDG_CONFIG_HOME": async (home) => {
    const xdg = join(home, "xdg");
    await mkdir(join(xdg, "git"), { recursive: true });
    await writeFile(join(xdg, "git", "config"), "[user]\n\tname = Xdg Author\n\temail = xdg@verchestra.invalid\n");
    return { environment: { XDG_CONFIG_HOME: xdg }, expected: "Xdg Author <xdg@verchestra.invalid>" };
  },
  "the identity variables": async () => ({
    environment: {
      GIT_AUTHOR_NAME: "Environment Author",
      GIT_AUTHOR_EMAIL: "environment@verchestra.invalid",
      GIT_COMMITTER_NAME: "Environment Author",
      GIT_COMMITTER_EMAIL: "environment@verchestra.invalid"
    },
    expected: "Environment Author <environment@verchestra.invalid>"
  })
});

for (const [source, prepare] of Object.entries(IDENTITY_SOURCES)) {
  test(`a task commit still takes its identity from ${source}`, async () => {
    const fixture = await taskWorktreeFixture(SHA256);
    git(fixture.repositoryRoot, "config", "--unset", "user.name");
    git(fixture.repositoryRoot, "config", "--unset", "user.email");
    const home = await scratch("verchestra-git-home-");
    const { environment, expected } = await prepare(home);
    const cleared = {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: undefined,
      GIT_AUTHOR_NAME: undefined,
      GIT_AUTHOR_EMAIL: undefined,
      GIT_COMMITTER_NAME: undefined,
      GIT_COMMITTER_EMAIL: undefined,
      GIT_CONFIG_GLOBAL: undefined,
      GIT_CONFIG_NOSYSTEM: undefined
    };
    const { commitId } = await withEnvironment({ ...cleared, ...environment }, () => commitFixtureTask(fixture));
    assert.equal(git(fixture.repositoryRoot, "show", "-s", "--format=%an <%ae>", commitId), expected);
    assert.equal(git(fixture.repositoryRoot, "show", "-s", "--format=%cn <%ce>", commitId), expected);
  });
}
