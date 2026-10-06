import assert from "node:assert/strict";
import { test } from "node:test";

import { executor, executorInput, executorPorts } from "../helpers/task-executor-fixture.mjs";

test("invalid Execution Approval blocks before coordination and worktree", async () => {
  const { state, ports } = executorPorts({ authority: { verify: async () => ({ authorized: false }) } });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_APPROVAL_INVALID" });
  assert.equal(
    state.calls.some((entry) => entry.startsWith("acquire")),
    false
  );
});

test("stale Approval before Tool effect blocks invocation and rolls back", async () => {
  let count = 0;
  const { state, ports } = executorPorts({
    authority: { verify: async () => ({ authorized: ++count === 1, bindingDigest: "sha256:" + "4".repeat(64) }) }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_APPROVAL_INVALID" });
  assert.equal(state.toolRequests.length, 0);
  assert.equal(state.cleaned, true);
});

for (const path of ["../outside", "packages/other/file.ts"]) {
  test(`Tool target outside declared scope is denied: ${path}`, async () => {
    const { state, ports } = executorPorts({
      driver: {
        execute: async (_request, control) => {
          await control.invokeTool({
            requestId: "tool:bad",
            taskId: "T58.1",
            capabilityGrantRef: "grant:writer:001",
            operation: "write",
            targetPaths: [path],
            payloadRef: "payload:bad"
          });
          return { status: "completed", outputRefs: [] };
        }
      }
    });
    await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_SCOPE_DENIED" });
    assert.equal(state.toolRequests.length, 0);
  });
}

for (const path of [".verchestra/policy/builtin.cedar"]) {
  test(`protected target is denied: ${path}`, async () => {
    const input = executorInput();
    input.task.changeScope.push(path);
    const { ports } = executorPorts({
      driver: {
        execute: async (_request, control) => {
          await control.invokeTool({
            requestId: "tool:bad",
            taskId: "T58.1",
            capabilityGrantRef: "grant:writer:001",
            operation: "write",
            targetPaths: [path],
            payloadRef: "payload:bad"
          });
          return { status: "completed", outputRefs: [] };
        }
      }
    });
    await assert.rejects(executor(ports).execute(input), { code: "VES_EXECUTOR_PROTECTED_PATH" });
  });
}

test("undeclared capability grant is denied", async () => {
  const { ports } = executorPorts({
    driver: {
      execute: async (_request, control) => {
        await control.invokeTool({
          requestId: "tool:bad",
          taskId: "T58.1",
          capabilityGrantRef: "grant:admin",
          operation: "write",
          targetPaths: ["packages/application/src/execution/file.ts"],
          payloadRef: "payload:bad"
        });
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_CAPABILITY_DENIED" });
});

test("cross-task Tool request is denied", async () => {
  const { ports } = executorPorts({
    driver: {
      execute: async (_request, control) => {
        await control.invokeTool({
          requestId: "tool:bad",
          taskId: "T99",
          capabilityGrantRef: "grant:writer:001",
          operation: "write",
          targetPaths: ["packages/application/src/execution/file.ts"],
          payloadRef: "payload:bad"
        });
        return { status: "completed", outputRefs: [] };
      }
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_TASK_MISMATCH" });
});

test("Driver-created commit is forbidden before the declared gate", async () => {
  const { state, ports } = executorPorts({
    worktrees: {
      inspect: async () => ({ changedPaths: [], changeDigest: "sha256:" + "5".repeat(64), commitCountSinceBase: 1 })
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_COMMIT_FORBIDDEN" });
  assert.equal(state.cleaned, true);
});

test("malformed Driver output references fail closed and trigger rollback", async () => {
  const { state, ports } = executorPorts({
    driver: { execute: async () => ({ status: "completed", outputRefs: ["output with covert text"] }) }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_DRIVER_FAILED" });
  assert.equal(state.cleaned, true);
  assert.equal(state.released, true);
});

// invariant: a failed driver session hands on the stable code it reported, and
// only that: the executor's own code stays, and the run records the driver's.
test("a failed Driver result carries its stable cause, and refuses one that is no stable code", async () => {
  const named = executorPorts({
    driver: { execute: async () => ({ status: "failed", outputRefs: [], reason: "VES_CODEX_MODEL_UNAVAILABLE" }) }
  });
  await assert.rejects(executor(named.ports).execute(executorInput()), (error) => {
    assert.equal(error.code, "VES_EXECUTOR_DRIVER_FAILED");
    assert.equal(error.reason, "VES_CODEX_MODEL_UNAVAILABLE");
    return true;
  });
  assert.equal(named.state.cleaned, true);
  const unnamed = executorPorts({ driver: { execute: async () => ({ status: "failed", outputRefs: [] }) } });
  await assert.rejects(executor(unnamed.ports).execute(executorInput()), (error) => {
    assert.equal(error.code, "VES_EXECUTOR_DRIVER_FAILED");
    assert.equal(error.reason, undefined);
    return true;
  });
  for (const reason of ["model /private/path is gone", "VES_lower", "", 7]) {
    const refused = executorPorts({ driver: { execute: async () => ({ status: "failed", outputRefs: [], reason }) } });
    await assert.rejects(executor(refused.ports).execute(executorInput()), (error) => {
      assert.equal(error.code, "VES_EXECUTOR_DRIVER_FAILED");
      assert.equal(error.reason, undefined, `reason ${JSON.stringify(reason)}`);
      return true;
    });
    assert.equal(refused.state.cleaned, true);
  }
});

test("invalid negative Git commit count fails closed and triggers rollback", async () => {
  const { state, ports } = executorPorts({
    worktrees: {
      inspect: async () => ({
        changedPaths: [],
        changeDigest: "sha256:" + "5".repeat(64),
        commitCountSinceBase: -1
      })
    }
  });
  await assert.rejects(executor(ports).execute(executorInput()), { code: "VES_EXECUTOR_WORKTREE_INVALID" });
  assert.equal(state.cleaned, true);
});

for (const path of ["../escaped.ts", ".git/config", "packages/other/file.ts"]) {
  test(`post-execution changed path is independently denied: ${path}`, async () => {
    const { state, ports } = executorPorts({
      worktrees: {
        inspect: async () => ({
          changedPaths: [path],
          changeDigest: "sha256:" + "5".repeat(64),
          commitCountSinceBase: 0
        })
      }
    });
    await assert.rejects(executor(ports).execute(executorInput()), {
      code: /VES_EXECUTOR_(?:SCOPE_DENIED|PROTECTED_PATH)/u
    });
    assert.equal(state.cleaned, true);
  });
}

for (const field of ["requirementIds", "verificationCommands", "doneCriteria", "changeScope", "protectedPaths"]) {
  test(`atomic task rejects empty ${field}`, async () => {
    const input = executorInput();
    input.task[field] = [];
    const { ports } = executorPorts();
    await assert.rejects(executor(ports).execute(input), { code: "VES_EXECUTOR_TASK_INVALID" });
  });
}
