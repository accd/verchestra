// invariant: a target that differs from a protected path only by letter case
// or by spelling names the same file on a case-insensitive volume, the macOS
// default. Driven through the real relay, MCP bridge, executor, worktree tool,
// Git inspection, and gate over a real repository, no such target may land on
// a protected path or reach a commit, and a case variant of a scope entry is
// never admitted in its place.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../packages/agent-runtime/src/index.ts";
import {
  TaskExecutionCoordinator,
  TaskGateCommitCoordinator,
  canonicalTaskGatePlan
} from "../../packages/application/src/index.ts";
import {
  NodeAtomicGitCommitAdapter,
  NodeGitWorktreeAdapter,
  NodeWorktreeToolAdapter,
  RuntimeStore
} from "../../packages/platform-node/src/index.ts";
import { cleanupBridges, startRelay } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST, mediationRefusedOnWin32 } from "../helpers/mediation-platform.mjs";
import { systemGit } from "../helpers/system-git.mjs";

const roots = [];
const stores = [];

afterEach(async () => {
  await cleanupBridges();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
});

const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const LOCKED = '{"locked":true}\n';

function git(cwd, ...args) {
  return execFileSync(systemGit(), args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

const GATE_COMMAND = {
  gateId: "gate:check",
  requirementIds: ["VES-EXE-001"],
  declaredCommand: "node --test",
  commandRef: "command:node",
  args: [],
  cwd: ".",
  timeoutMs: 60_000,
  outputLimitBytes: 1_000_000,
  resultProtocol: "exit-code",
  minimumTests: 0
};
const GATE_PLAN_MATERIAL = { schemaVersion: 1, commands: [GATE_COMMAND] };
const GATE_PLAN = { ...GATE_PLAN_MATERIAL, planDigest: sha(canonicalTaskGatePlan(GATE_PLAN_MATERIAL)) };

// why: `src/Generated` is absent at the base revision, so a case variant of it
// is created rather than refused by the tool adapter's parent walk; and
// `src/vendor/` is a protected entry spelled with a trailing separator.
const TASK = Object.freeze({
  taskId: "T1.case",
  requirementIds: ["VES-EXE-001"],
  dependencyTaskIds: [],
  component: "src",
  changeScope: ["src", "cli.js"],
  protectedPaths: [".git", ".verchestra", "src/protected", "src/locked.json", "src/Generated", "src/vendor/"],
  verificationCommands: ["node --test"],
  doneCriteria: ["the value is implemented"],
  risk: "low",
  expectedCommitBoundary: "feat(src): implement the value"
});

async function repository() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-case-variant-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const worktreesRoot = join(root, "worktrees");
  await mkdir(join(repositoryRoot, "src", "protected"), { recursive: true });
  await mkdir(join(repositoryRoot, "src", "vendor"), { recursive: true });
  await writeFile(join(repositoryRoot, "src", "value.txt"), "base\n");
  await writeFile(join(repositoryRoot, "src", "locked.json"), LOCKED);
  await writeFile(join(repositoryRoot, "src", "protected", "config.json"), LOCKED);
  await writeFile(join(repositoryRoot, "src", "vendor", "lib.js"), "vendored\n");
  await writeFile(join(repositoryRoot, "cli.js"), "base\n");
  git(repositoryRoot, "init", "--quiet");
  git(repositoryRoot, "config", "core.autocrlf", "false");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "base");
  const store = new RuntimeStore({ dbPath: join(root, "state", "runtime.sqlite"), timeoutMs: 10 });
  store.open();
  stores.push(store);
  return {
    root,
    repositoryRoot,
    worktreesRoot,
    store,
    baseCommit: git(repositoryRoot, "rev-parse", "HEAD"),
    worktrees: new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot })
  };
}

function executionInput(fixture) {
  return {
    schemaVersion: 1,
    workspaceId: "workspace_case",
    runId: "run_case",
    executionPackageDigest: `sha256:${"1".repeat(64)}`,
    sourceStateDigest: `sha256:${"2".repeat(64)}`,
    sourceRevision: fixture.baseCommit,
    contextManifestDigest: `sha256:${"3".repeat(64)}`,
    mode: "personal",
    task: structuredClone(TASK),
    authority: {
      approvalRef: "approval:execution:case",
      approvalBindingDigest: `sha256:${"4".repeat(64)}`,
      capabilityGrantRefs: ["grant:writer:case"]
    }
  };
}

function executor(fixture, input, driver, payloads = new InMemoryExecutionPayloadStore()) {
  return new TaskExecutionCoordinator({
    authority: { verify: async () => ({ authorized: true, bindingDigest: input.authority.approvalBindingDigest }) },
    coordination: {
      acquire: async () => ({ coordinationRef: "coordination:case", expiresAt: "2099-01-01T00:00:00.000Z" }),
      release: async () => undefined
    },
    worktrees: fixture.worktrees,
    checkpoints: {
      load: async () => undefined,
      save: async (checkpoint) => ({ checkpointRef: `checkpoint:${checkpoint.stage}:${checkpoint.sequence}` })
    },
    context: { compile: async () => ({ contextRef: "context:case", contextDigest: input.contextManifestDigest }) },
    // why: the composition root's own configuration (apps/vestra-cli task-run.ts).
    tools: new NodeWorktreeToolAdapter({
      workspaceId: input.workspaceId,
      worktrees: fixture.worktrees,
      receipts: fixture.store.createEffectRepository(),
      payloads,
      protectedRoots: [".verchestra"]
    }),
    driver: { execute: driver, cancel: async () => undefined }
  });
}

async function commitThroughGate(fixture, input, execution) {
  const gate = new TaskGateCommitCoordinator({
    digest: { sha256: sha },
    authority: {
      verify: async () => ({
        authorized: true,
        bindingDigest: input.authority.approvalBindingDigest,
        gatePlanDigest: GATE_PLAN.planDigest
      })
    },
    worktrees: fixture.worktrees,
    gates: {
      run: async () => ({
        exitCode: 0,
        timedOut: false,
        outputLimitExceeded: false,
        stdoutDigest: sha("stdout"),
        stderrDigest: sha(""),
        stdoutBytes: 6,
        stderrBytes: 0,
        outputRef: "output:case"
      })
    },
    evidence: { record: async (entry) => ({ evidenceRef: "evidence:case", evidenceDigest: sha(entry.gateId) }) },
    checkpoints: {
      load: async () => undefined,
      save: async (entry) => ({ checkpointRef: `checkpoint:${entry.stage}` })
    },
    git: new NodeAtomicGitCommitAdapter({
      repositoryRoot: fixture.repositoryRoot,
      worktreesRoot: fixture.worktreesRoot
    }),
    coordination: { verify: async () => ({ active: true }), release: async () => undefined }
  });
  const result = await gate.execute({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    runId: input.runId,
    task: {
      taskId: input.task.taskId,
      requirementIds: input.task.requirementIds,
      verificationCommands: input.task.verificationCommands,
      changeScope: input.task.changeScope,
      protectedPaths: input.task.protectedPaths,
      expectedCommitBoundary: input.task.expectedCommitBoundary
    },
    execution: {
      worktreeRef: execution.worktreeRef,
      baseCommit: execution.baseCommit,
      coordinationRef: execution.coordinationRef,
      changeDigest: execution.changeDigest,
      changedPaths: execution.changedPaths,
      checkpointRef: execution.checkpointRef
    },
    authority: { approvalBindingDigest: input.authority.approvalBindingDigest },
    gatePlan: GATE_PLAN
  });
  return git(fixture.repositoryRoot, "diff", "--name-only", fixture.baseCommit, result.commitId).split("\n");
}

const text = (result) => result.content.map((entry) => entry.text).join("");

// why: one journey per target, so a target that fails the run cannot hide the
// outcome of another; the in-scope write proves the run still commits.
async function bridgeJourney(target) {
  const fixture = await repository();
  const input = executionInput(fixture);
  const payloads = new InMemoryExecutionPayloadStore();
  const answers = [];
  const coordinator = executor(
    fixture,
    input,
    async (request, control) => {
      const controller = await McpToolBridgeController.open({
        worktreePath: await fixture.worktrees.resolvePath(request.worktreeRef),
        readScope: request.task.changeScope,
        protectedPaths: request.task.protectedPaths,
        taskId: request.task.taskId,
        capabilityGrantRef: request.capabilityGrantRefs[0],
        payloads,
        invokeTool: control.invokeTool
      });
      try {
        const relay = startRelay(controller.environment);
        await relay.initialize();
        for (const path of [target, "src/value.txt"])
          answers.push(text(await relay.call("write_file", { path, content: `written to ${path}\n` })));
        await relay.close();
      } finally {
        await controller.close();
      }
      return { status: "completed", outputRefs: [] };
    },
    payloads
  );
  let outcome;
  try {
    outcome = { committed: await commitThroughGate(fixture, input, await coordinator.execute(input)) };
  } catch (error) {
    outcome = { failed: error.code };
  }
  return { answer: answers[0], ...outcome, fixture };
}

for (const [target, refusal] of [
  ["src/Protected/config.json", "denied: VES_EXECUTOR_PROTECTED_PATH"],
  ["src/LOCKED.json", "denied: VES_EXECUTOR_PROTECTED_PATH"],
  ["src/generated/out.js", "denied: VES_EXECUTOR_PROTECTED_PATH"],
  ["src/vendor/lib.js", "denied: VES_EXECUTOR_PROTECTED_PATH"],
  [".VERCHESTRA/x", "denied: VES_EXECUTOR_PROTECTED_PATH"],
  [".GIT/config", "denied: VES_BRIDGE_PATH_PROTECTED"],
  [".Git/HEAD", "denied: VES_BRIDGE_PATH_PROTECTED"],
  ["CLI.js", "denied: VES_EXECUTOR_SCOPE_DENIED"]
]) {
  test(`a write to ${JSON.stringify(target)} is refused before any effect and never committed`, async (t) => {
    if (WIN32_HOST) return mediationRefusedOnWin32(t);
    const { answer, committed, failed, fixture } = await bridgeJourney(target);
    assert.deepEqual(
      { answer, committed, failed },
      { answer: refusal, committed: ["src/value.txt"], failed: undefined }
    );
    const base = (path) => git(fixture.repositoryRoot, "show", `HEAD:${path}`);
    assert.equal(`${base("src/locked.json")}\n`, LOCKED);
    assert.equal(`${base("src/protected/config.json")}\n`, LOCKED);
    assert.equal(git(fixture.repositoryRoot, "status", "--porcelain=v1", "--untracked-files=all"), "");
  });
}

// why: a change can reach the worktree without a tool request, as a provider
// writing on its own would leave it; the executor's inspection and the gate
// must each refuse it without relying on an earlier stage.
for (const path of ["src/generated/out.js", "src/vendor/lib.js", "src/LOCKED.json"]) {
  test(`a change to ${JSON.stringify(path)} found by inspection is refused by the executor`, async () => {
    const fixture = await repository();
    const input = executionInput(fixture);
    const coordinator = executor(fixture, input, async (request) => {
      const worktree = await fixture.worktrees.resolvePath(request.worktreeRef);
      await mkdir(join(worktree, ...path.split("/").slice(0, -1)), { recursive: true });
      await writeFile(join(worktree, ...path.split("/")), "written outside the bridge\n");
      return { status: "completed", outputRefs: [] };
    });
    await assert.rejects(coordinator.execute(input), { code: "VES_EXECUTOR_PROTECTED_PATH" });
  });

  test(`a change to ${JSON.stringify(path)} in the worktree is refused by the gate`, async () => {
    const fixture = await repository();
    const input = executionInput(fixture);
    const handle = await fixture.worktrees.create({
      workspaceId: input.workspaceId,
      runId: input.runId,
      taskId: input.task.taskId,
      sourceStateDigest: input.sourceStateDigest,
      sourceRevision: input.sourceRevision,
      changeScope: input.task.changeScope,
      protectedPaths: input.task.protectedPaths
    });
    const worktree = await fixture.worktrees.resolvePath(handle.worktreeRef);
    await mkdir(join(worktree, ...path.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(worktree, ...path.split("/")), "written outside the bridge\n");
    const inspection = await fixture.worktrees.inspect(handle);
    const execution = {
      ...handle,
      coordinationRef: "coordination:case",
      changeDigest: inspection.changeDigest,
      changedPaths: inspection.changedPaths,
      checkpointRef: "checkpoint:awaiting-gate"
    };
    await assert.rejects(commitThroughGate(fixture, input, execution), { code: "VES_GATE_PROTECTED_PATH" });
  });
}
