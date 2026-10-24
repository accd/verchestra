// invariant: on a Windows host without symbolic-link rights the bridge
// fixture still builds its directory link, as a junction, and a file link it
// cannot build fails with one message that names the fix, not a bare EPERM.
import assert from "node:assert/strict";
import { test } from "node:test";

import { linkDirectory, linkFile } from "../helpers/mcp-bridge-fixture.mjs";

const EPERM = () => Object.assign(new Error("operation not permitted"), { code: "EPERM" });

test("a directory link falls back to a junction on EPERM", async () => {
  const calls = [];
  await linkDirectory("C:\\outside", "C:\\worktree\\src\\linkdir", async (target, path, type) => {
    calls.push([target, path, type]);
    if (type === "dir") throw EPERM();
  });
  assert.deepEqual(calls, [
    ["C:\\outside", "C:\\worktree\\src\\linkdir", "dir"],
    ["C:\\outside", "C:\\worktree\\src\\linkdir", "junction"]
  ]);
  const other = Object.assign(new Error("exists"), { code: "EEXIST" });
  await assert.rejects(
    linkDirectory("a", "b", async () => {
      throw other;
    }),
    (error) => error === other
  );
});

test("a file link EPERM names Windows Developer Mode", async () => {
  await assert.rejects(
    linkFile("C:\\outside\\victim.txt", "C:\\worktree\\src\\linkfile.txt", async () => {
      throw EPERM();
    }),
    (error) => {
      assert.match(error.message, /Windows Developer Mode/u);
      assert.equal(error.cause.code, "EPERM");
      return true;
    }
  );
  let linked = 0;
  await linkFile("target", "path", async () => {
    linked += 1;
  });
  assert.equal(linked, 1);
});
