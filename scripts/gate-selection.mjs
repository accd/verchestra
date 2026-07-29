// Which gates a change must pass is a declared, testable function of the paths
// it touches - not a reviewer's judgement and not "whatever CI happened to run".
// A path that matches no rule falls back to the conservative set rather than
// being assumed harmless, because the failure this policy exists to prevent was
// exactly a surface nobody had mapped.

export const ALWAYS_GATE = "gate:quick";

// No single gate is a superset of the others: `build` carries contract,
// integration, and e2e; `release` carries architecture, qualification,
// security, fault, and release. Together they cover every declared stage.
export const CONSERVATIVE_GATES = Object.freeze(["gate:full", "gate:release"]);

const RULES = Object.freeze([
  {
    gate: "gate:release",
    reason: "distribution and release identity",
    match: /^(?:packages\/distribution\/|apps\/vestra-cli\/|\.github\/workflows\/)/u
  },
  {
    gate: "gate:security",
    reason: "trust, authority, or data-handling surface",
    match:
      /^(?:packages\/(?:policy|evidence|agent-runtime|drivers|data-probe|memory|connectors|effects|workspace|platform-node|extension-host)\/|schemas\/|tests\/(?:security|fault-injection)\/)/u
  },
  {
    gate: "gate:build",
    reason: "package boundary",
    match: /^(?:packages\/|apps\/|scripts\/architecture\.mjs$|tests\/architecture\/)/u
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
      /^(?:docs\/|\.specs\/|spikes\/|scripts\/|tests\/agent-readiness\/|tests\/agent-eval\/|tests\/build\/|\.github\/(?!workflows\/)|[^/]+\.(?:md|txt|json|yaml|yml)$|\.[^/]+$)/u
  }
]);

export const QUALIFICATION_REPORT = /^docs\/qualification\/t\d+[a-z]?-validation\.md$/u;

// A qualification report declares the gates its evidence rests on, so completing
// a task must re-run exactly those gates on the candidate commit rather than
// whatever the path rules would otherwise pick.
export function gatesDeclaredByReport(source) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/u.exec(source);
  if (!frontmatter) return [];
  const gates = /^gates:\s*(.*)$/mu.exec(frontmatter[1]);
  if (!gates) return [];
  return gates[1]
    .split(",")
    .map((gate) => gate.trim().replace(/^pnpm\s+/u, ""))
    .filter((gate) => /^gate:[a-z]+$/u.test(gate));
}

export function selectGates(changedPaths, declaredGates = []) {
  const selected = new Set([ALWAYS_GATE, ...declaredGates]);
  const reasons = new Map();
  const unmapped = [];
  for (const path of changedPaths) {
    const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/u, "");
    if (normalized.length === 0) continue;
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
