import assert from "node:assert/strict";
import { test } from "node:test";

import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";

for (const [phase, overrides] of [
  [
    "coordination",
    {
      coordination: {
        acquire: async () => {
          throw new Error("injected coordination");
        }
      }
    }
  ],
  [
    "worktree",
    {
      worktrees: {
        create: async () => {
          throw new Error("injected worktree");
        }
      }
    }
  ],
  [
    "context",
    {
      context: {
        compile: async () => {
          throw new Error("injected context");
        }
      }
    }
  ],
  [
    "driver",
    {
      driver: {
        execute: async () => {
          throw new Error("injected driver");
        }
      }
    }
  ],
  [
    "inspect",
    {
      worktrees: {
        inspect: async () => {
          throw new Error("injected inspect");
        }
      }
    }
  ]
]) {
  test(`${phase} failure never leaves an active unauthorized worktree`, async () => {
    const { state, ports } = executorPorts(overrides);
    await assert.rejects(executor(ports).execute(executorInput()), new RegExp(`injected ${phase}`, "u"));
    if (phase !== "coordination" && phase !== "worktree") assert.equal(state.cleaned, true);
  });
}

test("Driver cancellation saves a checkpoint cleans worktree and releases writer", async () => {
  const { state, ports } = executorPorts({
    driver: { execute: async () => ({ status: "cancelled", outputRefs: [] }) }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_CANCELLED" });
  assert.equal(state.checkpoints.at(-1).stage, "cancelled");
  assert.equal(state.cleaned, true);
  assert.equal(state.released, true);
});

test("pre-aborted signal makes zero authority or filesystem calls", async () => {
  const controller = new AbortController();
  controller.abort();
  const { state, ports } = executorPorts();
  await assert.rejects(executor(ports).execute(executorInput(), { signal: controller.signal }), {
    code: "VES_EXECUTOR_CANCELLED"
  });
  assert.deepEqual(state.calls, []);
});

test("Tool failure saves failure checkpoint and rolls back", async () => {
  const { state, ports } = executorPorts({
    tools: {
      invoke: async () => {
        throw new Error("injected tool");
      }
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), /injected tool/u);
  assert.equal(state.checkpoints.at(-1).stage, "failed");
  assert.equal(state.cleaned, true);
});

test("checkpoint failure during progress fails closed", async () => {
  const { state, ports } = executorPorts({
    checkpoints: {
      save: async (entry) => {
        if (entry.stage === "driver-progress") throw new Error("injected checkpoint");
        return { checkpointRef: "checkpoint:ok" };
      }
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), /injected checkpoint/u);
  assert.equal(state.cleaned, true);
});

test("cleanup failure does not hide primary Driver failure", async () => {
  const { ports } = executorPorts({
    driver: {
      execute: async () => {
        throw new Error("primary driver failure");
      }
    },
    worktrees: {
      cleanup: async () => {
        throw new Error("cleanup failure");
      }
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), /primary driver failure/u);
});

test("release failure does not hide primary Driver failure", async () => {
  const { ports } = executorPorts({
    driver: {
      execute: async () => {
        throw new Error("primary driver failure");
      }
    },
    coordination: {
      release: async () => {
        throw new Error("release failure");
      }
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), /primary driver failure/u);
});
