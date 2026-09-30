const STATIC_CHECKS = ["format:check", "lint", "complexity:check", "typecheck"];

export const GATE_STAGES = Object.freeze({
  // why: the canonical-JSON census once ran only under security and release, so a
  // script that gained a canonicalizer merged red on gate:quick alone (#395). The
  // census is a sub-second static scan, so every change now pays for it.
  "gate:quick": [...STATIC_CHECKS, "test:unit", "test:agent-readiness", "test:census"],
  "gate:full": [
    ...STATIC_CHECKS,
    "test:unit",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:fault",
    "test:mutation"
  ],
  "gate:build": [
    ...STATIC_CHECKS,
    "build",
    "test:unit",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:architecture",
    "test:build",
    "test:qualification"
  ],
  "gate:security": [
    ...STATIC_CHECKS,
    "build",
    "test:unit",
    "test:contract",
    "test:e2e",
    "test:architecture",
    "test:qualification",
    "test:security",
    "test:fault"
  ],
  "gate:release": [
    ...STATIC_CHECKS,
    "build",
    "test:unit",
    "test:architecture",
    "test:build",
    "test:qualification",
    "test:security",
    "test:fault",
    "test:release"
  ]
});

export function stagesForGates(gates) {
  const stages = new Set();
  for (const gate of gates) {
    const profile = GATE_STAGES[gate];
    if (!profile) throw new Error(`unknown gate profile: ${gate}`);
    for (const stage of profile) stages.add(stage);
  }
  return [...stages];
}
