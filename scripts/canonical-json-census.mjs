import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const SOURCE_ROOTS = Object.freeze(["packages", "apps", "scripts"]);
const SOURCE_FILE = /\.(?:ts|mjs)$/u;
export const CENSUS_SCOPE_EXCLUSIONS = Object.freeze(
  new Map([
    ["apps/site/scripts/check-built-site.mjs", "Build-time site diagnostic output, not a product identity."],
    ["apps/site/tests/e2e/site.spec.ts", "Site test fixture, not product source."],
    ["apps/vestra-cli/src/self-test-driver-fake.mjs", "Self-Test fake-driver fixture, not product behavior."],
    ["apps/vestra-cli/src/self-test-full-crash-child.ts", "Ephemeral Self-Test child-process fact handoff."],
    ["packages/drivers/src/claude-code-driver.ts", "Protocol frame serialization, not a canonical product identity."],
    ["packages/drivers/src/codex-driver.ts", "Protocol frame serialization, not a canonical product identity."],
    ["packages/self-test/src/git-fixtures.ts", "Git fixture serialization, not product behavior."],
    ["scripts/agent-context.mjs", "Diagnostic command output, not product behavior."],
    ["scripts/canonical-json-census-refresh.mjs", "Census maintenance diagnostic, not a scanned product source."],
    ["scripts/canonical-json-census.mjs", "Census implementation, not a scanned product source."],
    ["scripts/requirements-trace.mjs", "Requirement traceability diagnostic output, not product behavior."],
    ["scripts/select-gates.mjs", "Diagnostic command output, not product behavior."]
  ])
);
const CLASSIFICATIONS = new Set([
  "migrated-v2",
  "pending-versioned-migration",
  "presentation-or-fixture",
  "raw-byte-digest",
  "retained-v1-versioned"
]);
const SIGNAL_FIELDS = Object.freeze(["canonicalizer", "digest", "localeCompare", "serialization"]);
const PRESENTATION_OR_FIXTURE_PATHS = new Set([
  "apps/site/src/lib/llm-content.ts",
  "apps/vestra-cli/src/cli.ts",
  // scripts/agent-readiness.mjs left this exception when B5 (#18) made it verify
  // release-decision signatures: a canonicalizer that influences a signature is a
  // trust operation, reclassified to migrated-v2 in the census inventory (#395).
  "scripts/complexity.mjs",
  "scripts/gate-selection.mjs",
  "scripts/generate-contract-types.mjs"
]);
const PRESENTATION_OR_FIXTURE_REASON =
  "Closed presentation, fixture, or repository-diagnostic ordering only; not a trust or persistent identity.";
const DETECTORS = Object.freeze({
  canonicalizer:
    /canonicalizeJson|(?:async\s+)?function\s+canonicalize[A-Za-z0-9]*|(?:const|let)\s+canonicalize[A-Za-z0-9]*\s*=|canonicalJson|canonical\(/gu,
  digest: /createHash|sha256Digest/gu,
  localeCompare: /\.localeCompare\(/gu,
  serialization: /JSON\.stringify\(/gu
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
    localeCompare: count(source, DETECTORS.localeCompare),
    serialization: count(source, DETECTORS.serialization)
  });
}

export async function collectCensusCandidates(root) {
  const files = (await Promise.all(SOURCE_ROOTS.map((directory) => sourceFiles(join(root, directory))))).flat();
  const candidates = [];
  for (const file of files) {
    const path = relative(root, file).replaceAll("\\", "/");
    if (CENSUS_SCOPE_EXCLUSIONS.has(path)) continue;
    const signals = signalsFor(await readFile(file, "utf8"));
    if (Object.values(signals).some((value) => value > 0)) candidates.push({ path, signals });
  }
  return candidates.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function sorted(values) {
  return [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

function signalsMatch(left, right) {
  return SIGNAL_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function hasReason(entry) {
  if (typeof entry.reason !== "string") return false;
  return entry.reason.length > 0;
}

function hasInvalidPresentationException(entry) {
  if (entry.classification !== "presentation-or-fixture") return false;
  if (!PRESENTATION_OR_FIXTURE_PATHS.has(entry.path)) return true;
  return entry.reason !== PRESENTATION_OR_FIXTURE_REASON;
}

export function validateCensusInventory(candidates, inventory) {
  const entries = Array.isArray(inventory?.entries) ? inventory.entries : [];
  const candidateByPath = new Map(candidates.map((candidate) => [candidate.path, candidate]));
  const seen = new Set();
  const duplicatePaths = [];
  const invalidClassifications = [];
  const invalidExceptionPaths = [];
  const invalidReasons = [];
  const stalePaths = [];
  const signalMismatches = [];

  for (const entry of entries) {
    if (seen.has(entry.path)) duplicatePaths.push(entry.path);
    seen.add(entry.path);
    if (!CLASSIFICATIONS.has(entry.classification)) invalidClassifications.push(entry.path);
    if (!hasReason(entry)) invalidReasons.push(entry.path);
    if (hasInvalidPresentationException(entry)) invalidExceptionPaths.push(entry.path);
    const candidate = candidateByPath.get(entry.path);
    if (candidate === undefined) stalePaths.push(entry.path);
    else if (!signalsMatch(candidate.signals, entry.signals)) signalMismatches.push(entry.path);
  }

  return Object.freeze({
    duplicatePaths: sorted(new Set(duplicatePaths)),
    invalidClassifications: sorted(new Set(invalidClassifications)),
    invalidExceptionPaths: sorted(new Set(invalidExceptionPaths)),
    invalidReasons: sorted(new Set(invalidReasons)),
    missingPaths: sorted([...candidateByPath.keys()].filter((path) => !seen.has(path))),
    signalMismatches: sorted(new Set(signalMismatches)),
    stalePaths: sorted(new Set(stalePaths))
  });
}
