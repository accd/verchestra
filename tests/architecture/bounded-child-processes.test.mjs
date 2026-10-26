// invariant: ARQ-003 (#597). Every child process production source starts
// outside a provider session carries a time bound. A start through
// execFile, execFileSync, spawnSync, or a promisified execFile names a
// timeout or a shared bound in its own call; a start through spawn is one of
// the reviewed sites below, each a provider session or a start that owns its
// timer, so a new unbounded start fails here before it ships.
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BOUNDED = /\btimeout\b|\b[A-Z_]+_BOUND\b|\bbound\b/u;

const SPAWN_SITES = Object.freeze({
  "packages/drivers/src/opencode-driver.ts":
    "the OpenCode server is a provider session; a listen timer bounds its start",
  "packages/drivers/src/provider-child-run.ts": "a provider session; its budget and cancellation end it",
  "packages/platform-node/src/activation-launcher-adapters.ts":
    "the verified launcher handoff: the child is the operator's own command, on inherited stdio",
  "packages/platform-node/src/bounded-child-run.ts": "runBoundedChild enforces the timeout it is given",
  "packages/platform-node/src/os-secret-backends/credential-tool.ts":
    "every credential tool invocation has a timeoutMs",
  "packages/platform-node/src/spawned-probe-worker.ts":
    "the extension host ends a probe worker at its plan's timeoutMs",
  "packages/platform-node/src/windows-pipe-transport.ts":
    "the pipe helper is a session's bridge channel; the transport bounds its start and ends it with the session"
});

// why: these are the starts ARQ-003 bounded and the two it found bounded; the
// detector has to keep seeing each of them, or a green run proves nothing.
const KNOWN_BOUNDED_STARTS = Object.freeze({
  "apps/vestra-cli/src/doctor-composition.ts": 1,
  "apps/vestra-cli/src/task/task-codex-identity.ts": 1,
  "packages/drivers/src/driver-version-probe.ts": 1,
  "packages/platform-node/src/process-tree-terminator.ts": 3,
  "packages/platform-node/src/task-worktree.ts": 2,
  "packages/self-test/src/git-fixtures.ts": 1,
  "packages/workspace/src/init/safe-init.ts": 1,
  "packages/workspace/src/scanner/workspace-scanner.ts": 1
});

function starters(text) {
  const imported = /import\s*\{([^}]*)\}\s*from\s*["']node:child_process["']/u.exec(text)?.[1] ?? "";
  const names = imported
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("type "))
    .map((entry) => entry.split(/\s+as\s+/u).at(-1));
  const aliases = [...text.matchAll(/const (\w+) = promisify\(execFile\)/gu)].map((match) => match[1]);
  return { spawn: names.includes("spawn"), bounded: [...names.filter((name) => name !== "spawn"), ...aliases] };
}

// why: the call's code with every string literal emptied, so a bound has to be
// an option or a shared constant, not a word inside a message.
function callCode(text, open) {
  let depth = 0;
  let quote;
  let code = "";
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== undefined) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    code += character;
    if (character === '"' || character === "'" || character === "`") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) return code;
  }
  return code;
}

function calls(text, names) {
  if (names.length === 0) return [];
  const pattern = new RegExp(`(?<![.\\w])(${names.join("|")})\\(`, "gu");
  const found = [];
  for (const match of text.matchAll(pattern)) {
    const lineStart = text.lastIndexOf("\n", match.index) + 1;
    const before = text.slice(lineStart, match.index).trim();
    if (before.startsWith("//") || before.startsWith("*")) continue;
    found.push({
      line: text.slice(0, match.index).split("\n").length,
      call: callCode(text, match.index + match[0].length - 1)
    });
  }
  return found;
}

function inspect(text) {
  const names = starters(text);
  return {
    unbounded: calls(text, names.bounded).filter(({ call }) => !BOUNDED.test(call)),
    bounded: calls(text, names.bounded).filter(({ call }) => BOUNDED.test(call)),
    spawns: names.spawn ? calls(text, ["spawn"]) : []
  };
}

async function typescriptSources(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await typescriptSources(path)));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) files.push(path);
  }
  return files;
}

async function productionSources() {
  const files = [];
  for (const parent of ["packages", "apps"]) {
    for (const entry of await readdir(join(ROOT, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const source = join(ROOT, parent, entry.name, "src");
      const present = await readdir(source).then(
        () => true,
        () => false
      );
      if (present) files.push(...(await typescriptSources(source)));
    }
  }
  return files;
}

test("the detector tells a bounded start from an unbounded one", () => {
  const header = 'import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";\n';
  const sample = (body) => inspect(`${header}const run = promisify(execFile);\n${body}`);
  for (const body of [
    'await run(git, ["status"], { cwd });',
    "execFileSync(git, args);",
    'spawnSync("x", [], { encoding: "utf8" });',
    'execFile(git, ["log"], (error) => fail("timeout"));'
  ])
    assert.equal(sample(body).unbounded.length, 1, `the detector misses ${body}`);
  for (const body of [
    "await run(git, args, { cwd, ...INSPECTION_CHILD_BOUND });",
    'spawnSync(git, ["--version"], { timeout: 5000 });',
    "await run(command, args, { env, ...bound });",
    "// execFileSync(git, args);",
    "db.exec(statement);"
  ])
    assert.equal(sample(body).unbounded.length, 0, `the detector flags ${body}`);
  assert.equal(sample("const child = spawn(command, args);").spawns.length, 1);
  assert.equal(inspect("const child = spawn(command, args);").spawns.length, 0);
});

test("no child process outside a provider session starts without a bound", async () => {
  const files = await productionSources();
  assert.ok(files.length > 200, `only ${files.length} production sources were read`);
  const unbounded = [];
  const spawnFiles = new Set();
  const boundedCounts = {};
  for (const file of files) {
    const path = relative(ROOT, file).replaceAll("\\", "/");
    const found = inspect(await readFile(file, "utf8"));
    for (const { line } of found.unbounded) unbounded.push(`${path}:${line}`);
    if (found.spawns.length > 0) spawnFiles.add(path);
    if (found.bounded.length > 0) boundedCounts[path] = found.bounded.length;
  }
  assert.deepEqual(unbounded, []);
  assert.deepEqual([...spawnFiles].sort(), Object.keys(SPAWN_SITES).sort());
  for (const [path, count] of Object.entries(KNOWN_BOUNDED_STARTS))
    assert.equal(boundedCounts[path], count, `${path} should hold ${count} bounded start(s)`);
});
