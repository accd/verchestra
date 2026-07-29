#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { CONSERVATIVE_GATES, selectGates } from "./gate-selection.mjs";
import { stagesForGates } from "./gate-stages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const ALL_ZERO_SHA = /^0{40}$/u;

export function selectChangedPaths({ base, candidate = "HEAD", repository = root }) {
  if (!base || ALL_ZERO_SHA.test(base)) {
    return { paths: [], mode: "conservative-fallback", fallbackReason: "base SHA is unavailable" };
  }
  try {
    const paths = execFileSync("git", ["-C", repository, "diff", "--name-only", `${base}...${candidate}`], {
      encoding: "utf8"
    })
      .split(/\r?\n/u)
      .filter(Boolean);
    return { paths, mode: "git-range", fallbackReason: null };
  } catch {
    return { paths: [], mode: "conservative-fallback", fallbackReason: "base range cannot be resolved" };
  }
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function candidateSha(repository) {
  try {
    return execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

export function buildEvidence({ base, candidate = "HEAD", repository = root }) {
  const changed = selectChangedPaths({ base, candidate, repository });
  const selection =
    changed.mode === "git-range" ? selectGates(changed.paths) : selectGates(["<conservative-fallback>"]);
  const gates = [...new Set([...selection.gates, ...(changed.mode === "git-range" ? [] : CONSERVATIVE_GATES)])].sort();
  return {
    schemaVersion: 2,
    candidate: candidateSha(repository),
    base: base ?? null,
    selectionMode: changed.mode,
    fallbackReason: changed.fallbackReason,
    changedPathCount: changed.paths.length,
    gates,
    stages: stagesForGates(gates),
    reasons: selection.reasons,
    unmappedPathCount: selection.unmapped.length
  };
}

const invokedAsCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsCli) {
  const evidence = buildEvidence({ base: option("--base"), candidate: option("--candidate") ?? "HEAD" });
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  else process.stdout.write(`${evidence.stages.join(" ")}\n`);
}
