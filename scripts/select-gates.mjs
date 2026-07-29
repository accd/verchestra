#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { gatesDeclaredByReport, QUALIFICATION_REPORT, selectGates } from "./gate-selection.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const base = process.argv[2];

function changedPaths() {
  const range = base ? [`${base}...HEAD`] : ["HEAD~1", "HEAD"];
  try {
    return execFileSync("git", ["-C", root, "diff", "--name-only", ...range], { encoding: "utf8" })
      .split(/\r?\n/u)
      .filter(Boolean);
  } catch {
    // A missing base is not a reason to run less. Fail closed by treating the
    // change as unmapped.
    return ["<unknown>"];
  }
}

const paths = changedPaths();
const declared = paths
  .filter((path) => QUALIFICATION_REPORT.test(path) && existsSync(join(root, path)))
  .flatMap((path) => gatesDeclaredByReport(readFileSync(join(root, path), "utf8")));

const selection = selectGates(paths, declared);
const evidence = {
  schemaVersion: 1,
  changedPathCount: paths.length,
  gates: selection.gates,
  reasons: selection.reasons,
  unmappedPathCount: selection.unmapped.length
};

if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
else process.stdout.write(`${selection.gates.join(" ")}\n`);
