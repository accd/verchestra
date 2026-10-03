import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { canonicalTaskGatePlan, TaskGateCommitCoordinator } from "../../packages/application/src/index.ts";
import {
  NodeAtomicGitCommitAdapter,
  NodeGateProcessRunner,
  NodeGitWorktreeAdapter
} from "../../packages/platform-node/src/index.ts";

const roots = [];
const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-gate-git-"));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  const worktreesRoot = join(root, "worktrees");
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await mkdir(join(repositoryRoot, "tests"), { recursive: true });
  await writeFile(join(repositoryRoot, "src", "value.txt"), "base\n");
  await writeFile(
    join(repositoryRoot, "tests", "pass.test.mjs"),
    'import test from "node:test"; import assert from "node:assert/strict"; test("pass",()=>assert.equal(1,1));\n'
  );
  await writeFile(join(repositoryRoot, "tests", "hang.mjs"), "setInterval(() => {}, 1000);\n");
  await writeFile(
    join(repositoryRoot, "tests", "tree-hang.mjs"),
    'import { spawn } from "node:child_process"; import { writeFileSync } from "node:fs"; const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" }); writeFileSync("tests/tree-child.pid", String(child.pid)); setInterval(() => {}, 1000);\n'
  );
  await writeFile(join(repositoryRoot, "tests", "overflow.mjs"), 'console.log("x".repeat(1000000));\n');
  git(repositoryRoot, "init", "--quiet");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "base");
  const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
  const worktrees = new NodeGitWorktreeAdapter({ repositoryRoot, worktreesRoot });
  const createInput = {
    workspaceId: "workspace:gate",
    runId: "run:gate",
    taskId: "T59.1",
    sourceStateDigest: sha("source"),
    sourceRevision: baseCommit,
    changeScope: ["src", "tests"],
    protectedPaths: [".git", ".verchestra/policy"]
  };
  const handle = await worktrees.create(createInput);
  const target = join(worktreesRoot, handle.worktreeRef.split(":")[1]);
  return { baseCommit, handle, repositoryRoot, root, target, worktrees, worktreesRoot };
}

function gateCommand(handle, overrides = {}) {
  return {
    gateId: "gate:test",
    requirementIds: ["VES-VFY-001"],
    declaredCommand: "node --test tests/pass.test.mjs",
    commandRef: "command:node-test",
    args: ["tests/pass.test.mjs"],
    cwd: ".",
    timeoutMs: 10_000,
    outputLimitBytes: 1_000_000,
    resultProtocol: "test-summary",
    minimumTests: 1,
    worktreeRef: handle.worktreeRef,
    ...overrides
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("real process runner parses a structured Node test summary", async () => {
  const { handle, repositoryRoot, worktreesRoot } = await fixture();
  const runner = new NodeGateProcessRunner({
    repositoryRoot,
    worktreesRoot,
    commands: {
      "command:node-test": { executable: process.execPath, fixedArgs: ["--test"], protocols: ["test-summary"] }
    }
  });
  const result = await runner.run(gateCommand(handle));
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.tests, { total: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0 });
  assert.match(result.outputRef, /^gate-output:[a-f0-9]{64}$/u);
});

test("real process runner terminates a timed-out process tree", async () => {
  const { handle, repositoryRoot, worktreesRoot } = await fixture();
  const runner = new NodeGateProcessRunner({
    repositoryRoot,
    worktreesRoot,
    commands: { "command:node": { executable: process.execPath, protocols: ["exit-code"] } }
  });
  const result = await runner.run(
    gateCommand(handle, {
      commandRef: "command:node",
      args: ["tests/hang.mjs"],
      resultProtocol: "exit-code",
      minimumTests: 0,
      timeoutMs: 100
    })
  );
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
});

test("real process runner terminates a timed-out descendant process", async (t) => {
  const { handle, repositoryRoot, target, worktreesRoot } = await fixture();
  const runner = new NodeGateProcessRunner({
    repositoryRoot,
    worktreesRoot,
    commands: { "command:node": { executable: process.execPath, protocols: ["exit-code"] } }
  });
  let descendantPid;
  t.after(() => {
    if (descendantPid === undefined) return;
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  });
  const result = await runner.run(
    gateCommand(handle, {
      commandRef: "command:node",
      args: ["tests/tree-hang.mjs"],
      resultProtocol: "exit-code",
      minimumTests: 0,
      timeoutMs: 1_000
    })
  );
  descendantPid = await readPid(join(target, "tests", "tree-child.pid"));
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.equal(isAlive(descendantPid), false);
});

test("real process runner kills output overflow without retaining raw logs", async () => {
  const { handle, repositoryRoot, worktreesRoot } = await fixture();
  const runner = new NodeGateProcessRunner({
    repositoryRoot,
    worktreesRoot,
    commands: { "command:node": { executable: process.execPath, protocols: ["exit-code"] } }
  });
  const result = await runner.run(
    gateCommand(handle, {
      commandRef: "command:node",
      args: ["tests/overflow.mjs"],
      resultProtocol: "exit-code",
      minimumTests: 0,
      outputLimitBytes: 64
    })
  );
  assert.equal(result.outputLimitExceeded, true);
  assert.equal("stdout" in result, false);
});

async function readPid(path) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const pid = Number.parseInt((await readFile(path, "utf8")).trim(), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed-out fixture did not report its descendant PID");
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

test("real Git adapter creates one trailer-bound commit and reconciles retry", async () => {
  const { baseCommit, handle, repositoryRoot, target, worktrees, worktreesRoot } = await fixture();
  await writeFile(join(target, "src", "value.txt"), "implemented\n");
  const inspection = await worktrees.inspect(handle);
  const adapter = new NodeAtomicGitCommitAdapter({ repositoryRoot, worktreesRoot });
  const request = {
    workspaceId: "workspace:gate",
    runId: "run:gate",
    taskId: "T59.1",
    requirementIds: ["VES-VFY-001", "VES-VFY-002"],
    worktreeRef: handle.worktreeRef,
    baseCommit,
    subject: "feat(execution): qualification commit",
    expectedChangedPaths: inspection.changedPaths,
    expectedChangeDigest: inspection.changeDigest,
    gatePlanDigest: sha("plan"),
    gateEvidenceDigest: sha("evidence"),
    gateEvidenceRefs: ["evidence:gate"],
    idempotencyKey: sha("idempotency")
  };
  const committed = await adapter.commitAtomic(request);
  const retried = await adapter.commitAtomic(request);
  assert.equal(committed.status, "committed");
  assert.equal(retried.status, "already-committed");
  assert.equal(retried.commitId, committed.commitId);
  assert.equal(git(target, "rev-list", "--count", `${baseCommit}..HEAD`), "1");
  assert.match(git(target, "show", "-s", "--format=%B", "HEAD"), /Verchestra-Idempotency-Key: sha256:/u);
});

test("real Git adapter rejects drift after gates before staging", async () => {
  const { baseCommit, handle, repositoryRoot, target, worktrees, worktreesRoot } = await fixture();
  await writeFile(join(target, "src", "value.txt"), "gate-reviewed\n");
  const inspection = await worktrees.inspect(handle);
  await writeFile(join(target, "src", "value.txt"), "drifted\n");
  const adapter = new NodeAtomicGitCommitAdapter({ repositoryRoot, worktreesRoot });
  await assert.rejects(
    adapter.commitAtomic({
      workspaceId: "workspace:gate",
      runId: "run:gate",
      taskId: "T59.1",
      requirementIds: ["VES-VFY-001"],
      worktreeRef: handle.worktreeRef,
      baseCommit,
      subject: "feat(execution): qualification commit",
      expectedChangedPaths: inspection.changedPaths,
      expectedChangeDigest: inspection.changeDigest,
      gatePlanDigest: sha("plan"),
      gateEvidenceDigest: sha("evidence"),
      gateEvidenceRefs: ["evidence:gate"],
      idempotencyKey: sha("idempotency")
    }),
    { code: "VES_GATE_GIT_DIFF_DRIFT" }
  );
  assert.equal(git(target, "rev-list", "--count", `${baseCommit}..HEAD`), "0");
});

test("full coordinator runs real test gate and creates exactly one real commit", async () => {
  const { baseCommit, handle, repositoryRoot, target, worktrees, worktreesRoot } = await fixture();
  await writeFile(join(target, "src", "value.txt"), "end-to-end\n");
  const inspection = await worktrees.inspect(handle);
  const material = { schemaVersion: 1, commands: [gateCommand(handle)] };
  delete material.commands[0].worktreeRef;
  const planDigest = sha(canonicalTaskGatePlan(material));
  const input = {
    schemaVersion: 1,
    workspaceId: "workspace:gate",
    runId: "run:gate",
    task: {
      taskId: "T59.1",
      requirementIds: ["VES-VFY-001"],
      verificationCommands: ["node --test tests/pass.test.mjs"],
      changeScope: ["src"],
      protectedPaths: [".git", ".verchestra/policy"],
      expectedCommitBoundary: "feat(execution): real gated commit"
    },
    execution: {
      worktreeRef: handle.worktreeRef,
      baseCommit,
      coordinationRef: "coordination:real",
      changeDigest: inspection.changeDigest,
      changedPaths: inspection.changedPaths,
      checkpointRef: "checkpoint:awaiting-gate"
    },
    authority: { approvalBindingDigest: sha("approval") },
    gatePlan: { ...material, planDigest }
  };
  const runner = new NodeGateProcessRunner({
    repositoryRoot,
    worktreesRoot,
    commands: {
      "command:node-test": { executable: process.execPath, fixedArgs: ["--test"], protocols: ["test-summary"] }
    }
  });
  const gitAdapter = new NodeAtomicGitCommitAdapter({ repositoryRoot, worktreesRoot });
  const checkpoints = [];
  let released = false;
  const coordinator = new TaskGateCommitCoordinator({
    digest: { sha256: sha },
    authority: {
      verify: async () => ({ authorized: true, bindingDigest: sha("approval"), gatePlanDigest: planDigest })
    },
    worktrees,
    gates: runner,
    evidence: {
      record: async (entry) => ({ evidenceRef: "evidence:real", evidenceDigest: sha(JSON.stringify(entry)) })
    },
    checkpoints: {
      load: async () => undefined,
      save: async (entry) => (checkpoints.push(entry), { checkpointRef: `checkpoint:${entry.stage}` })
    },
    git: gitAdapter,
    coordination: { verify: async () => ({ active: true }), release: async () => (released = true) }
  });
  const result = await coordinator.execute(input);
  assert.equal(result.status, "COMMITTED");
  assert.equal(released, true);
  assert.equal(checkpoints.at(-1).stage, "committed");
  assert.equal(git(repositoryRoot, "cat-file", "-t", result.commitId), "commit");
});
