// invariant: Git refuses an explicit GIT_DIR longer than PATH_MAX - 40 bytes
// (setup.c, "'$GIT_DIR' too big"), and `git worktree add` starts its checkout
// with GIT_DIR=<directory>/.git. The worktree module knows that limit per
// platform, counts UTF-8 bytes as Git does, and sets core.longpaths on its own
// Git commands on Windows only. Pure rules, so every case runs everywhere.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  gitArguments,
  worktreeDirectoryFits,
  worktreeRootFits
} from "../../packages/platform-node/src/task-worktree.ts";

// why: the rule measures a directory's bytes only, so a case is a string of
// exactly `length` characters.
const directory = (length) => "x".repeat(length);

for (const [platform, pathMax] of [
  ["win32", 260],
  ["darwin", 1024],
  ["linux", 4096]
]) {
  const limit = pathMax - 40 - "/.git".length;
  test(`on ${platform} a worktree directory of ${limit} bytes fits and one of ${limit + 1} does not`, () => {
    assert.equal(directory(limit).length, limit);
    assert.equal(worktreeDirectoryFits(directory(limit - 1), platform), true, "just below");
    assert.equal(worktreeDirectoryFits(directory(limit), platform), true, "at the limit");
    assert.equal(worktreeDirectoryFits(directory(limit + 1), platform), false, "just above");
  });
}

test("the limit counts UTF-8 bytes, as Git does, not characters", () => {
  const at = directory(215);
  const twoByte = `${at.slice(0, -1)}é`;
  assert.equal(twoByte.length, 215);
  assert.equal(Buffer.byteLength(twoByte, "utf8"), 216);
  assert.equal(worktreeDirectoryFits(at, "win32"), true);
  assert.equal(worktreeDirectoryFits(twoByte, "win32"), false);
});

test("a worktree root fits when the root and one 32-digit handle ID fit", () => {
  // why: 182 + a separator + 32 is 215, the Windows limit.
  assert.equal(worktreeRootFits(directory(182), "win32"), true);
  assert.equal(worktreeRootFits(directory(183), "win32"), false);
  assert.equal(worktreeRootFits(directory(183), "darwin"), true);
});

test("Git runs with core.longpaths on Windows and with its arguments unchanged elsewhere", () => {
  const args = ["worktree", "add", "--detach", "--", "C:\\w", "a".repeat(40)];
  assert.deepEqual(gitArguments(args, "win32"), ["-c", "core.longpaths=true", ...args]);
  for (const platform of ["darwin", "linux"]) assert.deepEqual(gitArguments(args, platform), args, platform);
});
