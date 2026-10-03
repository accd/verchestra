// invariant: the worktree handle encoding, the task branch name, and the task
// commit trailers are each defined in one module (ADP-1):
// packages/platform-node/src/task-worktree.ts. Any other production source
// that spells one of them out has taken a second copy of that knowledge.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER = "packages/platform-node/src/task-worktree.ts";
const SCANNED_ROOTS = ["packages", "apps"];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

// why: a comment may name the branch or a trailer to explain a decision; only
// code that would have to change with the encoding counts as a second copy.
function code(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

const files = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(repoRoot, root)))
  .map((path) => relative(repoRoot, path).replaceAll("\\", "/"))
  .filter((path) => /^(?:packages|apps)\/[^/]+\/src\//u.test(path) && path !== OWNER)
  .map((path) => ({ path, source: code(readFileSync(join(repoRoot, path), "utf8")) }));

const KNOWLEDGE = Object.freeze({
  "the worktree handle encoding":
    /worktree:\$\{|\^worktree:|worktree:\(|worktreeRef\s*\.\s*(?:slice|split|substring|match)\(/u,
  "the task branch name": /refs\/heads\/vestra|["'`]vestra\/|\bvestra\/\$\{/u,
  "a task commit trailer": /Verchestra-(?:Task|Run|Requirements|Gate-Plan|Gate-Evidence|Change|Idempotency-Key)\b/u
});

test("the scan reads production sources and the owning module holds all three definitions", () => {
  assert.ok(files.length > 100, `only ${files.length} production sources were scanned`);
  const owner = code(readFileSync(join(repoRoot, OWNER), "utf8"));
  for (const [knowledge, pattern] of Object.entries(KNOWLEDGE))
    assert.match(owner, pattern, `${OWNER} no longer defines ${knowledge}`);
});

for (const [knowledge, pattern] of Object.entries(KNOWLEDGE)) {
  test(`${knowledge} is defined only in the task worktree module`, () => {
    const copies = files.filter(({ source }) => pattern.test(source)).map(({ path }) => path);
    assert.deepEqual(copies, [], `${knowledge} is also spelled out in: ${copies.join(", ")}`);
  });
}

// invariant: the task path starts git in one place, so one environment policy
// and one output bound cover every git process it runs.
test("only the task worktree module spawns git on the task path", () => {
  const spawn = /\b(?:execFile|execFileSync|execFileAsync|spawn|spawnSync)\(\s*["'`]git["'`]/u;
  const taskPath = files.filter(({ path }) =>
    /^(?:packages\/platform-node\/src|apps\/vestra-cli\/src\/task)\//u.test(path)
  );
  assert.ok(taskPath.length > 40, `only ${taskPath.length} task path sources were scanned`);
  const spawners = taskPath.filter(({ source }) => spawn.test(source)).map(({ path }) => path);
  assert.deepEqual(spawners, [], `git is also spawned in: ${spawners.join(", ")}`);
  assert.match(code(readFileSync(join(repoRoot, OWNER), "utf8")), spawn);
});

// invariant: a worktree, including verification's scratch checkout, is added
// and removed only by the worktree adapter (ADR2-4), so every removal reports
// what it left behind instead of a caller swallowing it.
test("only the worktree adapter adds, removes, or prunes a worktree", () => {
  const adapter = "packages/platform-node/src/git-worktree-adapter.ts";
  const lifecycle = /["'`]worktree["'`]\s*,\s*["'`](?:add|remove|prune)["'`]/u;
  const copies = files.filter(({ path, source }) => path !== adapter && lifecycle.test(source)).map(({ path }) => path);
  assert.deepEqual(copies, [], `a worktree is also added or removed in: ${copies.join(", ")}`);
  assert.match(code(readFileSync(join(repoRoot, adapter), "utf8")), lifecycle);
});
