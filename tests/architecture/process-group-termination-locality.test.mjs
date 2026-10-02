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

test("the activation launcher ends a child through the shared routine", () => {
  const launcher = code(
    readFileSync(join(repositoryRoot, "packages/platform-node/src/activation-launcher-adapters.ts"), "utf8")
  );
  assert.match(launcher, /terminateProcessGroup\(pid,/u);
  assert.match(launcher, /VES_LAUNCHER_TERMINATION_INCOMPLETE/u);
});
