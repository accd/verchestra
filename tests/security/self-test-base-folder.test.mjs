// invariant: self-test makes its disposable roots only inside a base folder
// this user owns and that is not a link (#595, SEC-008). The base sits in the
// temporary directory, which the users of a POSIX machine share: another user
// could create it first, or replace it with a link to a folder of theirs, and
// every root would then be made inside it.
import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { DisposableRootProvider } from "../../packages/self-test/src/index.ts";
import { linkDirectory } from "../helpers/windows-links.mjs";

const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 }))));

async function scratch() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "verchestra-self-test-base-")));
  roots.push(root);
  return root;
}

const UNSAFE = { code: "VES_SELFTEST_ROOT_BASE_UNSAFE" };

test("a base folder that is a link is refused, and nothing is made through it", async () => {
  const root = await scratch();
  const elsewhere = join(root, "someone-elses");
  await mkdir(elsewhere);
  const base = join(root, "base");
  await linkDirectory(elsewhere, base);
  await assert.rejects(new DisposableRootProvider({ baseDirectory: base }).provision("smoke"), UNSAFE);
  assert.deepEqual(await readdir(elsewhere), []);
});

test("a base folder that is not a directory is refused", async () => {
  const root = await scratch();
  const base = join(root, "base");
  await writeFile(base, "not a folder\n");
  await assert.rejects(new DisposableRootProvider({ baseDirectory: base }).provision("smoke"), UNSAFE);
});

test("a base folder another user owns is refused", async () => {
  const root = await scratch();
  const base = join(root, "base");
  await mkdir(base);
  const { uid } = await lstat(base);
  const provider = new DisposableRootProvider({ baseDirectory: base, ownerId: uid + 1 });
  await assert.rejects(provider.provision("smoke"), UNSAFE);
  assert.deepEqual(await readdir(base), []);
});

test("a base folder this user owns is used, and on POSIX it admits no one else", async () => {
  const root = await scratch();
  const base = join(root, "base");
  await mkdir(base, { mode: 0o755 });
  const { uid } = await lstat(base);
  const provided = await new DisposableRootProvider({ baseDirectory: base, ownerId: uid }).provision("smoke");
  assert.ok((await lstat(provided.canonicalPath)).isDirectory());
  // why: Windows has no POSIX permission bits to observe; the ownership and
  // link checks above are what hold there.
  if (process.platform !== "win32") assert.equal((await lstat(base)).mode & 0o777, 0o700);
});
