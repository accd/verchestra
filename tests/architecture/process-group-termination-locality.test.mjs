// invariant: one routine ends a process group. It carries the Darwin rule that
// a group whose members are all zombies awaiting their reaper (EPERM) is gone,
// and a second copy has already drifted from it once: the activation launcher
// kept one without that rule and failed an activation it had stopped correctly.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const OWNER = "packages/platform-node/src/process-tree-terminator.ts";
const GROUP_SIGNAL = /process\.kill\([^)]*-\s*pid\b/u;
const WINDOWS_TREE_KILL = /["']taskkill["']/u;

// why: a comment may name a signal to explain a decision; only code counts.
const code = (source) =>
  source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");

function sources(directory) {
  const found = [];
  for (const name of readdirSync(directory)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...sources(path));
    else if (name.endsWith(".ts")) found.push(path);
  }
  return found;
}

const productSources = ["packages", "apps"]
  .flatMap((root) => sources(join(repositoryRoot, root)))
  .map((path) => relative(repositoryRoot, path).split("\\").join("/"))
  .filter((path) => path.includes("/src/"));

test("the scan is not vacuous and the owner holds both forms of a group termination", () => {
  assert.ok(productSources.length > 100);
  assert.ok(productSources.includes(OWNER));
  const owner = code(readFileSync(join(repositoryRoot, OWNER), "utf8"));
  assert.match(owner, GROUP_SIGNAL);
  assert.match(owner, WINDOWS_TREE_KILL);
});

test("no other product source signals a process group or runs the Windows tree kill itself", () => {
  const copies = productSources
    .filter((path) => path !== OWNER)
    .filter((path) => {
      const source = code(readFileSync(join(repositoryRoot, path), "utf8"));
      return GROUP_SIGNAL.test(source) || WINDOWS_TREE_KILL.test(source);
    });
  // why: the drivers may not import platform-node, so the fallback for a
  // caller that injects no terminator signals the group in the one file that
  // tests/architecture/provider-process-tree-termination.test.mjs pins.
  assert.deepEqual(copies, ["packages/drivers/src/driver-process-tree.ts"]);
});

// invariant: a child platform-node runs to a time and an output bound is run
// by one routine (ADR2-5). It is the only caller of the group termination
// outside the terminator itself; the gate runner and the activation health
// gate keep only their verdicts and name their own termination refusal.
const BOUNDED_RUN = "packages/platform-node/src/bounded-child-run.ts";
const read = (path) => code(readFileSync(join(repositoryRoot, path), "utf8"));

test("only the bounded child run ends a process group through the shared termination", () => {
  const callers = productSources
    .filter((path) => path !== OWNER)
    .filter((path) => /\bterminateProcessGroup\(/u.test(read(path)));
  assert.deepEqual(callers, [BOUNDED_RUN]);
  assert.match(read(BOUNDED_RUN), /\bsetTimeout\(/u);
});

for (const [path, refusal] of [
  ["packages/platform-node/src/gate-commit-adapters.ts", "VES_GATE_ADAPTER_TERMINATION_INCOMPLETE"],
  ["packages/platform-node/src/activation-launcher-adapters.ts", "VES_LAUNCHER_TERMINATION_INCOMPLETE"]
])
  test(`${path} runs its child through the bounded child run and keeps only its verdict`, () => {
    const source = read(path);
    assert.match(source, /\brunBoundedChild\(/u);
    assert.match(source, new RegExp(`incomplete: \\(\\) =>\\s+fail\\("${refusal}"`, "u"));
    assert.doesNotMatch(source, /\bsetTimeout\(/u, "it runs a timer of its own");
    assert.doesNotMatch(source, /\bdetached:/u, "it spawns a bounded child of its own");
  });
