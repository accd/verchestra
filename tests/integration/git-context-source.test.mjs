import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { StableId } from "../../packages/domain/src/index.ts";
import { NodeGitContextSource } from "../../packages/platform-node/src/index.ts";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-git-context-"));
  roots.push(root);
  await mkdir(join(root, "src", "nested"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "src", "a.txt"), "alpha\n");
  await writeFile(join(root, "src", "nested", "b.txt"), "beta\n");
  await writeFile(join(root, "src", "binary.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(root, "docs", "readme.md"), "outside the scope\n");
  await symlink("a.txt", join(root, "src", "link.txt"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "qualification@verchestra.invalid");
  git(root, "config", "user.name", "Verchestra Qualification");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "base");
  const revision = git(root, "rev-parse", "HEAD");
  // Working-tree edits after the commit must never reach committed context.
  await writeFile(join(root, "src", "a.txt"), "uncommitted edit\n");
  await writeFile(join(root, "src", "untracked.txt"), "untracked\n");
  return { root, revision };
}

const query = (revision, selector = { scope: "src" }, overrides = {}) => ({
  workspaceId: "workspace_context",
  selectorId: "selector-repository",
  sourceKind: "repository",
  sourceId: "repository:main",
  query: selector,
  expectedRevision: revision,
  ...overrides
});

const source = (root, options = {}) =>
  new NodeGitContextSource({
    repositoryRoot: root,
    sourceId: "repository:main",
    now: () => "2026-09-29T00:00:00.000Z",
    ...options
  });

test("committed text files in scope are read at the exact revision as untrusted fragments", async () => {
  const { root, revision } = await repository();
  const observation = await source(root).resolve(query(revision));
  assert.deepEqual(observation.source, { kind: "repository", identity: "repository:main", revision });
  assert.equal(observation.scope, "src");
  assert.deepEqual(
    observation.fragments.map((fragment) => fragment.content),
    ["path: src/a.txt\n\nalpha\n", "path: src/nested/b.txt\n\nbeta\n"]
  );
  for (const fragment of observation.fragments) {
    assert.equal(fragment.trust, "untrusted-data");
    assert.equal(StableId.parse(fragment.fragmentId, "fragment").kind, "fragment");
  }
  const again = await source(root).resolve(query(revision));
  assert.deepEqual(
    again.fragments.map((fragment) => fragment.fragmentId),
    observation.fragments.map((fragment) => fragment.fragmentId)
  );
});

test("symbolic links, binary blobs, and paths outside the scope are not context", async () => {
  const { root, revision } = await repository();
  const files = await source(root).listTree(revision, "src");
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/a.txt", "src/binary.bin", "src/nested/b.txt"]
  );
  const observation = await source(root).resolve(query(revision, { scope: "." }));
  assert.equal(
    observation.fragments.some((fragment) => fragment.content.startsWith("path: src/binary.bin")),
    false
  );
  assert.equal(
    observation.fragments.some((fragment) => fragment.content.startsWith("path: src/link.txt")),
    false
  );
});

test("an explicit path list selects files and fails closed on a missing path", async () => {
  const { root, revision } = await repository();
  const observation = await source(root).resolve(query(revision, { scope: "src", paths: ["src/nested/b.txt"] }));
  assert.equal(observation.fragments.length, 1);
  await assert.rejects(source(root).resolve(query(revision, { scope: "src", paths: ["src/absent.txt"] })), {
    code: "VES_GIT_CONTEXT_PATH_MISSING"
  });
  await assert.rejects(source(root).resolve(query(revision, { scope: "src", paths: ["docs/readme.md"] })), {
    code: "VES_GIT_CONTEXT_INPUT_INVALID"
  });
});

test("every declared bound fails closed instead of truncating context", async () => {
  const { root, revision } = await repository();
  await assert.rejects(source(root, { maximumFileBytes: 4 }).resolve(query(revision)), {
    code: "VES_GIT_CONTEXT_LIMIT"
  });
  await assert.rejects(source(root, { maximumFiles: 2 }).resolve(query(revision)), { code: "VES_GIT_CONTEXT_LIMIT" });
  await assert.rejects(source(root, { maximumEntries: 2 }).resolve(query(revision)), { code: "VES_GIT_CONTEXT_LIMIT" });
  await assert.rejects(source(root, { maximumTotalBytes: 8 }).resolve(query(revision)), {
    code: "VES_GIT_CONTEXT_LIMIT"
  });
});

test("revisions, scopes, and selectors that are not exact are refused", async () => {
  const { root, revision } = await repository();
  await assert.rejects(source(root).resolve(query(revision.slice(0, 12))), { code: "VES_GIT_CONTEXT_INPUT_INVALID" });
  await assert.rejects(source(root).resolve(query(undefined)), { code: "VES_GIT_CONTEXT_INPUT_INVALID" });
  await assert.rejects(source(root).resolve(query(revision, { scope: "../outside" })), {
    code: "VES_GIT_CONTEXT_INPUT_INVALID"
  });
  await assert.rejects(source(root).resolve(query(revision, { scope: "src", glob: "*" })), {
    code: "VES_GIT_CONTEXT_INPUT_INVALID"
  });
  await assert.rejects(source(root).resolve(query("f".repeat(40))), { code: "VES_GIT_CONTEXT_COMMAND_FAILED" });
  await assert.rejects(source(root).resolve(query(revision, { scope: "src" }, { sourceKind: "tracker" })), {
    code: "VES_GIT_CONTEXT_INPUT_INVALID"
  });
  assert.equal(
    await source(root).resolve(query(revision, { scope: "src" }, { sourceId: "repository:other" })),
    undefined
  );
});
