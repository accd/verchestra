import { TaskExecutionCoordinator } from "../../packages/application/src/index.ts";

export const executorInput = () => ({
  schemaVersion: 1,
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
  runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
  executionPackageDigest: "sha256:" + "1".repeat(64),
  sourceStateDigest: "sha256:" + "2".repeat(64),
  sourceRevision: "a".repeat(40),
  contextManifestDigest: "sha256:" + "3".repeat(64),
  mode: "team",
  task: {
    taskId: "T58.1",
    requirementIds: ["VES-EXE-001", "VES-VFY-001"],
    dependencyTaskIds: ["T57"],
    component: "packages/application/src/execution/task-executor.ts",
    changeScope: ["packages/application/src/execution", "tests/integration/task-executor.test.mjs"],
    protectedPaths: [".git", ".verchestra/policy"],
    verificationCommands: ["pnpm test:integration"],
    doneCriteria: ["authorized isolated execution reaches AWAITING_GATE"],
    risk: "high",
    expectedCommitBoundary: "feat(execution): add authorized task executor"
  },
  authority: {
    approvalRef: "approval:execution:001",
    approvalBindingDigest: "sha256:" + "4".repeat(64),
    capabilityGrantRefs: ["grant:writer:001"]
  }
});

export function executorPorts(overrides = {}) {
  const state = { calls: [], checkpoints: [], toolRequests: [], cleaned: false, released: false };
  const ports = {
    authority: {
      verify: async (_input, phase) => {
        state.calls.push(`authority:${phase}`);
        return { authorized: true, bindingDigest: "sha256:" + "4".repeat(64) };
      },
      ...overrides.authority
    },
    coordination: {
      acquire: async (input) => {
        state.calls.push(`acquire:${input.mode}`);
        return { coordinationRef: "coordination:001", expiresAt: "2026-07-16T00:00:00.000Z" };
      },
      release: async () => {
        state.calls.push("release");
        state.released = true;
      },
      ...overrides.coordination
    },
    worktrees: {
      create: async () => {
        state.calls.push("worktree:create");
        return { worktreeRef: "worktree:001", baseCommit: "a".repeat(40) };
      },
      inspect: async () => {
        state.calls.push("worktree:inspect");
        return {
          changedPaths: ["packages/application/src/execution/task-executor.ts"],
          changeDigest: "sha256:" + "5".repeat(64),
          commitCountSinceBase: 0
        };
      },
      cleanup: async () => {
        state.calls.push("worktree:cleanup");
        state.cleaned = true;
      },
      ...overrides.worktrees
    },
    checkpoints: {
      load: async () => undefined,
      save: async (checkpoint) => {
        state.calls.push(`checkpoint:${checkpoint.stage}`);
        state.checkpoints.push(checkpoint);
        return { checkpointRef: `checkpoint:${checkpoint.stage}` };
      },
      ...overrides.checkpoints
    },
    context: {
      compile: async () => {
        state.calls.push("context");
        return { contextRef: "context:001", contextDigest: "sha256:" + "3".repeat(64) };
      },
      ...overrides.context
    },
    tools: {
      invoke: async (request) => {
        state.calls.push(`tool:${request.operation}`);
        state.toolRequests.push(request);
        return { receiptRef: "receipt:tool:001", outputRef: "output:tool:001" };
      },
      ...overrides.tools
    },
    driver: {
      execute: async (_request, control) => {
        state.calls.push("driver");
        await control.checkpoint("driver-progress", { turn: 1 });
        await control.invokeTool({
          requestId: "tool:001",
          taskId: "T58.1",
          capabilityGrantRef: "grant:writer:001",
          operation: "write",
          targetPaths: ["packages/application/src/execution/task-executor.ts"],
          payloadRef: "payload:001"
        });
        return { status: "completed", outputRefs: ["output:driver:001"] };
      },
      cancel: async () => state.calls.push("driver:cancel"),
      ...overrides.driver
    }
  };
  return { state, ports };
}

export function executor(ports) {
  return new TaskExecutionCoordinator(ports);
}
