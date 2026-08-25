// Refreshes docs/canonical-json-census.json's mechanical signals from a live
// scan while preserving every declared classification and reason, so a
// migration slice updates its own rows without hand-editing signal counts.
// Rows whose file now uses the V2 contract and carries no ambient-locale
// ordering are reported, never reclassified: classification stays a reviewed
// judgment (docs/canonical-json-compatibility.md).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { collectCensusCandidates } from "./canonical-json-census.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CENSUS = new URL("../docs/canonical-json-census.json", import.meta.url);

function sortedEntries(entries) {
  return [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

export function refreshInventory(candidates, inventory) {
  const declared = new Map(inventory.entries.map((entry) => [entry.path, entry]));
  const entries = candidates.map((candidate) => {
    const previous = declared.get(candidate.path);
    return {
      path: candidate.path,
      classification: previous?.classification ?? "pending-versioned-migration",
      signals: candidate.signals,
      reason: previous?.reason ?? "New candidate; classification not yet reviewed."
    };
  });
  const dropped = [...declared.keys()].filter((path) => !candidates.some((entry) => entry.path === path));
  return { inventory: { ...inventory, entries: sortedEntries(entries) }, dropped };
}

export function migrationReadyPaths(inventory) {
  return inventory.entries
    .filter((entry) => entry.classification === "pending-versioned-migration")
    .filter((entry) => entry.signals.canonicalizer > 0 && entry.signals.localeCompare === 0)
    .map((entry) => entry.path);
}

async function main() {
  const inventory = JSON.parse(await readFile(CENSUS, "utf8"));
  const candidates = await collectCensusCandidates(ROOT);
  const { inventory: refreshed, dropped } = refreshInventory(candidates, inventory);
  await writeFile(CENSUS, `${JSON.stringify(refreshed, null, 2)}\n`, "utf8");
  for (const path of dropped) process.stdout.write(`dropped ${path}\n`);
  for (const path of migrationReadyPaths(refreshed)) process.stdout.write(`reclassify-candidate ${path}\n`);
  process.stdout.write(`census refreshed: ${refreshed.entries.length} entries\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
