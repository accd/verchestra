// A well-formed Task Request v1. Tests clone and mutate it; nothing here is a
// credential, a machine-local path, or provider state.
export function validTaskRequest() {
  return {
    schemaVersion: 1,
    sourceRevision: "a".repeat(40),
    task: {
      taskId: "T405.1",
      requirementIds: ["VES-TSK-001", "VES-TSK-002"],
      dependencyTaskIds: [],
      component: "packages/app",
      changeScope: ["packages/app/src", "packages/app/test"],
      protectedPaths: [".git", ".verchestra/policy"],
      verificationCommands: ["node --test packages/app/test", "node scripts/lint.mjs"],
      doneCriteria: ["the greeting names the caller"],
      risk: "medium",
      expectedCommitBoundary: "feat(app): greet the caller by name"
    },
    gates: [
      {
        gateId: "gate:unit",
        requirementIds: ["VES-TSK-001"],
        declaredCommand: "node --test packages/app/test",
        commandRef: "command:node-test",
        args: ["packages/app/test"],
        cwd: ".",
        timeoutMs: 60_000,
        outputLimitBytes: 1_000_000,
        resultProtocol: "test-summary",
        minimumTests: 1
      },
      {
        gateId: "gate:lint",
        requirementIds: ["VES-TSK-002"],
        declaredCommand: "node scripts/lint.mjs",
        commandRef: "command:node",
        args: ["scripts/lint.mjs", "--max-warnings=0"],
        cwd: ".",
        timeoutMs: 60_000,
        outputLimitBytes: 1_000_000,
        resultProtocol: "exit-code",
        minimumTests: 0
      }
    ],
    budgets: { maximumCostUsd: 5, maximumTokens: 2_000_000, maximumDurationMs: 1_800_000 },
    onGateFailure: { maxAttempts: 3, feedbackToDriver: true, escalateAfter: 3 },
    driver: { driverId: "claude-code", model: "claude-sonnet-5" },
    verifier: { driverId: "codex", model: "gpt-5.2-codex" },
    instructions: "Change the greeting so it names the caller.\nKeep the public API unchanged."
  };
}
