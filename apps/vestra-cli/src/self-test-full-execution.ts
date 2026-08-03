import {
  TaskExecutionCoordinator,
  TaskGateCommitCoordinator,
  canonicalTaskGatePlan,
  type FullDurableBoundaryId
} from "@verchestra/application";
import { sha256Digest } from "@verchestra/evidence";

const WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
const RUN_ID = "run_018f0b6d-7b1a-7abc-8def-112345678901";
const CHANGE_PATH = "apps/vestra-cli/src/self-test-full-scenario.ts";
const BASE_COMMIT = "a".repeat(40);

type ShaDigest = `sha256:${string}`;
const digest = (value: string): ShaDigest => `sha256:${sha256Digest(value)}`;
const CHANGE_DIGEST = digest("self-test-change");
const APPROVAL_DIGEST = digest("approval");
const CONTEXT_DIGEST = digest("context");

export interface ExecutionBoundaryHooks {
  readonly before: (boundaryId: FullDurableBoundaryId) => Promise<void>;
  readonly after: (boundaryId: FullDurableBoundaryId) => Promise<void>;
}

async function boundary<T>(
  hooks: ExecutionBoundaryHooks,
  boundaryId: FullDurableBoundaryId,
  operation: () => Promise<T>
): Promise<T> {
  await hooks.before(boundaryId);
  const result = await operation();
  await hooks.after(boundaryId);
  return result;
}

function executionInput() {
  return {
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    executionPackageDigest: digest("execution-package"),
    sourceStateDigest: digest("source-state"),
    sourceRevision: BASE_COMMIT,
    contextManifestDigest: CONTEXT_DIGEST,
    mode: "team",
    task: {
      taskId: "T71",
      requirementIds: ["VES-STF-001"],
      dependencyTaskIds: [],
      component: CHANGE_PATH,
      changeScope: ["apps/vestra-cli/src"],
      protectedPaths: [".git", ".verchestra/policy"],
      verificationCommands: ["pnpm typecheck"],
      doneCriteria: ["full scenario reaches AWAITING_GATE"],
      risk: "high",
      expectedCommitBoundary: "feat(self-test): qualify the full scenario"
    },
    authority: {
      approvalRef: "approval:execution:self-test",
      approvalBindingDigest: APPROVAL_DIGEST,
      capabilityGrantRefs: ["grant:read-only:self-test"]
    }
  };
}

async function executeTask(hooks: ExecutionBoundaryHooks) {
  const coordinator = new TaskExecutionCoordinator({
    authority: { verify: async () => ({ authorized: true, bindingDigest: APPROVAL_DIGEST }) },
    coordination: {
      acquire: async () => ({ coordinationRef: "coordination:self-test", expiresAt: "2026-07-15T16:00:00.000Z" }),
      release: async () => undefined
    },
    worktrees: {
      create: async () => ({ worktreeRef: "worktree:self-test", baseCommit: BASE_COMMIT }),
      inspect: async () => ({ changedPaths: [CHANGE_PATH], changeDigest: CHANGE_DIGEST, commitCountSinceBase: 0 }),
      cleanup: async () => undefined
    },
    checkpoints: {
      load: async () => undefined,
      save: async (checkpoint) => {
        const save = async () => ({ checkpointRef: `checkpoint:${checkpoint.stage}` });
        return checkpoint.stage === "awaiting-gate"
          ? boundary(hooks, "full.execution.checkpoint-stored", save)
          : save();
      }
    },
    context: {
      compile: async () => ({ contextRef: "context:self-test", contextDigest: CONTEXT_DIGEST })
    },
    tools: {
      invoke: async () => ({ receiptRef: "receipt:unused" })
    },
    driver: {
      execute: async () => ({ status: "completed", outputRefs: ["output:self-test"] }),
      cancel: async () => undefined
    }
  });
  return coordinator.execute(executionInput());
}

function gatePlan() {
  const plan = {
    schemaVersion: 1,
    commands: [
      {
        gateId: "gate:typecheck",
        requirementIds: ["VES-STF-001"],
        declaredCommand: "pnpm typecheck",
        commandRef: "command:pnpm",
        args: ["typecheck"],
        cwd: ".",
        timeoutMs: 60_000,
        outputLimitBytes: 1_000_000,
        resultProtocol: "exit-code",
        minimumTests: 0
      }
    ]
  } as const;
  return { ...plan, planDigest: digest(canonicalTaskGatePlan(plan)) };
}

async function commitGate(hooks: ExecutionBoundaryHooks, execution: Awaited<ReturnType<typeof executeTask>>) {
  const plan = gatePlan();
  const coordinator = new TaskGateCommitCoordinator({
    digest: { sha256: digest },
    authority: {
      verify: async () => ({ authorized: true, bindingDigest: APPROVAL_DIGEST, gatePlanDigest: plan.planDigest })
    },
    worktrees: {
      inspect: async () => ({ changedPaths: [CHANGE_PATH], changeDigest: CHANGE_DIGEST, commitCountSinceBase: 0 }),
      cleanup: async () => undefined
    },
    gates: {
      run: async (command) => ({
        exitCode: 0,
        timedOut: false,
        outputLimitExceeded: false,
        stdoutDigest: digest(`${command.gateId}:stdout`),
        stderrDigest: digest(""),
        stdoutBytes: 1,
        stderrBytes: 0,
        outputRef: `output:${command.gateId}`
      })
    },
    evidence: {
      record: async (entry) => ({
        evidenceRef: `evidence:${String(entry["gateId"])}`,
        evidenceDigest: digest(JSON.stringify(entry))
      })
    },
    checkpoints: {
      load: async () => undefined,
      save: async (entry) => ({ checkpointRef: `checkpoint:${String(entry["stage"])}` })
    },
    git: {
      reconcile: async () => undefined,
      commitAtomic: async (request) =>
        boundary(hooks, "full.gate.commit-stored", async () => ({
          status: "committed",
          commitId: "b".repeat(40),
          parentCommit: request.baseCommit,
          changeDigest: request.expectedChangeDigest,
          gateEvidenceDigest: request.gateEvidenceDigest,
          idempotencyKey: request.idempotencyKey
        }))
    },
    coordination: {
      verify: async () => ({ active: true }),
      release: async () => undefined
    }
  });
  return coordinator.execute({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    runId: RUN_ID,
    task: {
      taskId: "T71",
      requirementIds: ["VES-STF-001"],
      verificationCommands: ["pnpm typecheck"],
      changeScope: ["apps/vestra-cli/src"],
      protectedPaths: [".git", ".verchestra/policy"],
      expectedCommitBoundary: "feat(self-test): qualify the full scenario"
    },
    execution: {
      worktreeRef: execution.worktreeRef,
      baseCommit: execution.baseCommit,
      coordinationRef: execution.coordinationRef,
      changeDigest: execution.changeDigest,
      changedPaths: execution.changedPaths,
      checkpointRef: execution.checkpointRef
    },
    authority: { approvalBindingDigest: APPROVAL_DIGEST },
    gatePlan: plan
  });
}

export async function runSelfTestExecutionAndGate<T>(hooks: ExecutionBoundaryHooks, afterExecution: () => Promise<T>) {
  const execution = await executeTask(hooks);
  const duringExecution = await afterExecution();
  const gate = await commitGate(hooks, execution);
  return { execution, duringExecution, gate };
}
