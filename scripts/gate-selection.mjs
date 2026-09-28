// Which gates a change must pass is a declared, testable function of the paths
// it touches - not a reviewer's judgement and not "whatever CI happened to run".
// A path that matches no rule falls back to the conservative set rather than
// being assumed harmless, because the failure this policy exists to prevent was
// exactly a surface nobody had mapped.

import { readFileSync } from "node:fs";

export const ALWAYS_GATE = "gate:quick";
export const CENSUS_GATE = "gate:security";

// No single gate is a superset of the others: `build` carries contract,
// integration, and e2e; `release` carries architecture, qualification,
// security, fault, and release. Together they cover every declared stage.
export const CONSERVATIVE_GATES = Object.freeze(["gate:full", "gate:release"]);
// Control surfaces that must run the conservative set regardless of any narrower
// rule they might also match: qualification reports, CI workflow and dependabot
// config, the root dependency manifests and lockfile (a supply-chain surface a
// dependency bump can move behavior on any other surface through), and the gate
// machinery itself (a change to how gates are composed or selected must run the
// most verification, not the least).
const CONSERVATIVE_PATH =
  /^(?:docs\/qualification\/t\d+[a-z]?-validation\.md|\.github\/(?:workflows\/|dependabot\.yml$)|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.npmrc$|scripts\/(?:gate|gate-stages|gate-selection|gate-output|select-gates|test-scope)\.mjs$)/u;

const RULES = Object.freeze([
  {
    gate: "gate:release",
    reason: "distribution and release identity",
    match:
      /^(?:packages\/distribution\/|apps\/vestra-cli\/|apps\/vestra-launcher\/|scripts\/build-vestra-launcher\.mjs$)/u
  },
  {
    gate: "gate:security",
    reason: "trust, authority, or data-handling surface",
    match:
      /^(?:packages\/(?:policy|evidence|agent-runtime|drivers|data-probe|memory|connectors|effects|workspace|platform-node|extension-host|self-test)\/|schemas\/|tests\/(?:security|fault-injection)\/)/u
  },
  {
    gate: "gate:build",
    reason: "package boundary",
    match: /^(?:packages\/|apps\/|scripts\/architecture\.mjs$|tests\/architecture\/|tests\/build\/)/u
  },
  {
    gate: "gate:full",
    reason: "behavior surface",
    match: /^(?:packages\/application\/|tests\/(?:contract|integration|e2e|unit|mutation|helpers)\/)/u
  },
  {
    gate: ALWAYS_GATE,
    reason: "documentation, specification, or repository metadata",
    match:
      /^(?:docs\/|\.specs\/|spikes\/|scripts\/|tests\/agent-readiness\/|tests\/agent-eval\/|\.github\/(?!workflows\/)|[^/]+\.(?:md|txt|json|yaml|yml)$|\.[^/]+$)/u
  }
]);

export const QUALIFICATION_REPORT = /^docs\/qualification\/t\d+[a-z]?-validation\.md$/u;

// why: a script that carries canonical-JSON signals sits under the scripts/
// catch-all, which selects only gate:quick, so a canonicalizer that decides a
// signature could change with no security review (#395). The census inventory is
// the reviewed list of exactly those files, so it is the routing source, not a
// second hand-kept path list. The census machinery and its policy are the same
// surface.
const CENSUS_SURFACE =
  /^(?:docs\/canonical-json-(?:census\.json|compatibility\.md)|scripts\/canonical-json-census(?:-refresh)?\.mjs)$/u;

// hazard: an unreadable or malformed census must fail selection loudly; treating
// it as empty would silently drop every census path back to gate:quick.
export function loadCensusPaths(url = new URL("../docs/canonical-json-census.json", import.meta.url)) {
  const inventory = JSON.parse(readFileSync(url, "utf8"));
  if (!Array.isArray(inventory?.entries)) throw new Error("canonical-JSON census has no entries array");
  return new Set(inventory.entries.map((entry) => entry.path));
}

const DEFAULT_CENSUS_PATHS = loadCensusPaths();

function selectCensusGate(path, censusPaths, selected, reasons) {
  if (!censusPaths.has(path) && !CENSUS_SURFACE.test(path)) return;
  selected.add(CENSUS_GATE);
  if (!reasons.has(CENSUS_GATE)) reasons.set(CENSUS_GATE, "canonical-JSON census surface");
}

function censusPathsFrom(options) {
  return options?.censusPaths ?? DEFAULT_CENSUS_PATHS;
}

export function selectGates(changedPaths, options) {
  const censusPaths = censusPathsFrom(options);
  const selected = new Set([ALWAYS_GATE]);
  const reasons = new Map();
  const unmapped = [];
  for (const path of changedPaths) {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/u, "");
    if (normalized.length === 0) continue;
    selectCensusGate(normalized, censusPaths, selected, reasons);
    if (CONSERVATIVE_PATH.test(normalized)) {
      for (const gate of CONSERVATIVE_GATES) {
        selected.add(gate);
        reasons.set(gate, "CI or qualification control surface");
      }
      continue;
    }
    // A path can sit on more than one surface, so every matching rule applies.
    // Selecting only the first would silently drop a gate the change needs.
    const matched = RULES.filter((candidate) => candidate.match.test(normalized));
    if (matched.length === 0) {
      unmapped.push(normalized);
      continue;
    }
    for (const rule of matched) {
      selected.add(rule.gate);
      if (!reasons.has(rule.gate)) reasons.set(rule.gate, rule.reason);
    }
  }
  if (unmapped.length > 0) {
    for (const gate of CONSERVATIVE_GATES) {
      selected.add(gate);
      reasons.set(gate, "unmapped path");
    }
  }
  return {
    gates: [...selected].sort(),
    reasons: Object.fromEntries([...reasons].sort(([left], [right]) => left.localeCompare(right))),
    unmapped: unmapped.sort()
  };
}
