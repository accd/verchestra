// invariant: the grammar of a task path, its containment test, the
// protected-path test, and the case rule are defined in one module:
// packages/domain/src/primitives/task-path.ts. Eight copies of that rule once
// drifted apart in three variants; only some folded case, and a pattern was
// replaced after a backtracking finding in one copy and not in the others.
// Any other product source that spells the rule out has taken a second copy.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER = "packages/domain/src/primitives/task-path.ts";

// why: a comment may quote the rule to explain a decision; only code counts.
const code = (source) =>
  source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const productSources = ["packages", "apps"]
  .flatMap((root) => sources(join(repositoryRoot, root)))
  .map((path) => relative(repositoryRoot, path).replaceAll("\\", "/"))
  .filter((path) => /^(?:packages|apps)\/[^/]+\/src\//u.test(path))
  .map((path) => ({ path, source: code(readFileSync(join(repositoryRoot, path), "utf8")) }));

// invariant: the task path is request intake, the executor and its gate, the
// scheduler, verification, the MCP bridge, the worktree tool and the Git
// adapters, and the CLI's task commands.
const TASK_PATH_ROOTS =
  /^(?:packages\/application\/src\/(?:execution|verification)\/|packages\/agent-runtime\/src\/execution\/|packages\/platform-node\/src\/|apps\/vestra-cli\/src\/task\/)/u;
const taskPathSources = productSources.filter(({ path }) => TASK_PATH_ROOTS.test(path));

// why: the grammar's character set, as a regex class or as a set, the
// containment test, and the Git metadata test are each what a copy of the rule
// has to spell out.
const GRAMMAR = /A-Za-z0-9\._@\+\/-|0123456789\._@\+\/-/u;
const CONTAINMENT = /startsWith\(`\$\{[^}]+\}\/`\)/u;
const GIT_METADATA = /===\s*["']\.git["']|includes\(\s*["']\.git["']\s*\)/u;

// why: TUF target names in a release are a different grammar with their own
// tests; they are not a path the implementer writes in a worktree.
const OTHER_GRAMMARS = new Set(["packages/distribution/src/tuf-publication.ts"]);

test("the scan reads product sources and the task-path module holds the whole rule", () => {
  assert.ok(productSources.length > 100, `only ${productSources.length} product sources were scanned`);
  assert.ok(taskPathSources.length > 60, `only ${taskPathSources.length} task path sources were scanned`);
  const owner = code(readFileSync(join(repositoryRoot, OWNER), "utf8"));
  assert.match(owner, GRAMMAR);
  for (const name of [
    "isTaskPath",
    "taskPathSegments",
    "isWithinTaskPath",
    "isWithinTaskScope",
    "isProtectedTaskPath",
    "namesGitMetadata",
    "taskPathsOverlap"
  ])
    assert.match(owner, new RegExp(`export function ${name}\\(`, "u"), `${OWNER} no longer defines ${name}`);
  assert.match(owner, /toLowerCase\(\)/u, `${OWNER} no longer holds the case rule`);
});

test("no other product source spells out the task-path grammar", () => {
  const copies = productSources
    .filter(({ path, source }) => path !== OWNER && !OTHER_GRAMMARS.has(path) && GRAMMAR.test(source))
    .map(({ path }) => path);
  assert.deepEqual(copies, [], `the task-path grammar is also spelled out in: ${copies.join(", ")}`);
});

test("no stage of the task path writes its own containment or Git metadata test", () => {
  const copies = taskPathSources
    .filter(({ source }) => CONTAINMENT.test(source) || GIT_METADATA.test(source))
    .map(({ path }) => path);
  assert.deepEqual(copies, [], `a task-path comparison is also written in: ${copies.join(", ")}`);
});

// invariant: each stage still validates its own untrusted input, by asking the
// module; a stage that stopped importing it has stopped asking.
const STAGES = Object.freeze({
  "packages/application/src/execution/task-executor.ts": ["isTaskPath", "isProtectedTaskPath", "isWithinTaskScope"],
  "packages/application/src/execution/gate-commit.ts": ["isTaskPath", "isProtectedTaskPath", "isWithinTaskScope"],
  "packages/application/src/execution/task-scheduler.ts": ["taskPathsOverlap"],
  "packages/application/src/verification/verification.ts": ["isTaskPath"],
  "packages/agent-runtime/src/execution/mcp-bridge-tools.ts": [
    "isTaskPath",
    "namesGitMetadata",
    "isProtectedTaskPath",
    "isWithinTaskScope"
  ],
  "packages/platform-node/src/worktree-tool-adapter.ts": ["isTaskPath", "namesGitMetadata", "isProtectedTaskPath"],
  "packages/platform-node/src/git-worktree-adapter.ts": ["isTaskPath"],
  "packages/platform-node/src/git-context-source.ts": ["isTaskPath", "isWithinTaskPath"],
  "apps/vestra-cli/src/task/task-codex.ts": ["isTaskPath"],
  "apps/vestra-cli/src/task/task-mutation-sensor.ts": ["isWithinTaskScope"]
});

for (const [path, names] of Object.entries(STAGES))
  test(`${path} asks the task-path module`, () => {
    const source = productSources.find((entry) => entry.path === path)?.source;
    assert.ok(source !== undefined, `${path} was not scanned`);
    const imported = /import\s*\{([^}]*)\}\s*from\s*"@verchestra\/domain"/u.exec(source)?.[1] ?? "";
    for (const name of names) {
      assert.match(imported, new RegExp(`\\b${name}\\b`, "u"), `${path} does not import ${name}`);
      assert.match(source, new RegExp(`\\b${name}\\(`, "u"), `${path} does not call ${name}`);
    }
  });
