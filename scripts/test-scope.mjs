import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// A scope with zero tests fails closed: a green stage that executed nothing is
// indistinguishable from evidence unless it says so. The only admitted empty
// scope is declared here, bound to the task that fills it, so the exception is
// visible in review and expires with T73 instead of living in anyone's memory.
const DECLARED_EMPTY = Object.freeze({
  release: "declared empty until T73 (#14) builds the public regression and system campaigns; not release evidence"
});

const scope = process.argv[2];
const roots = process.argv.slice(3);
const tests = [];
async function collect(directory) {
  if (!existsSync(directory)) return;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (/\.test\.mjs$/.test(entry.name)) tests.push(path);
  }
}
for (const root of roots) await collect(root);
if (tests.length === 0) {
  if (Object.hasOwn(DECLARED_EMPTY, scope)) {
    process.stdout.write(`${scope}: 0 tests — ${DECLARED_EMPTY[scope]}\n`);
    process.exit(0);
  }
  process.stderr.write(`${scope}: 0 tests found under ${roots.join(", ")} — an empty required scope cannot pass\n`);
  process.exit(1);
}
if (Object.hasOwn(DECLARED_EMPTY, scope))
  process.stdout.write(`${scope}: tests exist now — remove the stale declared-empty entry in scripts/test-scope.mjs\n`);
const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
