// invariant: every worktree directory a run asks Git to add fits Git's GIT_DIR
// limit, 215 bytes of directory on Windows, from the hosted Windows runner's
// deep temporary root, and a state root too deep for one is `not configured`
// before the run's first transition. The scratch checkouts of verification
// sit 22 characters below the run's own worktree: one 16-digit run segment and
// one letter per purpose. Real directories, measured on the real path.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { test } from "node:test";

import { requireWorktreePathBudget, scratchSegments } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import { directoryOfLength } from "../helpers/deep-directory.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const RUN_ID = `run_${randomUUID()}`;
// why: the Workspace root of the Windows journey on the hosted runner, the
// deepest one measured: C:\Users\runneradmin\AppData\Local\Temp\vts-XXXXXX\
// vte-XXXXXX\l\Verchestra\state\workspaces\workspace_<36>.
const RUNNER_WORKSPACE_ROOT = 138;
// why: 215 - (a separator, "verification", the run segment, the purpose, and a
// 32-digit checkout ID, each behind a separator).
const DEEPEST_FITTING_ROOT = 215 - ("verification".length + 16 + 1 + 32 + 4 * sep.length);

test("the scratch segments are a 16-digit digest of the run and one letter per purpose", () => {
  const [run, review] = scratchSegments(RUN_ID, "review");
  assert.match(run, /^[a-f0-9]{16}$/u);
  assert.equal(review, "r");
  assert.deepEqual(scratchSegments(RUN_ID, "mutations"), [run, "m"]);
  assert.deepEqual(scratchSegments(RUN_ID, "review"), [run, "r"], "derived, so a killed checkout is found again");
  assert.notEqual(scratchSegments(`run_${randomUUID()}`, "review")[0], run);
});

async function workspaceRootOfLength(t, length) {
  const base = await realpath(await temporaryDirectory(t, "vsl-"));
  const workspaceRoot = await directoryOfLength(base, length);
  return {
    layout: { workspaceRoot, worktreesRoot: join(workspaceRoot, "worktrees") },
    verificationRoot: join(workspaceRoot, "verification")
  };
}

function stateTooDeep(error) {
  assert.equal(error.code, "VES_TASK_NOT_CONFIGURED");
  assert.deepEqual(error.envelope.safeDetails, { requirement: "state-path-length" });
  return true;
}

test("from the hosted Windows runner's Workspace root, every worktree of a run fits Git on Windows", async (t) => {
  const workspace = await workspaceRootOfLength(t, RUNNER_WORKSPACE_ROOT);
  await requireWorktreePathBudget(workspace, RUN_ID, "win32");
  assert.deepEqual(await readdir(workspace.layout.workspaceRoot), [], "the check creates nothing");
});

test(`a Workspace root of ${DEEPEST_FITTING_ROOT} characters fits Git on Windows and one more does not`, async (t) => {
  assert.equal(DEEPEST_FITTING_ROOT, 150);
  await requireWorktreePathBudget(await workspaceRootOfLength(t, DEEPEST_FITTING_ROOT), RUN_ID, "win32");
  const deeper = await workspaceRootOfLength(t, DEEPEST_FITTING_ROOT + 1);
  await assert.rejects(requireWorktreePathBudget(deeper, RUN_ID, "win32"), stateTooDeep);
  assert.deepEqual(await readdir(deeper.layout.workspaceRoot), [], "nothing is created before the refusal");
  for (const platform of ["darwin", "linux"]) await requireWorktreePathBudget(deeper, RUN_ID, platform);
});
