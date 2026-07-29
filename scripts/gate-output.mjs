#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function githubOutputFor(evidence) {
  if (!Array.isArray(evidence.stages) || evidence.stages.some((stage) => !/^[a-z0-9:-]+$/u.test(stage))) {
    throw new Error("gate selection evidence has no valid stages");
  }
  return `stages=${evidence.stages.join(" ")}\n`;
}

const [evidencePath, outputPath] = process.argv.slice(2);
const invokedAsCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedAsCli) {
  if (evidencePath && outputPath) {
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    appendFileSync(outputPath, githubOutputFor(evidence), "utf8");
  } else {
    process.stderr.write("usage: node scripts/gate-output.mjs <evidence-path> <github-output-path>\n");
    process.exit(2);
  }
}
