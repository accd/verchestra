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

// Drivers park on a per-task gate so tests decide exactly when each in-flight
// task settles. Concurrency is then observed through call order, never timers.
export function schedulerPorts(overrides = {}) {
  const state = { calls: [], started: [], released: [] };
  const gates = new Map();
  const gate = (taskId) => {
    if (!gates.has(taskId)) {
      let resolve;
      gates.set(taskId, { promise: new Promise((done) => (resolve = done)), resolve });
    }
    return gates.get(taskId);
  };
  const ports = {
    authority: {
      verify: async (_input, _phase) => ({ authorized: true, bindingDigest: "sha256:" + "4".repeat(64) }),
      ...overrides.authority
    },
    coordination: {
      acquire: async (input) => {
        state.calls.push(`acquire:${input.taskId}`);
        return { coordinationRef: `coordination:${input.taskId}`, expiresAt: "2026-07-16T00:00:00.000Z" };
      },
      release: async (coordinationRef) => {
        state.released.push(coordinationRef);
      },
      ...overrides.coordination
    },
    worktrees: {
      create: async (input) => {
        state.calls.push(`worktree:${input.taskId}`);
        return { worktreeRef: `worktree:${input.taskId}`, baseCommit: "a".repeat(40) };
      },
      inspect: async (handle) => ({
        changedPaths: [`packages/application/src/${handle.worktreeRef.replace("worktree:", "")}/file.ts`],
        changeDigest: "sha256:" + "5".repeat(64),
        commitCountSinceBase: 0
      }),
      cleanup: async () => {},
      ...overrides.worktrees
    },
    checkpoints: {
      load: async () => undefined,
      save: async (checkpoint) => ({ checkpointRef: `checkpoint:${checkpoint.taskId}:${checkpoint.stage}` }),
      ...overrides.checkpoints
    },
    context: {
      compile: async () => ({ contextRef: "context:001", contextDigest: "sha256:" + "3".repeat(64) }),
      ...overrides.context
    },
    tools: {
      invoke: async () => ({ receiptRef: "receipt:tool:001" }),
      ...overrides.tools
    },
    driver: {
      execute: async (request) => {
        state.started.push(request.task.taskId);
        await gate(request.task.taskId).promise;
        return { status: "completed", outputRefs: [] };
      },
      cancel: async () => {},
      ...overrides.driver
    }
  };
  return {
    state,
    ports,
    release: (taskId) => gate(taskId).resolve()
  };
}

// Let launched tasks reach their driver gates without racing the assertions.
export const flush = async (rounds = 10) => {
  for (let index = 0; index < rounds; index += 1) await new Promise((done) => setImmediate(done));
};
