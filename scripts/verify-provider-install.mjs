// Refuses a provider install that npm reported as a success but did not
// complete: every package the lockfile names for this OS and CPU must be
// installed, at the version the lockfile pins (#596).
//
// why: the platform binary packages are optional dependencies, and npm treats a
// failed optional package as a warning. A tarball that fails its integrity
// check is retried, then skipped, and `npm ci` still exits 0, so the step would
// only fail later, at a `--version` that cannot find its binary.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// npm's platform rule: a `!value` entry excludes that value, and a list with
// any plain entry admits only those.
export function admits(list, value) {
  if (list === undefined) return true;
  if (list.includes(`!${value}`)) return false;
  const allowed = list.filter((entry) => !entry.startsWith("!"));
  return allowed.length === 0 || allowed.includes(value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function entryProblem(directory, key, entry) {
  const manifest = join(directory, key, "package.json");
  if (!existsSync(manifest)) return `${key} ${entry.version} is not installed`;
  const installed = readJson(manifest).version;
  return installed === entry.version ? undefined : `${key} is ${installed}, the lockfile pins ${entry.version}`;
}

export function installProblems(directory, { platform = process.platform, arch = process.arch } = {}) {
  const packages = Object.entries(readJson(join(directory, "package-lock.json")).packages ?? {});
  const applicable = packages.filter(
    ([key, entry]) => key !== "" && admits(entry.os, platform) && admits(entry.cpu, arch)
  );
  if (applicable.length === 0) return [`the lockfile names no package for ${platform}-${arch}`];
  return applicable.map(([key, entry]) => entryProblem(directory, key, entry)).filter(Boolean);
}

function main(argv) {
  const problems = installProblems(resolve(argv[0] ?? "."));
  for (const problem of problems) console.error(`provider install refused: ${problem}`);
  if (problems.length === 0)
    console.log(`provider install matches the lockfile for ${process.platform}-${process.arch}`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main(process.argv.slice(2));
