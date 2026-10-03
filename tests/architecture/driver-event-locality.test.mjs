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
