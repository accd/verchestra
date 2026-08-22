import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// AC1 (T72, #13): "No mutable or paid adapter method is reachable from diagnostic
// execution." Deep doctor is composed in exactly one file. Before this guard the
// property held only by inspection - nothing proved it, so the audit read it as
// vacuously true. These assertions make it structural: the doctor graph may
// import only from a read-only allowlist, spawns only a read-only git probe,
// touches no writing filesystem call, and names no command bus, provider,
// driver, connector, or writer surface. Widening the graph is then a conscious,
// reviewed change to the allowlist, never an accident.

const source = readFileSync(new URL("../../apps/vestra-cli/src/doctor-composition.ts", import.meta.url), "utf8");

// Every module the deep-doctor composition root is allowed to reach. Each entry
// is read-only by contract: application owns pure rules, contracts is schema
// metadata, evidence seals the report, release-manifest resolves identity, domain
// names the workspace layout the doctor watches and takes no third-party or
// node: import itself (tests/architecture/repository-boundaries.test.mjs), and
// the node builtins are used only through their read-only calls (asserted
// below). Adding an entry here is the reviewed act of widening the graph.
const READ_ONLY_IMPORTS = Object.freeze(
  new Set([
    "node:child_process",
    "node:crypto",
    "node:fs",
    "node:path",
    "@verchestra/application",
    "@verchestra/contracts",
    "@verchestra/domain",
    "@verchestra/evidence",
    "./release-manifest.ts"
  ])
);

function importSpecifiers(code) {
  return [...code.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
}

test("deep doctor composes from a read-only allowlist only", () => {
  const specifiers = importSpecifiers(source);
  assert.ok(specifiers.length > 0, "the composition must import something to compose");
  for (const specifier of specifiers)
    assert.ok(
      READ_ONLY_IMPORTS.has(specifier),
      `doctor-composition imports ${specifier}, which is outside the read-only allowlist; ` +
        "widening the doctor graph must be a conscious change to READ_ONLY_IMPORTS with review"
    );
});

test("deep doctor reaches no writing filesystem call", () => {
  for (const forbidden of [
    "writeFileSync",
    "appendFileSync",
    "mkdirSync",
    "rmSync",
    "rmdirSync",
    "unlinkSync",
    "createWriteStream",
    "writeFile",
    "openSync"
  ])
    assert.doesNotMatch(source, new RegExp(`\\b${forbidden}\\b`, "u"), `doctor-composition must not call ${forbidden}`);
});

test("deep doctor spawns only a read-only git version probe", () => {
  const spawns = [...source.matchAll(/spawnSync\(\s*"([^"]+)"\s*,\s*\[([^\]]*)\]/gu)];
  assert.equal(spawns.length, 1, "exactly one child process is expected, the git probe");
  assert.equal(spawns[0][1], "git", "the only spawned process is git");
  assert.match(spawns[0][2], /"--version"/u, "git is invoked read-only, for its version");
});

test("deep doctor names no command bus, provider, driver, connector, or writer adapter", () => {
  // Symbol names, not English words, so the file's own prose ("opens a writer",
  // "calls a provider") cannot trip the guard.
  for (const forbidden of [
    "createCommandBus",
    "CommandBus",
    "@verchestra/drivers",
    "@verchestra/connectors",
    "@verchestra/data-probe",
    "RuntimeStore",
    "isAuthorized"
  ])
    assert.doesNotMatch(source, new RegExp(forbidden, "u"), `doctor execution must not reach ${forbidden}`);
});
