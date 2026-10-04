// invariant: the worktree adapter refuses a worktree or scratch checkout whose
// directory passes Git's GIT_DIR limit on this host before it asks Git for
// anything that would leave a half-added worktree, and adds one at the limit.
// A recording Git runner stands in for Git; the roots are real directories,
// built to the host's limit, so every case runs on every platform.
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { test } from "node:test";

import { NodeGitWorktreeAdapter } from "../../packages/platform-node/src/index.ts";
import { directoryOfLength } from "../helpers/deep-directory.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const PATH_MAX = Object.freeze({ win32: 260, darwin: 1024, linux: 4096 });
const LIMIT = (PATH_MAX[process.platform] ?? PATH_MAX.linux) - 40 - "/.git".length;
const REVISION = "a".repeat(40);

// invariant: a DETERMINISTIC FAKE Git that answers what the adapter asks
// before an add, records every command, and makes the directory an add names.
function recordingGit() {
  const commands = [];
  const runGit = async (cwd, args) => {
    commands.push(args.join(" "));
    if (args[0] === "rev-parse" && args[1] === "--is-bare-repository") return { stdout: "false\n", stderr: "" };
    if (args[0] === "rev-parse" && args[1] === "--verify") return { stdout: `${REVISION}\n`, stderr: "" };
    if (args[0] === "worktree" && args[1] === "list") return { stdout: "", stderr: "" };
    if (args[0] === "worktree" && args[1] === "add") {
      await mkdir(args[4], { recursive: true });
      return { stdout: "", stderr: "" };
    }
    throw Object.assign(new Error(`unexpected git ${args.join(" ")}`), { code: 1 });
  };
  return { commands, runGit };
}

async function adapterWithRootOfLength(t, rootLength) {
  const base = await realpath(await temporaryDirectory(t, "verchestra-worktree-budget-"));
  const repositoryRoot = join(base, "repository");
  await mkdir(repositoryRoot);
  const worktreesRoot = await directoryOfLength(join(base, "w"), rootLength);
  const git = recordingGit();
  const adapter = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot, runGit: git.runGit });
  return { adapter, git, worktreesRoot };
}

const request = Object.freeze({
  workspaceId: "workspace_budget",
  runId: "run_budget",
  taskId: "T1",
  sourceStateDigest: `sha256:${"2".repeat(64)}`,
  sourceRevision: REVISION,
  changeScope: ["src"],
  protectedPaths: [".git"]
});

// why: a worktree directory is its root, a separator, and a 32-digit handle ID.
const ROOT_AT_LIMIT = LIMIT - sep.length - 32;

test(`a worktree one byte past the host's limit (${LIMIT}) is refused before Git adds anything`, async (t) => {
  const { adapter, git } = await adapterWithRootOfLength(t, ROOT_AT_LIMIT + 1);
  await assert.rejects(adapter.create(request), { code: "VES_GIT_WORKTREE_PATH_TOO_LONG" });
  assert.equal(
    git.commands.some((command) => command.startsWith("worktree add")),
    false
  );
  await assert.rejects(
    adapter.withScratchCheckout({ name: "review", commitId: REVISION }, () => assert.fail("never used")),
    { code: "VES_GIT_WORKTREE_PATH_TOO_LONG" }
  );
  assert.deepEqual(
    git.commands.filter((command) => command.startsWith("worktree add") || command.startsWith("worktree remove")),
    [],
    "neither a checkout nor its removal reached Git"
  );
});

test(`a worktree exactly at the host's limit (${LIMIT}) is added`, async (t) => {
  const { adapter, git, worktreesRoot } = await adapterWithRootOfLength(t, ROOT_AT_LIMIT);
  const { worktreeRef } = await adapter.create(request);
  const added = git.commands.filter((command) => command.startsWith("worktree add"));
  assert.equal(added.length, 1);
  const id = /^worktree:([a-f0-9]{32}):/u.exec(worktreeRef)?.[1];
  assert.ok(added[0].includes(join(worktreesRoot, id)));
  assert.equal(join(worktreesRoot, id).length, LIMIT);
});
