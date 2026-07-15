import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TaskExecutionCoordinator } from "../../packages/application/src/index.ts";
import { NodeGitWorktreeAdapter } from "../../packages/platform-node/src/index.ts";
import { executorInput } from "../helpers/task-executor-fixture.mjs";

const roots = [];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function targetFor(worktreesRoot, worktreeRef) {
  return join(worktreesRoot, worktreeRef.split(":")[1]);
}

async function fixture(overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-executor-e2e-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const worktreesRoot = join(root, "worktrees");
  await mkdir(join(repositoryRoot, "packages", "app"), { recursive: true });
  await writeFile(join(repositoryRoot, "packages", "app", "value.txt"), "base\n");
  git(repositoryRoot, "init", "--quiet");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "fixture base");
  const input = executorInput();
  input.sourceRevision = git(repositoryRoot, "rev-parse", "HEAD");
  input.task.changeScope = ["packages/app"];
  input.task.component = "packages/app/value.txt";
  const state = { calls: [], checkpoints: [], released: false, worktreeRef: undefined, toolInvocations: 0 };
  const worktrees = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot });
  const ports = {
    authority: {
      verify: async (_request, phase) => {
        state.calls.push(`authority:${phase}`);
        return { authorized: true, bindingDigest: input.authority.approvalBindingDigest };
      },
      ...overrides.authority
    },
    coordination: {
      acquire: async () => {
        state.calls.push("coordination:acquire");
        return { coordinationRef: "coordination:e2e", expiresAt: "2099-01-01T00:00:00.000Z" };
      },
      release: async () => {
        state.calls.push("coordination:release");
        state.released = true;
      }
    },
    worktrees,
    checkpoints: {
      load: async () => undefined,
      save: async (checkpoint) => {
        state.checkpoints.push(checkpoint);
        return { checkpointRef: `checkpoint:${checkpoint.stage}:${checkpoint.sequence}` };
      }
    },
    context: {
      compile: async (request) => {
        state.worktreeRef = request.worktreeRef;
        return { contextRef: "context:e2e", contextDigest: input.contextManifestDigest };
      }
    },
    tools: {
      invoke: async (request) => {
        state.toolInvocations += 1;
        const target = targetFor(worktreesRoot, request.worktreeRef);
        await writeFile(join(target, "packages", "app", "value.txt"), "implemented\n");
        return { receiptRef: "receipt:e2e", outputRef: "output:e2e" };
      }
    },
    driver: {
      execute: async (_request, control) => {
        await control.checkpoint("driver-progress", { turn: 1 });
        await control.invokeTool({
          requestId: "tool:e2e",
          taskId: input.task.taskId,
          capabilityGrantRef: input.authority.capabilityGrantRefs[0],
          operation: "write",
          targetPaths: ["packages/app/value.txt"],
          payloadRef: "payload:e2e"
        });
        return { status: "completed", outputRefs: ["output:driver:e2e"] };
      },
      cancel: async () => state.calls.push("driver:cancel"),
      ...overrides.driver
    }
  };
  return { coordinator: new TaskExecutionCoordinator(ports), input, ports, state, worktreesRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("authorized Driver and mediated Tool reach AWAITING_GATE in a real isolated worktree", async () => {
  const { coordinator, input, state } = await fixture();
  const result = await coordinator.execute(input);
  assert.equal(result.status, "AWAITING_GATE");
  assert.deepEqual(result.changedPaths, ["packages/app/value.txt"]);
  assert.equal(state.toolInvocations, 1);
  assert.deepEqual(state.calls.slice(0, 2), ["authority:start", "coordination:acquire"]);
  assert.equal(state.checkpoints.at(-1).stage, "awaiting-gate");
});

test("stale Approval at the Tool boundary performs no write and removes the real worktree", async () => {
  let checks = 0;
  const { coordinator, input, state, worktreesRoot } = await fixture({
    authority: {
      verify: async (_request, phase) => ({
        authorized: ++checks === 1,
        bindingDigest: phase === "start" ? input.authority.approvalBindingDigest : "sha256:" + "9".repeat(64)
      })
    }
  });
  await assert.rejects(coordinator.execute(input), { code: "VES_EXECUTOR_APPROVAL_INVALID" });
  assert.equal(state.toolInvocations, 0);
  assert.equal(state.released, true);
  await assert.rejects(access(targetFor(worktreesRoot, state.worktreeRef)));
});

test("cancelled Driver checkpoints releases ownership and removes the real worktree", async () => {
  const { coordinator, input, state, worktreesRoot } = await fixture({
    driver: { execute: async () => ({ status: "cancelled", outputRefs: [] }) }
  });
  await assert.rejects(coordinator.execute(input), { code: "VES_EXECUTOR_CANCELLED" });
  assert.equal(state.checkpoints.at(-1).stage, "cancelled");
  assert.equal(state.released, true);
  await assert.rejects(access(targetFor(worktreesRoot, state.worktreeRef)));
});

test("post-execution inspection catches a Driver bypass outside task scope", async () => {
  const { coordinator, input, state, worktreesRoot } = await fixture({
    driver: {
      execute: async () => {
        await writeFile(join(targetFor(worktreesRoot, state.worktreeRef), "outside.txt"), "bypass\n");
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await assert.rejects(coordinator.execute(input), { code: "VES_EXECUTOR_SCOPE_DENIED" });
  assert.equal(state.released, true);
  await assert.rejects(access(targetFor(worktreesRoot, state.worktreeRef)));
});
