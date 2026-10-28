import assert from "node:assert/strict";
import { test } from "node:test";

import { createBudgetMeter } from "../../packages/application/src/execution/budget-meter.ts";
import { modelPriceTable } from "../../packages/application/src/execution/model-price-table.ts";
import { TaskExecutionCoordinator, TaskExecutorError } from "../../packages/application/src/execution/task-executor.ts";

import { executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";

// Unit-level lifecycle of one task execution: resuming from a recovered
// checkpoint, metering usage against declared budgets, mediating tool calls,
// and the failure path that rolls everything back without masking the cause.

const executorError = (code) => (error) => error instanceof TaskExecutorError && error.code === code;
const BUDGETS = { maximumCostUsd: 1, maximumTokens: 1_000, maximumDurationMs: 600_000 };

const recovered = (overrides = {}) => ({
  checkpointRef: "checkpoint:recovered",
  workspaceId: executorInput().workspaceId,
  runId: executorInput().runId,
  taskId: executorInput().task.taskId,
  stage: "driver-progress",
  sequence: 4,
  data: { turn: 3 },
  ...overrides
});

test("a recovered checkpoint continues the sequence and is handed to Context and driver", async () => {
  const seen = {};
  const { state, ports } = executorPorts({
    checkpoints: {
      load: async () => recovered(),
      save: async (checkpoint) => {
        state.checkpoints.push(checkpoint);
        return { checkpointRef: `checkpoint:${checkpoint.sequence}` };
      }
    },
    context: {
      compile: async (request) => {
        seen.context = request.checkpoint;
        return { contextRef: "context:001", contextDigest: "sha256:" + "3".repeat(64) };
      }
    }
  });
  const result = await new TaskExecutionCoordinator(ports).execute(executorInput());
  assert.equal(result.status, "AWAITING_GATE");
  assert.equal(seen.context.checkpointRef, "checkpoint:recovered");
  assert.deepEqual(
    state.checkpoints.map((checkpoint) => [checkpoint.stage, checkpoint.sequence]),
    [
      ["driver-progress", 5],
      ["awaiting-gate", 6]
    ]
  );
});

for (const [label, overrides] of [
  ["another task", { taskId: "T99" }],
  ["another run", { runId: "run_018f0b6d-7b1a-7abc-8def-999999999999" }],
  ["another Workspace", { workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-999999999999" }],
  ["an unsafe stage", { stage: " stage" }],
  ["an unsafe checkpoint reference", { checkpointRef: "../checkpoint" }],
  ["a fractional sequence", { sequence: 1.5 }],
  ["a negative sequence", { sequence: -1 }]
]) {
  test(`a recovered checkpoint for ${label} fails closed before any claim`, async () => {
    const { state, ports } = executorPorts({ checkpoints: { load: async () => recovered(overrides) } });
    await assert.rejects(
      new TaskExecutionCoordinator(ports).execute(executorInput()),
      executorError("VES_EXECUTOR_INPUT_INVALID")
    );
    assert.deepEqual(state.calls, []);
  });
}

test("a recovered checkpoint without a reference is accepted", async () => {
  const withoutRef = recovered();
  delete withoutRef.checkpointRef;
  const { ports } = executorPorts({
    checkpoints: { load: async () => withoutRef, save: async () => ({ checkpointRef: "c:1" }) }
  });
  const result = await new TaskExecutionCoordinator(ports).execute(executorInput());
  assert.equal(result.status, "AWAITING_GATE");
});

test("a tool result without an output reference records only its receipt", async () => {
  const { ports } = executorPorts({ tools: { invoke: async () => ({ receiptRef: "receipt:tool:002" }) } });
  const result = await new TaskExecutionCoordinator(ports).execute(executorInput());
  assert.deepEqual(result.toolReceiptRefs, ["receipt:tool:002"]);
  assert.deepEqual(result.outputRefs, ["output:driver:001"]);
});

for (const [label, toolResult] of [
  ["an unsafe receipt", { receiptRef: "receipt with space" }],
  ["an unsafe output reference", { receiptRef: "receipt:tool:001", outputRef: "../output" }]
]) {
  test(`a tool result with ${label} fails the run and rolls it back`, async () => {
    const { state, ports } = executorPorts({ tools: { invoke: async () => toolResult } });
    await assert.rejects(
      new TaskExecutionCoordinator(ports).execute(executorInput()),
      executorError("VES_EXECUTOR_TOOL_INVALID")
    );
    assert.deepEqual(state.calls.slice(-4), ["driver:cancel", "checkpoint:failed", "worktree:cleanup", "release"]);
    assert.equal(state.checkpoints.at(-1).data.errorCode, "VES_EXECUTOR_TOOL_INVALID");
  });
}

test("rollback steps that fail never replace the original failure, and the claim is still released", async () => {
  const { state, ports } = executorPorts({
    driver: {
      execute: async () => ({ status: "failed", outputRefs: [] }),
      cancel: async () => {
        throw new Error("driver cancel failed");
      }
    },
    worktrees: {
      cleanup: async () => {
        throw new Error("cleanup failed");
      }
    }
  });
  ports.checkpoints.save = async (checkpoint) => {
    state.calls.push(`checkpoint:${checkpoint.stage}`);
    throw new Error("checkpoint store unavailable");
  };
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute(executorInput()),
    executorError("VES_EXECUTOR_DRIVER_FAILED")
  );
  assert.deepEqual(state.calls.slice(-2), ["checkpoint:failed", "release"]);
  assert.equal(state.released, true);
});

test("a cancelled run records a cancelled checkpoint with the cancel code", async () => {
  const { state, ports } = executorPorts({
    driver: { execute: async () => ({ status: "cancelled", outputRefs: [] }) }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute(executorInput()),
    executorError("VES_EXECUTOR_CANCELLED")
  );
  assert.deepEqual(
    [state.checkpoints.at(-1).stage, state.checkpoints.at(-1).data],
    ["cancelled", { errorCode: "VES_EXECUTOR_CANCELLED", requirementIds: executorInput().task.requirementIds }]
  );
});

test("an error that is not an executor error is checkpointed as a driver failure and rethrown as is", async () => {
  const failure = new Error("driver crashed");
  const { state, ports } = executorPorts({
    driver: {
      execute: async () => {
        throw failure;
      }
    }
  });
  await assert.rejects(new TaskExecutionCoordinator(ports).execute(executorInput()), (error) => error === failure);
  assert.equal(state.checkpoints.at(-1).stage, "failed");
  assert.equal(state.checkpoints.at(-1).data.errorCode, "VES_EXECUTOR_DRIVER_FAILED");
});

test("a worktree refused before the driver starts is cleaned up without cancelling a driver", async () => {
  const { state, ports } = executorPorts({
    worktrees: {
      create: async () => {
        state.calls.push("worktree:create");
        return { worktreeRef: "worktree:001", baseCommit: "not-a-commit" };
      }
    }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute(executorInput()),
    executorError("VES_EXECUTOR_WORKTREE_INVALID")
  );
  assert.deepEqual(state.calls, [
    "authority:start",
    "acquire:team",
    "worktree:create",
    "checkpoint:failed",
    "worktree:cleanup",
    "release"
  ]);
});

test("a refused writer coordination leaves nothing to clean up or release", async () => {
  const { state, ports } = executorPorts({
    coordination: {
      acquire: async () => {
        state.calls.push("acquire");
        return { coordinationRef: "coordination:001", expiresAt: "not-a-time" };
      }
    }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute(executorInput()),
    executorError("VES_EXECUTOR_COORDINATION_INVALID")
  );
  assert.deepEqual(state.calls, ["authority:start", "acquire"]);
});

test("a compiled Context for another manifest is refused after the worktree exists", async () => {
  const { state, ports } = executorPorts({
    context: { compile: async () => ({ contextRef: "context:001", contextDigest: "sha256:" + "9".repeat(64) }) }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute(executorInput()),
    executorError("VES_EXECUTOR_CONTEXT_INVALID")
  );
  assert.equal(state.calls.includes("driver:cancel"), false);
  assert.equal(state.cleaned, true);
});

test("usage past a declared ceiling stops the run as a budget outcome, not a cancellation", async () => {
  const { state, ports } = executorPorts({
    driver: {
      execute: async (_request, control) => {
        control.reportUsage({ model: "claude-sonnet-5", inputTokens: 10, outputTokens: 10 });
        control.reportUsage({ model: "claude-sonnet-5", inputTokens: 5_000, outputTokens: 0 });
        control.reportUsage({ model: "claude-sonnet-5", inputTokens: 5_000, outputTokens: 0 });
        return { status: "cancelled", outputRefs: [] };
      },
      cancel: async () => state.calls.push("driver:cancel")
    }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute({ ...executorInput(), budgets: BUDGETS }),
    executorError("VES_EXECUTOR_BUDGET_EXCEEDED")
  );
  assert.equal(state.checkpoints.filter((checkpoint) => checkpoint.stage === "budget-exceeded").length, 1);
});

test("usage of an unpriced model stops the run with the meter's own failure", async () => {
  const { ports } = executorPorts({
    driver: {
      execute: async (_request, control) => {
        control.reportUsage({ model: "model-nobody-priced", inputTokens: 1, outputTokens: 1 });
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute({ ...executorInput(), budgets: BUDGETS }),
    (error) => error.code === "VES_BUDGET_MODEL_UNKNOWN"
  );
});

test("usage reported without declared budgets is inert", async () => {
  const { ports } = executorPorts({
    driver: {
      execute: async (_request, control) => {
        control.reportUsage({ model: "model-nobody-priced", inputTokens: 1, outputTokens: 1 });
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  const result = await new TaskExecutionCoordinator(ports).execute(executorInput());
  assert.equal(result.status, "AWAITING_GATE");
});

test("a supplied meter that is already exhausted stops before the driver starts", async () => {
  const meter = createBudgetMeter({ budgets: BUDGETS, priceTable: modelPriceTable });
  meter.recordUsage({ model: "claude-sonnet-5", inputTokens: 2_000, outputTokens: 0 });
  const { state, ports } = executorPorts();
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute(executorInput(), { budgetMeter: meter }),
    executorError("VES_EXECUTOR_BUDGET_EXCEEDED")
  );
  assert.equal(state.calls.includes("driver"), false);
  assert.equal(state.checkpoints[0].stage, "budget-exceeded");
  assert.equal(state.checkpoints[0].data.reason, "token-threshold");
});

test("a driver that outlives its duration ceiling is cancelled and the run ends as a budget outcome", async () => {
  let cancelled;
  const stopped = new Promise((resolve) => {
    cancelled = resolve;
  });
  const { state, ports } = executorPorts({
    driver: {
      execute: async () => {
        await stopped;
        return { status: "cancelled", outputRefs: [] };
      },
      cancel: async () => {
        state.calls.push("driver:cancel");
        cancelled();
      }
    }
  });
  await assert.rejects(
    new TaskExecutionCoordinator(ports).execute({ ...executorInput(), budgets: { ...BUDGETS, maximumDurationMs: 5 } }),
    (error) => executorError("VES_EXECUTOR_BUDGET_EXCEEDED")(error) && /duration/u.test(error.message)
  );
  assert.deepEqual(
    state.checkpoints.map((checkpoint) => checkpoint.stage),
    ["budget-exceeded", "failed"]
  );
  assert.equal(state.checkpoints[0].data.reason, "duration-threshold");
});
