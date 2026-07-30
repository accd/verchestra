export const scheduleTask = (taskId, { dependencies = [], scope } = {}) => ({
  taskId,
  requirementIds: ["VES-EXE-001"],
  dependencyTaskIds: dependencies,
  component: `packages/application/src/execution/${taskId}.ts`,
  changeScope: scope ?? [`packages/application/src/${taskId}`],
  protectedPaths: [".git"],
  verificationCommands: ["pnpm test:unit"],
  doneCriteria: ["task reaches AWAITING_GATE"],
  risk: "low",
  expectedCommitBoundary: `feat(execution): complete ${taskId}`
});

export const scheduleInput = (tasks, overrides = {}) => ({
  schemaVersion: 1,
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
  runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
  executionPackageDigest: "sha256:" + "1".repeat(64),
  sourceStateDigest: "sha256:" + "2".repeat(64),
  sourceRevision: "a".repeat(40),
  contextManifestDigest: "sha256:" + "3".repeat(64),
  mode: "team",
  authority: {
    approvalRef: "approval:execution:001",
    approvalBindingDigest: "sha256:" + "4".repeat(64),
    capabilityGrantRefs: ["grant:writer:001"]
  },
  maxConcurrentTasks: 4,
  tasks,
  ...overrides
});
