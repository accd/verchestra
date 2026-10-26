// Usage: node scripts/merge-coverage.mjs
// Merges every `<scope>.lcov` that `VES_COVERAGE=1` scopes wrote under
// `coverage/` in the working directory into `coverage/lcov.info`. The directory
// is fixed rather than an argument, so no caller-supplied text becomes a path.
// A directory with no report fails closed: an empty coverage upload would read
// as 0 % rather than as a run that measured nothing.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { mergeLcov } from "./coverage-lcov.mjs";

const directory = resolve("coverage");
const names = (await readdir(directory).catch(() => []))
  .filter((name) => name.endsWith(".lcov"))
  .sort((left, right) => Number(left > right) - Number(left < right));
const merged = mergeLcov(await Promise.all(names.map((name) => readFile(join(directory, name), "utf8"))));
if (merged === "") {
  process.stderr.write(`merge-coverage: no LCOV records under ${directory}\n`);
  process.exit(1);
}
await writeFile(join(directory, "lcov.info"), merged);
process.stdout.write(`merge-coverage: ${names.length} reports -> ${join(directory, "lcov.info")}\n`);
