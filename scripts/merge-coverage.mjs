// Usage: node scripts/merge-coverage.mjs <coverage-directory>
// Merges every `<scope>.lcov` in the directory into `<directory>/lcov.info`.
// A directory with no report fails closed: an empty coverage upload would read
// as 0 % rather than as a run that measured nothing.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { mergeLcov } from "./coverage-lcov.mjs";

const directory = process.argv[2];
if (!directory) {
  process.stderr.write("usage: node scripts/merge-coverage.mjs <coverage-directory>\n");
  process.exit(2);
}
const names = (await readdir(directory))
  .filter((name) => name.endsWith(".lcov"))
  .sort((left, right) => Number(left > right) - Number(left < right));
const merged = mergeLcov(await Promise.all(names.map((name) => readFile(join(directory, name), "utf8"))));
if (merged === "") {
  process.stderr.write(`merge-coverage: no LCOV records under ${directory}\n`);
  process.exit(1);
}
await writeFile(join(directory, "lcov.info"), merged);
process.stdout.write(`merge-coverage: ${names.length} reports -> ${join(directory, "lcov.info")}\n`);
