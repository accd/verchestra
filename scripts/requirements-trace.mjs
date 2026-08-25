// Builds the traceability view T77 (#18) needs: every VES requirement the
// repository references, where it is claimed, and which qualification report
// or feature validation carries its evidence.
//
// The register (docs/requirements-register.json) is the reviewed source of
// truth for which requirements exist. This scanner never invents an entry and
// never silently drops one: a referenced requirement missing from the register
// and a register entry nothing references are both reported, and the readiness
// test fails on either. That is the whole point — "98 of 98 proven" is not a
// checkable claim until the denominator is a reviewed artifact rather than a
// number in an issue body.

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const REQUIREMENT = /VES-[A-Z]{3}-[0-9]{3}/gu;
const SCAN_ROOTS = Object.freeze([".specs", "docs", "tests", "packages", "apps", "scripts"]);
const SCAN_FILE = /\.(?:md|ts|mjs|json)$/u;
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".git", ".astro", "coverage"]);

// Format fixtures, not requirements: these prove the ID *shape* is validated.
export const FORMAT_FIXTURES = Object.freeze(new Set(["VES-AAA-000"]));

function classify(path) {
  if (path.startsWith("docs/qualification/")) return "qualificationReport";
  if (path.startsWith(".specs/")) return "specification";
  if (path.startsWith("tests/")) return "test";
  return "source";
}

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".specs") continue;
    if (SKIP_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (SCAN_FILE.test(entry.name)) yield path;
  }
}

export async function collectReferences(root = ROOT) {
  const references = new Map();
  for (const scanRoot of SCAN_ROOTS)
    for await (const path of walk(join(root, scanRoot))) {
      const relativePath = relative(root, path).replaceAll("\\", "/");
      if (relativePath === "scripts/requirements-trace.mjs") continue;
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(REQUIREMENT)) {
        const id = match[0];
        if (FORMAT_FIXTURES.has(id)) continue;
        const entry = references.get(id) ?? { specification: [], test: [], source: [], qualificationReport: [] };
        const kind = classify(relativePath);
        if (!entry[kind].includes(relativePath)) entry[kind].push(relativePath);
        references.set(id, entry);
      }
    }
  return new Map(
    [...references.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([id, entry]) => [
        id,
        Object.freeze({
          specification: Object.freeze([...entry.specification].sort()),
          test: Object.freeze([...entry.test].sort()),
          source: Object.freeze([...entry.source].sort()),
          qualificationReport: Object.freeze([...entry.qualificationReport].sort())
        })
      ])
  );
}

const sorted = (values) => [...new Set(values)].sort();

function hasEvidence(found) {
  return found !== undefined && (found.test.length > 0 || found.qualificationReport.length > 0);
}

function auditDeclarations(requirements, references, openGaps) {
  const duplicates = [];
  const withoutSpecification = [];
  const withoutEvidence = [];
  const seen = new Set();
  for (const entry of requirements) {
    if (seen.has(entry.id)) duplicates.push(entry.id);
    seen.add(entry.id);
    const found = references.get(entry.id);
    if (found === undefined) continue;
    if (found.specification.length === 0 && entry.home !== "qualification-report-only")
      withoutSpecification.push(entry.id);
    if (!hasEvidence(found) && !openGaps.has(entry.id)) withoutEvidence.push(entry.id);
  }
  return { duplicates, withoutSpecification, withoutEvidence };
}

function auditGaps(openGaps, references) {
  return {
    staleGaps: [...openGaps.keys()].filter((id) => hasEvidence(references.get(id))),
    gapsWithoutReason: [...openGaps.values()]
      .filter((entry) => typeof entry.reason !== "string" || entry.reason.length === 0)
      .map((entry) => entry.id)
  };
}

export function evaluateRegister(register, references) {
  const requirements = register?.requirements ?? [];
  const declared = new Map(requirements.map((entry) => [entry.id, entry]));
  const openGaps = new Map((register?.openGaps ?? []).map((entry) => [entry.id, entry]));
  const unregistered = [...references.keys()].filter((id) => !declared.has(id));
  const unreferenced = [...declared.keys()].filter((id) => !references.has(id));
  const { duplicates, withoutSpecification, withoutEvidence } = auditDeclarations(requirements, references, openGaps);
  const { staleGaps, gapsWithoutReason } = auditGaps(openGaps, references);
  return Object.freeze({
    total: declared.size,
    referenced: references.size,
    declaredGaps: openGaps.size,
    unregistered: sorted(unregistered),
    unreferenced: sorted(unreferenced),
    duplicates: sorted(duplicates),
    withoutSpecification: sorted(withoutSpecification),
    withoutEvidence: sorted(withoutEvidence),
    staleGaps: sorted(staleGaps),
    gapsWithoutReason: sorted(gapsWithoutReason)
  });
}

// Consistency: the register describes the repository accurately. This is what
// every gate enforces, and it fails closed on a new unevidenced requirement.
export function isConsistent(evaluation) {
  return (
    evaluation.unregistered.length === 0 &&
    evaluation.duplicates.length === 0 &&
    evaluation.unreferenced.length === 0 &&
    evaluation.withoutSpecification.length === 0 &&
    evaluation.withoutEvidence.length === 0 &&
    evaluation.staleGaps.length === 0 &&
    evaluation.gapsWithoutReason.length === 0
  );
}

// Closure: additionally, no requirement is still waiting for evidence. This is
// the T77 (#18) acceptance condition, deliberately separate from consistency so
// a declared gap stays visible instead of blocking every unrelated change.
export function isClosed(evaluation) {
  return isConsistent(evaluation) && evaluation.declaredGaps === 0;
}

async function main() {
  const references = await collectReferences();
  const emitRegister = process.argv.includes("--emit-register");
  if (emitRegister) {
    const requirements = [...references.entries()].map(([id, found]) => ({
      id,
      declaredIn: found.specification[0] ?? null,
      home: found.specification.length > 0 ? "specification" : "qualification-report-only",
      evidence: found.test.length > 0 ? "test" : found.qualificationReport.length > 0 ? "report" : "none"
    }));
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, requirements }, null, 2)}\n`);
    return;
  }
  const register = JSON.parse(await readFile(new URL("../docs/requirements-register.json", import.meta.url), "utf8"));
  const evaluation = evaluateRegister(register, references);
  process.stdout.write(
    `registered: ${evaluation.total}\nreferenced: ${evaluation.referenced}\ndeclared gaps: ${evaluation.declaredGaps}\n`
  );
  for (const field of [
    "unregistered",
    "unreferenced",
    "duplicates",
    "withoutSpecification",
    "withoutEvidence",
    "staleGaps",
    "gapsWithoutReason"
  ])
    if (evaluation[field].length > 0) process.stdout.write(`${field}: ${evaluation[field].join(", ")}\n`);
  const consistent = isConsistent(evaluation);
  process.stdout.write(consistent ? "traceability CONSISTENT\n" : "traceability INCONSISTENT\n");
  process.stdout.write(isClosed(evaluation) ? "T77 closure MET\n" : "T77 closure NOT MET\n");
  process.exitCode = consistent ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
