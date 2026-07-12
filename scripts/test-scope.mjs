import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
  process.stdout.write(`${scope}: 0 tests\n`);
  process.exit(0);
}
const result = spawnSync(process.execPath, ["--test", ...tests], { stdio: "inherit" });
process.exit(result.status ?? 1);
