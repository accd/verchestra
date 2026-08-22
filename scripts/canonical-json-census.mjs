import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SOURCE_ROOTS = Object.freeze(["packages", "apps", "scripts"]);
const SOURCE_FILE = /\.(?:ts|mjs)$/u;
const EXCLUDED_PATHS = new Set(["scripts/canonical-json-census.mjs"]);
const CLASSIFICATIONS = new Set([
  "migrated-v2",
  "pending-versioned-migration",
  "presentation-or-fixture",
  "raw-byte-digest",
  "retained-v1-versioned"
]);
const DETECTORS = Object.freeze({
  canonicalizer: /canonicalizeJson|canonicalJson|canonical\(/gu,
  digest: /createHash|sha256Digest/gu,
  localeCompare: /\.localeCompare\(/gu
});

function count(source, expression) {
  return [...source.matchAll(expression)].length;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    if (entry.isFile() && SOURCE_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

function signalsFor(source) {
  return Object.freeze({
    canonicalizer: count(source, DETECTORS.canonicalizer),
    digest: count(source, DETECTORS.digest),
    localeCompare: count(source, DETECTORS.localeCompare)
  });
}

export async function collectCensusCandidates(root) {
  const files = (await Promise.all(SOURCE_ROOTS.map((directory) => sourceFiles(join(root, directory))))).flat();
  const candidates = [];
  for (const file of files) {
    const path = relative(root, file).replaceAll("\\", "/");
    if (EXCLUDED_PATHS.has(path)) continue;
    const signals = signalsFor(await readFile(file, "utf8"));
    if (Object.values(signals).some((value) => value > 0)) candidates.push({ path, signals });
  }
  return candidates.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function sorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function signalsMatch(left, right) {
  return (
    left?.canonicalizer === right?.canonicalizer &&
    left?.digest === right?.digest &&
    left?.localeCompare === right?.localeCompare
  );
}

export function validateCensusInventory(candidates, inventory) {
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const seen = new Set();
  const duplicatePaths = [];
  const invalidClassifications = [];
  const stalePaths = [];
  const signalMismatches = [];

  for (const entry of entries) {
    if (seen.has(entry.path)) duplicatePaths.push(entry.path);
    seen.add(entry.path);
    if (!CLASSIFICATIONS.has(entry.classification)) invalidClassifications.push(entry.path);
    const candidate = candidateByPath.get(entry.path);
    if (candidate === undefined) stalePaths.push(entry.path);
    else if (!signalsMatch(candidate.signals, entry.signals)) signalMismatches.push(entry.path);
  }

  return Object.freeze({
    duplicatePaths: sorted(new Set(duplicatePaths)),
    invalidClassifications: sorted(new Set(invalidClassifications)),
    missingPaths: sorted([...candidateByPath.keys()].filter((path) => !seen.has(path))),
    signalMismatches: sorted(new Set(signalMismatches)),
    stalePaths: sorted(new Set(stalePaths))
  });
}
