// invariant: one module starts, cancels and closes a driver session (ADP-4):
// packages/agent-runtime/src/execution/driver-session-runner.ts. A composition
// or adapter source that starts a session itself has taken a second copy of
// the already-aborted check, the cancel on stop, the close, and the rule that
// classifies how a session ended.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER = "packages/agent-runtime/src/execution/driver-session-runner.ts";
// why: these are the sources that can hold a driver: the composition root, and
// the package that declares the structural driver port.
const SCANNED_ROOTS = Object.freeze(["apps/vestra-cli/src", "packages/agent-runtime/src"]);
const CONSUMERS = Object.freeze([
  "apps/vestra-cli/src/self-test-driver-scenario.ts",
  "apps/vestra-cli/src/self-test-full-scenario.ts",
  "apps/vestra-cli/src/task/task-codex.ts",
  "apps/vestra-cli/src/task/task-coordination.ts",
  "packages/agent-runtime/src/execution/driver-execution-adapter.ts"
]);

// why: a comment may name the protocol to explain a decision; only code counts.
function code(source) {
  return source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

const sources = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(repositoryRoot, root))).map((path) => ({
  name: relative(repositoryRoot, path).replaceAll("\\", "/"),
  source: code(readFileSync(path, "utf8"))
}));
const sourceOf = (name) => sources.find((entry) => entry.name === name)?.source ?? "";
const offenders = (pattern) =>
  sources.filter(({ name, source }) => name !== OWNER && pattern.test(source)).map(({ name }) => name);

test("the scan reads the composition root and agent-runtime, and the runner holds the whole session protocol", () => {
  assert.ok(sources.length >= 60, `only ${sources.length} sources were scanned`);
  for (const call of [/\.driver\.start\(/u, /\.driver\.cancel\(/u, /\.driver\.close\(/u])
    assert.match(sourceOf(OWNER), call, `${OWNER} no longer makes the call ${call}`);
});

test("no other source starts a driver session", () => {
  // invariant: a session that was never started here cannot be cancelled or
  // closed here either, so the start is the one call to forbid.
  assert.deepEqual(offenders(/\.start\(/u), []);
});

test("no other source cancels or closes a session on a driver it holds", () => {
  assert.deepEqual(offenders(/\b(?:driver|verifier|implementer)\.(?:cancel|close)\(\s*(?:session|reference|\{)/u), []);
});

test("every consumer of a driver session reaches it through the runner", () => {
  for (const consumer of CONSUMERS)
    assert.match(
      sourceOf(consumer),
      /\brunDriverSession\(/u,
      `${consumer} does not run its session through the runner`
    );
  assert.deepEqual(
    sources
      .filter(({ source }) => /\brunDriverSession\(/u.test(source))
      .map(({ name }) => name)
      .filter((name) => name !== OWNER)
      .sort((left, right) => Number(left > right) - Number(left < right)),
    [...CONSUMERS]
  );
});
