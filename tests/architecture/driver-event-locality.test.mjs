// invariant: a Driver event is declared in one module,
// packages/domain/src/driver-event/driver-event.ts: the event types, the
// fields of each, and the usage rule. The drivers emit it and the session
// runner and its consumers read it. None of them declares an event of its
// own, and no consumer reads a field of one by name from an open record or
// casts it: the drivers once emitted an open record, each checked usage on its
// own, and two consumers cast the counts to numbers.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER = "packages/domain/src/driver-event/driver-event.ts";
// why: the drivers that report usage, each with the call through which it
// reads a count: the four provider drivers build the usage event, and the mock
// checks the counts it is scripted with.
const USAGE_READERS = Object.freeze({
  "packages/drivers/src/claude-code-driver.ts": /\busageUpdated\(/u,
  "packages/drivers/src/codex-driver.ts": /\busageUpdated\(/u,
  "packages/drivers/src/opencode-driver.ts": /\busageUpdated\(/u,
  "packages/drivers/src/pi-driver.ts": /\busageUpdated\(/u,
  "packages/drivers/src/index.ts": /\busageCount\(/u
});
const CONSUMERS = Object.freeze([
  "apps/vestra-cli/src/self-test-driver-scenario.ts",
  "apps/vestra-cli/src/self-test-full-scenario.ts",
  "apps/vestra-cli/src/task/task-codex.ts",
  "packages/agent-runtime/src/execution/driver-execution-adapter.ts",
  "packages/agent-runtime/src/execution/driver-session-runner.ts"
]);

// why: a comment may name an event to explain a decision; only code counts.
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
const sourceOf = (path) => productSources.find((entry) => entry.path === path)?.source ?? "";

test("the scan reads product sources and the event module holds the table, the types and the usage rule", () => {
  assert.ok(productSources.length > 100, `only ${productSources.length} product sources were scanned`);
  const owner = sourceOf(OWNER);
  for (const declaration of [
    /export const DRIVER_EVENT_FIELDS = /u,
    /export type DriverEvent = /u,
    /export type DriverEventBody = /u,
    /export function usageCount\(/u,
    /export function usageUpdated\(/u
  ])
    assert.match(owner, declaration, `${OWNER} no longer declares ${declaration}`);
  for (const consumer of CONSUMERS) assert.notEqual(sourceOf(consumer), "", `${consumer} was not scanned`);
});

test("no other product source declares a Driver event of its own", () => {
  const declarations = productSources
    .filter(
      ({ path, source }) =>
        path !== OWNER &&
        (/\btype\s+Driver(?:Session)?Event\s*=|\binterface\s+Driver(?:Session)?Event\b/u.test(source) ||
          /Record<string,\s*unknown>>?\s*&\s*\{\s*readonly type: (?:string|DriverEventType)/u.test(source))
    )
    .map(({ path }) => path);
  assert.deepEqual(declarations, [], `a Driver event is also declared in: ${declarations.join(", ")}`);
});

test("no consumer reads a field of a Driver event by name or casts one", () => {
  const offenders = CONSUMERS.filter((path) => /\bevent\[|\bevent(?:\.\w+)?\s+as\s/u.test(sourceOf(path)));
  assert.deepEqual(offenders, [], `a Driver event field is read untyped in: ${offenders.join(", ")}`);
});

test("every driver that reports usage reads its counts through the usage rule", () => {
  for (const [path, call] of Object.entries(USAGE_READERS))
    assert.match(sourceOf(path), call, `${path} does not read its counts through the usage rule`);
});

test("no other product source builds a usage event, and no driver checks a token count itself", () => {
  const copies = productSources
    .filter(
      ({ path, source }) =>
        path !== OWNER &&
        (/type:\s*"usage\.updated"/u.test(source) ||
          (path.startsWith("packages/drivers/src/") && /isSafeInteger\([^)]*\b(?:input|output)Tokens\b/u.test(source)))
    )
    .map(({ path }) => path);
  assert.deepEqual(copies, [], `the usage rule is also spelled out in: ${copies.join(", ")}`);
});

// why: the field table closes an event only where its fields are written out;
// a record spread into an event is not checked against the row.
test("no driver emits an event by spreading a record into it", () => {
  const spreads = productSources
    .filter(
      ({ path, source }) =>
        path.startsWith("packages/drivers/src/") && /\bemit\(\{\s*type:\s*"[^"]+",\s*\.\.\.[A-Za-z_$]/u.test(source)
    )
    .map(({ path }) => path);
  assert.deepEqual(spreads, [], `an event is spread from a record in: ${spreads.join(", ")}`);
});
