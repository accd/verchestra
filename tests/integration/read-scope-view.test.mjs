// invariant: SSI-42 and TM-004 for a reader the bridge cannot hold. The
// bridge's read view, materialized, holds exactly the text files a bridge read
// reaches (the read scope minus protected paths and Git metadata, links never
// followed), each read-only; it is bounded as the bridge's search is and
// refuses a scope beyond a bound whole; and it is removed whole.
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { test } from "node:test";

import { removeMaterializedView, WorktreeReadView } from "../../packages/agent-runtime/src/index.ts";
import { removeTemporaryDirectory, temporaryDirectory } from "../helpers/temporary-directory.mjs";

const byText = (left, right) => Number(left > right) - Number(left < right);
const WIN32 = process.platform === "win32";

async function worktree(t, files) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vestra-read-view-")));
  const tree = join(root, "worktree");
  const target = join(root, "view");
  // invariant: a read-only view is made removable before its root is removed,
  // whether the case passed or failed.
  t.after(async () => {
    await removeMaterializedView(target);
    await removeTemporaryDirectory(root);
  });
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(tree, ...path.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(tree, ...path.split("/")), content);
  }
  await mkdir(target);
  return { root, tree, target };
}

async function materialized(fixture, readScope, protectedPaths = [".git"]) {
  const view = await WorktreeReadView.open({ root: fixture.tree, readScope, protectedPaths });
  return view.materialize(fixture.target);
}

async function entries(target) {
  const names = (await readdir(target, { recursive: true })).map((name) => name.split(sep).join("/"));
  return names.sort(byText);
}

test("a materialized view holds the read scope's text files, without protected paths, Git metadata, binaries, or links", async (t) => {
  const fixture = await worktree(t, {
    "src/a.txt": "alpha\n",
    "src/nested/b.txt": "beta\n",
    "src/protected/key.txt": "protected\n",
    "src/image.bin": "\u0000binary",
    "src/.git/config": "[core]\n",
    "docs/secret.txt": "outside the read scope\n",
    "outside/victim.txt": "outside the worktree\n"
  });
  await symlink(join(fixture.tree, "outside"), join(fixture.tree, "src", "linkdir"), "junction");
  await materialized(fixture, ["src"], [".git", "src/protected"]);
  assert.deepEqual(await entries(fixture.target), ["src", "src/a.txt", "src/nested", "src/nested/b.txt"]);
  assert.equal(await readFile(join(fixture.target, "src", "nested", "b.txt"), "utf8"), "beta\n");
  for (const file of ["src/a.txt", "src/nested/b.txt"])
    assert.equal((await lstat(join(fixture.target, ...file.split("/")))).mode & 0o222, 0, `${file} is writable`);
  // why: Windows keeps no write permission bits on a directory; there its
  // files are read-only and Codex's sandbox holds the rest.
  if (!WIN32)
    for (const directory of [".", "src", "src/nested"])
      assert.equal((await lstat(join(fixture.target, directory))).mode & 0o222, 0, `${directory} is writable`);
  await removeMaterializedView(fixture.target);
  assert.deepEqual(await readdir(fixture.root).then((names) => names.sort(byText)), ["worktree"]);
});

test("a read scope beyond a bound of the bridge's search is refused whole, never copied in part", async (t) => {
  const large = await worktree(t, { "src/a.txt": "alpha\n", "src/large.txt": "x".repeat(1_048_577) });
  await assert.rejects(materialized(large, ["src"]), { code: "VES_BRIDGE_VIEW_LIMIT" });
  const exact = await worktree(t, { "src/large.txt": "x".repeat(1_048_576) });
  await materialized(exact, ["src"]);
  assert.deepEqual(await entries(exact.target), ["src", "src/large.txt"]);
  const listing = await worktree(
    t,
    Object.fromEntries(Array.from({ length: 1_001 }, (_, index) => [`src/f${index}.txt`, "x"]))
  );
  await assert.rejects(materialized(listing, ["src"]), { code: "VES_BRIDGE_VIEW_LIMIT" });
  // why: 5,001 files across directories no listing of which is truncated.
  const many = await worktree(
    t,
    Object.fromEntries(Array.from({ length: 5_001 }, (_, index) => [`src/d${index % 6}/f${index}.txt`, "x"]))
  );
  await assert.rejects(materialized(many, ["src"]), { code: "VES_BRIDGE_VIEW_LIMIT" });
  for (const fixture of [large, exact, listing, many]) {
    await removeMaterializedView(fixture.target);
    assert.equal((await readdir(fixture.root)).includes("view"), false);
  }
});

test("removing a view that was never written leaves nothing to do", async (t) => {
  const root = await temporaryDirectory(t, "vestra-read-view-");
  await removeMaterializedView(join(root, "absent"));
  assert.deepEqual(await readdir(root), []);
});
