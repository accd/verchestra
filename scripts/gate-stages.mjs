export const GATE_STAGES = Object.freeze({
  "gate:quick": ["format:check", "lint", "complexity:check", "typecheck", "test:unit", "test:agent-readiness"],
  "gate:full": [
    "format:check",
    "lint",
    "complexity:check",
    "typecheck",
    "test:unit",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:fault",
    "test:mutation"
  ],
  "gate:build": [
    "format:check",
    "lint",
    "complexity:check",
    "typecheck",
    "build",
    "test:unit",
    "test:contract",
    "test:integration",
    "test:e2e",
    "test:architecture",
    "test:qualification"
  ],
  "gate:security": [
    "format:check",
    "lint",
    "complexity:check",
    "typecheck",
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
    "format:check",
    "lint",
    "complexity:check",
    "typecheck",
    "build",
    "test:unit",
    "test:architecture",
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
