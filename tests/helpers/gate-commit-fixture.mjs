import { createHash } from "node:crypto";

import { TaskGateCommitCoordinator, canonicalTaskGatePlan } from "../../packages/application/src/index.ts";

export const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const gatePlan = () => {
  const plan = {
    schemaVersion: 1,
    commands: [
      {
        gateId: "gate:typecheck",
        requirementIds: ["VES-VFY-001"],
        declaredCommand: "pnpm typecheck",
        commandRef: "command:pnpm",
        args: ["typecheck"],
        cwd: ".",
        timeoutMs: 60_000,
        outputLimitBytes: 1_000_000,
        resultProtocol: "exit-code",
        minimumTests: 0
      },
      {
        gateId: "gate:test",
        requirementIds: ["VES-VFY-001", "VES-VFY-002", "VES-SPC-003", "VES-EXE-006"],
        declaredCommand: "pnpm test:integration",
        commandRef: "command:pnpm",
        args: ["test:integration"],
        cwd: ".",
        timeoutMs: 120_000,
        outputLimitBytes: 2_000_000,
        resultProtocol: "test-summary",
        minimumTests: 30
      }
    ]
  };
  return { ...plan, planDigest: digest(canonicalTaskGatePlan(plan)) };
};

export const gateInput = () => ({
  schemaVersion: 1,
  workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
  runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
  task: {
    taskId: "T59.1",
    requirementIds: ["VES-VFY-001", "VES-VFY-002", "VES-SPC-003", "VES-EXE-006"],
    verificationCommands: ["pnpm typecheck", "pnpm test:integration"],
    changeScope: ["packages/application/src/execution", "tests/integration"],
    protectedPaths: [".git", ".verchestra/policy"],
    expectedCommitBoundary: "feat(execution): add gates and atomic commits"
  },
  execution: {
    worktreeRef: `worktree:${"1".repeat(32)}:${"a".repeat(40)}`,
    baseCommit: "a".repeat(40),
    coordinationRef: "coordination:001",
    changeDigest: "sha256:" + "5".repeat(64),
    changedPaths: ["packages/application/src/execution/gate-commit.ts"],
    checkpointRef: "checkpoint:awaiting-gate"
  },
  authority: {
    approvalBindingDigest: "sha256:" + "4".repeat(64)
  },
  gatePlan: gatePlan()
});

export function gatePorts(overrides = {}) {
  const state = {
    calls: [],
    evidence: [],
    checkpoints: [],
    commits: [],
    cleaned: false,
    released: false,
    gateRuns: 0
  };
  const inspection = () => ({
    changedPaths: ["packages/application/src/execution/gate-commit.ts"],
    changeDigest: "sha256:" + "5".repeat(64),
    commitCountSinceBase: 0
  });
  const ports = {
    digest: { sha256: (value) => digest(value) },
    authority: {
      verify: async (input) => {
        state.calls.push("authority");
        return {
          authorized: true,
          bindingDigest: input.authority.approvalBindingDigest,
          gatePlanDigest: input.gatePlan.planDigest
        };
      },
      ...overrides.authority
    },
    worktrees: {
      inspect: async () => {
        state.calls.push("inspect");
        return inspection();
      },
      cleanup: async () => {
        state.calls.push("cleanup");
        state.cleaned = true;
      },
      ...overrides.worktrees
    },
    gates: {
      run: async (command) => {
        state.calls.push(`gate:${command.gateId}`);
        state.gateRuns += 1;
        return {
          exitCode: 0,
          timedOut: false,
          outputLimitExceeded: false,
          stdoutDigest: digest(`${command.gateId}:stdout`),
          stderrDigest: digest(""),
          stdoutBytes: 100,
          stderrBytes: 0,
          outputRef: `output:${command.gateId}`,
          ...(command.resultProtocol === "test-summary"
            ? { tests: { total: 30, passed: 30, failed: 0, skipped: 0, cancelled: 0, todo: 0 } }
            : {})
        };
      },
      ...overrides.gates
    },
    evidence: {
      record: async (entry) => {
        state.calls.push(`evidence:${entry.gateId}`);
        state.evidence.push(entry);
        return { evidenceRef: `evidence:${entry.gateId}`, evidenceDigest: digest(JSON.stringify(entry)) };
      },
      ...overrides.evidence
    },
    checkpoints: {
      load: async () => undefined,
      save: async (entry) => {
        state.calls.push(`checkpoint:${entry.stage}`);
        state.checkpoints.push(entry);
        return { checkpointRef: `checkpoint:${entry.stage}` };
      },
      ...overrides.checkpoints
    },
    git: {
      reconcile: async () => undefined,
      commitAtomic: async (request) => {
        state.calls.push("commit");
        state.commits.push(request);
        return {
          status: "committed",
          commitId: "b".repeat(40),
          parentCommit: request.baseCommit,
          changeDigest: request.expectedChangeDigest,
          gateEvidenceDigest: request.gateEvidenceDigest,
          idempotencyKey: request.idempotencyKey
        };
      },
      ...overrides.git
    },
    coordination: {
      verify: async () => {
        state.calls.push("coordination:verify");
        return { active: true };
      },
      release: async () => {
        state.calls.push("release");
        state.released = true;
      },
      ...overrides.coordination
    }
  };
  return { state, ports };
}

export const coordinator = (ports) => new TaskGateCommitCoordinator(ports);
