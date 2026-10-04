// invariant: SSI-49 and SSI-81 at the composition. What a coordinated run
// withholds from every node result is the credentials its sessions are given
// to redact and its machine-local roots: the home directory, the Workspace
// layout's state root, the run's worktree, and the temporary root. A relative
// path or a filesystem root names no machine-local place.
import assert from "node:assert/strict";
import { homedir, tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { test } from "node:test";

import { nodeResultWithheld } from "../../apps/vestra-cli/src/task/task-coordination.ts";
import { resolveWorkspaceState } from "../../packages/platform-node/src/index.ts";

const WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-512345678901";
const byText = (left, right) => Number(left > right) - Number(left < right);

function options(codex, env) {
  const layout = resolveWorkspaceState({
    stateRoot: resolve("/fixture-state/verchestra"),
    workspaceId: WORKSPACE_ID,
    platform: process.platform
  });
  return {
    layout,
    options: {
      claude: { executable: "/fixture/claude", auth: "subscription", credential: "sk-ant-oat01-fixture-claude" },
      codex: { executable: "/fixture/codex", ...codex },
      env,
      sessionsRoot: layout.sessionsRoot,
      worktrees: {
        resolvePath: (worktreeRef) => Promise.resolve(join(layout.worktreesRoot, worktreeRef.slice("worktree:".length)))
      }
    }
  };
}

test("a run withholds its sessions' credentials and its home, state, worktree, and temporary roots", async () => {
  const home = resolve("/fixture-home/owner");
  const { layout, options: composed } = options(
    { credential: "sk-proj-fixture-codex" },
    { HOME: `${home}/`, TMPDIR: "relative/tmp", TEMP: parse(home).root, PATH: "/usr/bin" }
  );
  const withheld = await nodeResultWithheld(composed, "worktree:run-1");
  assert.deepEqual(withheld.values, ["sk-ant-oat01-fixture-claude", "sk-proj-fixture-codex"]);
  const expected = [homedir(), home, layout.stateRoot, join(layout.worktreesRoot, "run-1"), tmpdir()].map((root) =>
    resolve(root)
  );
  assert.deepEqual([...withheld.roots].sort(byText), [...new Set(expected)].sort(byText));
  assert.equal(withheld.roots.includes(parse(home).root), false, "a filesystem root is never withheld");
});

test("a Codex session on the Workspace login has no value to withhold beside the Claude Code credential", async () => {
  const { options: composed } = options({ identityDirectory: "/fixture/codex-identity" }, {});
  assert.deepEqual((await nodeResultWithheld(composed, "worktree:run-1")).values, ["sk-ant-oat01-fixture-claude"]);
});
