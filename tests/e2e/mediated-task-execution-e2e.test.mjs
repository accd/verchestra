// Foundations journey for #405: the real TaskExecutionCoordinator drives the
// production ClaudeCodeDriver (mediated-mcp profile) through the production
// MCP bridge, the real worktree tool adapter, and durable checkpoints. The
// implementer is the DETERMINISTIC FAKE `claude` executable from the T03
// requalification spike; no provider is contacted.
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import { DriverExecutionAdapter, InMemoryExecutionPayloadStore } from "../../packages/agent-runtime/src/index.ts";
import { TaskExecutionCoordinator } from "../../packages/application/src/index.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/index.ts";
import { NodeWorktreeToolAdapter, RuntimeCheckpointStore } from "../../packages/platform-node/src/index.ts";
import { mockRequest } from "../helpers/driver-protocol-fixture.mjs";
import { WIN32_HOST } from "../helpers/mediation-platform.mjs";
import { cleanupWorktreeTools, worktreeToolFixture } from "../helpers/worktree-tool-fixture.mjs";

const fakeClaude = fileURLToPath(
  new URL("../../spikes/claude-code-driver/test/fake-claude-mediated.mjs", import.meta.url)
);
const relayEntry = fileURLToPath(
  new URL("../../packages/agent-runtime/src/execution/mcp-tool-bridge-main.ts", import.meta.url)
);
const credential = "e2e-credential-value";

afterEach(cleanupWorktreeTools);

async function journey(scenario) {
  const fixture = await worktreeToolFixture({ anchorTaskCommits: true });
  const payloads = new InMemoryExecutionPayloadStore();
  const checkpoints = new RuntimeCheckpointStore(fixture.store);
  const usage = [];
  const worktreePaths = [];
  const input = {
    schemaVersion: 1,
    workspaceId: "workspace_tool",
    runId: "run_405",
    executionPackageDigest: `sha256:${"1".repeat(64)}`,
    sourceStateDigest: `sha256:${"2".repeat(64)}`,
    sourceRevision: fixture.baseCommit,
    contextManifestDigest: `sha256:${"3".repeat(64)}`,
    mode: "personal",
    task: {
      taskId: "T405.3",
      requirementIds: ["VES-EXE-001"],
      dependencyTaskIds: [],
      component: "src",
      changeScope: ["src"],
      protectedPaths: [".git", ".verchestra/policy"],
      verificationCommands: ["node --test"],
      doneCriteria: ["the value is implemented"],
      risk: "low",
      expectedCommitBoundary: "feat(src): implement the value"
    },
    authority: {
      approvalRef: "approval:execution:1",
      approvalBindingDigest: `sha256:${"4".repeat(64)}`,
      capabilityGrantRefs: ["grant:writer:1"]
    },
    budgets: { maximumCostUsd: 5, maximumTokens: 1_000_000, maximumDurationMs: 120_000 }
  };
  const driverAdapter = new DriverExecutionAdapter({
    resolveWorktree: async (worktreeRef) => {
      const path = await fixture.worktrees.resolvePath(worktreeRef);
      worktreePaths.push(path);
      return path;
    },
    payloads,
    bridgeCommand: [process.execPath, relayEntry],
    createSession: async ({ worktreePath, bridge }) => ({
      model: "claude-sonnet-5",
      startRequest: mockRequest(),
      driver: new ClaudeCodeDriver({
        command: [process.execPath, fakeClaude],
        profile: { kind: "mediated-mcp" },
        terminateTree: async (pid) => process.kill(pid),
        resolveExecution: async () => ({
          passport: {
            passportId: "passport_018f0000-0000-7000-8000-000000001504",
            revision: 1,
            provider: "anthropic",
            resolvedModel: "claude-sonnet-5"
          },
          prompt: `scenario:${scenario}`,
          model: "claude-sonnet-5",
          environment: { ANTHROPIC_API_KEY: credential },
          sensitiveValues: [credential],
          mediation: { cwd: worktreePath, bridge }
        })
      })
    })
  });
  const coordinator = new TaskExecutionCoordinator({
    // Deterministic authority, coordination, and context stand-ins: their real
    // adapters are composed by the CLI slice (E6/E7), not this foundation.
    authority: { verify: async () => ({ authorized: true, bindingDigest: input.authority.approvalBindingDigest }) },
    coordination: {
      acquire: async () => ({ coordinationRef: "coordination:e2e", expiresAt: "2099-01-01T00:00:00.000Z" }),
      release: async () => undefined
    },
    worktrees: fixture.worktrees,
    checkpoints: checkpoints.executorCheckpoints(),
    context: { compile: async () => ({ contextRef: "context:e2e", contextDigest: input.contextManifestDigest }) },
    tools: new NodeWorktreeToolAdapter({
      workspaceId: input.workspaceId,
      worktrees: fixture.worktrees,
      receipts: fixture.store.createEffectRepository(),
      payloads,
      protectedRoots: [".verchestra/policy"]
    }),
    driver: {
      execute: (request, control) =>
        driverAdapter.execute(request, {
          ...control,
          checkpoint: control.checkpoint,
          invokeTool: control.invokeTool,
          reportUsage: (event) => {
            usage.push(event);
            control.reportUsage(event);
          }
        }),
      cancel: (worktreeRef) => driverAdapter.cancel(worktreeRef)
    }
  });
  const stages = async () => {
    const loaded = await checkpoints.executorCheckpoints().load(input.workspaceId, input.runId, input.task.taskId);
    return loaded;
  };
  return { coordinator, fixture, input, stages, usage, worktree: () => worktreePaths.at(-1) };
}

// invariant: on win32 the journey fails closed at the bridge: the implementer
// is never spawned, the worktree is removed, and the run records a failure.
async function journeyRefusedOnWin32(t) {
  t.diagnostic("win32: asserting the mediated journey is refused at the bridge instead");
  const { coordinator, input, stages, usage, worktree } = await journey("read-write");
  await assert.rejects(coordinator.execute(input), { code: "VES_BRIDGE_PLATFORM_UNSUPPORTED" });
  await assert.rejects(access(worktree()), { code: "ENOENT" });
  assert.deepEqual(usage, []);
  assert.equal((await stages()).stage, "failed");
}

test("the mediated implementer changes the worktree only through the executor and reaches AWAITING_GATE", async (t) => {
  if (WIN32_HOST) return journeyRefusedOnWin32(t);
  const { coordinator, input, stages, usage, worktree } = await journey("read-write");
  const result = await coordinator.execute(input);
  assert.equal(result.status, "AWAITING_GATE");
  assert.deepEqual(result.changedPaths, ["src/a.txt"]);
  assert.equal(result.toolReceiptRefs.length, 1);
  assert.equal(await readFile(join(worktree(), "src", "a.txt"), "utf8"), "implemented by the fake\n");
  assert.deepEqual(usage, [{ model: "claude-sonnet-5", inputTokens: 11, outputTokens: 7 }]);
  const latest = await stages();
  assert.equal(latest.stage, "awaiting-gate");
  assert.equal(latest.checkpointRef, result.checkpointRef);
  assert.equal(latest.sequence, 3);
});

test("a write outside the change scope is denied by the executor while in-scope work proceeds", async (t) => {
  if (WIN32_HOST) return journeyRefusedOnWin32(t);
  const { coordinator, input, worktree } = await journey("write-outside");
  const result = await coordinator.execute(input);
  assert.deepEqual(result.changedPaths, ["src/a.txt"]);
  assert.equal(result.toolReceiptRefs.length, 1);
  await assert.rejects(access(join(worktree(), "docs")), { code: "ENOENT" });
  assert.equal(await readFile(join(worktree(), "src", "a.txt"), "utf8"), "implemented inside the scope\n");
});

test("a tool requested outside the bridge fails the run closed and removes the worktree", async (t) => {
  if (WIN32_HOST) return journeyRefusedOnWin32(t);
  const { coordinator, input, stages, worktree } = await journey("outside-tool");
  await assert.rejects(coordinator.execute(input), { code: "VES_DRIVER_TOOL_OUTSIDE_BRIDGE" });
  await assert.rejects(access(worktree()), { code: "ENOENT" });
  assert.equal((await stages()).stage, "failed");
});
