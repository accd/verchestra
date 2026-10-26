// invariant: every adapter that starts git finds it only on an absolute PATH
// entry. Each adapter package keeps its own resolver, since none may import a
// sibling adapter; this table holds them to one behaviour.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { after, test } from "node:test";

import { resolveGitExecutable as platformNode } from "../../packages/platform-node/src/git-executable.ts";
import { resolveGitExecutable as selfTest } from "../../packages/self-test/src/git-executable.ts";
import { resolveGitExecutable as workspace } from "../../packages/workspace/src/git-executable.ts";
import { gitExecutable as scripts } from "../../scripts/git-executable.mjs";

const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

const RESOLVERS = Object.freeze({ platformNode, selfTest, workspace, scripts });

test("the git resolver takes only absolute PATH entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-git-resolver-"));
  roots.push(root);
  const file = process.platform === "win32" ? "git.exe" : "git";
  const planted = join(root, "planted");
  const empty = join(root, "empty");
  const real = join(root, "real");
  for (const directory of [planted, empty, real]) await mkdir(directory);
  await writeFile(join(planted, file), "planted\n", { mode: 0o755 });
  await writeFile(join(real, file), "real\n", { mode: 0o755 });
  const plantedRelative = relative(process.cwd(), planted);
  assert.notEqual(plantedRelative, planted, "the planted entry must be relative");
  for (const [name, resolve] of Object.entries(RESOLVERS)) {
    assert.equal(resolve({ PATH: [plantedRelative, ".", "", empty, real].join(delimiter) }), join(real, file), name);
    assert.throws(() => resolve({ PATH: [plantedRelative, "."].join(delimiter) }), { code: "ENOENT" }, name);
    assert.throws(() => resolve({}), { code: "ENOENT" }, name);
  }
});
