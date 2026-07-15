import assert from "node:assert/strict";
import { test } from "node:test";

import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";

test("authorized task executes in one isolated worktree and waits for its gate", async () => {
  const { state, ports } = executorPorts();
  const result = await executor(ports).execute(executorInput());
  assert.equal(result.status, "AWAITING_GATE");
  assert.equal(result.worktreeRef, "worktree:001");
  assert.equal(state.cleaned, false);
  assert.equal(state.released, false);
});

test("authority and coordination precede the first worktree mutation", async () => {
  const { state, ports } = executorPorts();
  await executor(ports).execute(executorInput());
  assert.deepEqual(state.calls.slice(0, 3), ["authority:start", "acquire:team", "worktree:create"]);
});

test("Personal Mode still acquires local single-writer coordination", async () => {
  const { state, ports } = executorPorts();
  await executor(ports).execute({ ...executorInput(), mode: "personal" });
  assert.equal(state.calls.includes("acquire:personal"), true);
});

test("driver receives only logical worktree Context and task authority", async () => {
  let observed;
  const { ports } = executorPorts({
    driver: {
      execute: async (request) => {
        observed = request;
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await executor(ports).execute(executorInput());
  assert.equal(observed.worktreeRef, "worktree:001");
  assert.equal("worktreePath" in observed, false);
  assert.deepEqual(observed.capabilityGrantRefs, ["grant:writer:001"]);
});

test("resumable checkpoint is supplied to Context and Driver", async () => {
  let contextCheckpoint;
  let driverCheckpoint;
  const recovered = {
    checkpointRef: "checkpoint:old",
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-512345678901",
    runId: "run_018f0b6d-7b1a-7abc-8def-612345678901",
    taskId: "T58.1",
    stage: "driver-progress",
    sequence: 2,
    data: { turn: 2 }
  };
  const { ports } = executorPorts({
    checkpoints: { load: async () => recovered },
    context: {
      compile: async (request) => {
        contextCheckpoint = request.checkpoint;
        return { contextRef: "context:001", contextDigest: "sha256:" + "3".repeat(64) };
      }
    },
    driver: {
      execute: async (request) => {
        driverCheckpoint = request.checkpoint;
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await executor(ports).execute(executorInput());
  assert.deepEqual(contextCheckpoint, recovered);
  assert.deepEqual(driverCheckpoint, recovered);
});

test("driver checkpoints are durably sequenced", async () => {
  const { state, ports } = executorPorts({
    driver: {
      execute: async (_request, control) => {
        await control.checkpoint("analysis", { n: 1 });
        await control.checkpoint("editing", { n: 2 });
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await executor(ports).execute(executorInput());
  const progress = state.checkpoints.filter((entry) => ["analysis", "editing"].includes(entry.stage));
  assert.deepEqual(
    progress.map((entry) => entry.sequence),
    [1, 2]
  );
});

test("tool receipt and Driver outputs survive into execution evidence", async () => {
  const { ports } = executorPorts();
  const result = await executor(ports).execute(executorInput());
  assert.deepEqual(result.toolReceiptRefs, ["receipt:tool:001"]);
  assert.deepEqual(result.outputRefs, ["output:driver:001", "output:tool:001"]);
});

test("zero-change implementation remains non-complete and gate-bound", async () => {
  const { ports } = executorPorts({
    worktrees: {
      inspect: async () => ({ changedPaths: [], changeDigest: "sha256:" + "0".repeat(64), commitCountSinceBase: 0 })
    }
  });
  const result = await executor(ports).execute(executorInput());
  assert.equal(result.status, "AWAITING_GATE");
  assert.deepEqual(result.changedPaths, []);
});

test("result binds every atomic task requirement", async () => {
  const { ports } = executorPorts();
  const result = await executor(ports).execute(executorInput());
  assert.deepEqual(result.requirementIds, ["VES-EXE-001", "VES-VFY-001"]);
  assert.equal(result.taskId, "T58.1");
});

test("tool requests are bound to exact task and capability", async () => {
  const { state, ports } = executorPorts();
  await executor(ports).execute(executorInput());
  assert.equal(state.toolRequests[0].taskId, "T58.1");
  assert.equal(state.toolRequests[0].capabilityGrantRef, "grant:writer:001");
});
