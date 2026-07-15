import assert from "node:assert/strict";
import { test } from "node:test";

import { coordinator, digest, gateInput, gatePorts } from "../helpers/gate-commit-fixture.mjs";

const passing = (tests) => ({
  exitCode: 0,
  timedOut: false,
  outputLimitExceeded: false,
  stdoutDigest: digest("stdout"),
  stderrDigest: digest(""),
  stdoutBytes: 10,
  stderrBytes: 0,
  outputRef: "output:test",
  ...(tests ? { tests } : {})
});

for (const [name, mutation] of [
  ["non-zero exit", (result) => ({ ...result, exitCode: 1 })],
  ["timeout", (result) => ({ ...result, timedOut: true })],
  ["output overflow", (result) => ({ ...result, outputLimitExceeded: true })],
  [
    "failed test",
    (result) => ({ ...result, tests: { total: 30, passed: 29, failed: 1, skipped: 0, cancelled: 0, todo: 0 } })
  ],
  [
    "skipped test",
    (result) => ({ ...result, tests: { total: 30, passed: 29, failed: 0, skipped: 1, cancelled: 0, todo: 0 } })
  ],
  [
    "cancelled test",
    (result) => ({ ...result, tests: { total: 30, passed: 29, failed: 0, skipped: 0, cancelled: 1, todo: 0 } })
  ],
  [
    "todo test",
    (result) => ({ ...result, tests: { total: 30, passed: 29, failed: 0, skipped: 0, cancelled: 0, todo: 1 } })
  ],
  [
    "decreased test count",
    (result) => ({ ...result, tests: { total: 29, passed: 29, failed: 0, skipped: 0, cancelled: 0, todo: 0 } })
  ],
  [
    "inconsistent test total",
    (result) => ({ ...result, tests: { total: 31, passed: 30, failed: 0, skipped: 0, cancelled: 0, todo: 0 } })
  ]
]) {
  test(`${name} records failure evidence but creates no commit`, async () => {
    const { state, ports } = gatePorts({
      gates: {
        run: async (command) =>
          command.resultProtocol === "test-summary"
            ? mutation(passing({ total: 30, passed: 30, failed: 0, skipped: 0, cancelled: 0, todo: 0 }))
            : passing()
      }
    });
    const result = await coordinator(ports).execute(gateInput());
    assert.equal(result.status, "GATE_FAILED");
    assert.equal(state.commits.length, 0);
    assert.equal(state.cleaned, false);
    assert.equal(state.released, false);
    assert.equal(state.checkpoints.at(-1).stage, "gate-failed");
  });
}

test("pre-gate diff drift blocks every command and commit", async () => {
  const { state, ports } = gatePorts({
    worktrees: {
      inspect: async () => ({
        changedPaths: ["packages/application/src/execution/other.ts"],
        changeDigest: digest("drift"),
        commitCountSinceBase: 0
      })
    }
  });
  await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_DIFF_DRIFT" });
  assert.equal(state.gateRuns, 0);
  assert.equal(state.commits.length, 0);
});

test("post-gate diff drift blocks commit", async () => {
  let inspections = 0;
  const { state, ports } = gatePorts({
    worktrees: {
      inspect: async () =>
        ++inspections === 1
          ? {
              changedPaths: ["packages/application/src/execution/gate-commit.ts"],
              changeDigest: "sha256:" + "5".repeat(64),
              commitCountSinceBase: 0
            }
          : {
              changedPaths: ["packages/application/src/execution/gate-commit.ts"],
              changeDigest: digest("changed by gate"),
              commitCountSinceBase: 0
            }
    }
  });
  await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_DIFF_DRIFT" });
  assert.equal(state.commits.length, 0);
});

for (const phase of ["pre", "post"]) {
  test(`${phase}-gate protected diff blocks commit`, async () => {
    let inspections = 0;
    const safe = {
      changedPaths: ["packages/application/src/execution/gate-commit.ts"],
      changeDigest: "sha256:" + "5".repeat(64),
      commitCountSinceBase: 0
    };
    const bad = { changedPaths: [".git/config"], changeDigest: digest("protected"), commitCountSinceBase: 0 };
    const { state, ports } = gatePorts({
      worktrees: { inspect: async () => (++inspections === 1 ? (phase === "pre" ? bad : safe) : bad) }
    });
    await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_PROTECTED_PATH" });
    assert.equal(state.commits.length, 0);
  });
}

test("existing pre-gate commit is forbidden", async () => {
  const { state, ports } = gatePorts({
    worktrees: { inspect: async () => ({ changedPaths: [], changeDigest: digest("none"), commitCountSinceBase: 1 }) }
  });
  await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_COMMIT_CONFLICT" });
  assert.equal(state.commits.length, 0);
});

test("invalid commit receipt cannot mark the task committed", async () => {
  const { ports } = gatePorts({ git: { commitAtomic: async () => ({ status: "committed", commitId: "bad" }) } });
  await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_COMMIT_RECEIPT_INVALID" });
});

test("stale gate authority blocks before inspection", async () => {
  const { state, ports } = gatePorts({ authority: { verify: async () => ({ authorized: false }) } });
  await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_APPROVAL_INVALID" });
  assert.deepEqual(state.calls, []);
});

test("Approval expiry immediately before a gate command blocks its execution", async () => {
  let checks = 0;
  const input = gateInput();
  const { state, ports } = gatePorts({
    authority: {
      verify: async () => ({
        authorized: ++checks === 1,
        bindingDigest: input.authority.approvalBindingDigest,
        gatePlanDigest: input.gatePlan.planDigest
      })
    }
  });
  await assert.rejects(coordinator(ports).execute(input), { code: "VES_GATE_APPROVAL_INVALID" });
  assert.equal(state.gateRuns, 0);
  assert.equal(state.commits.length, 0);
});

test("expired writer coordination blocks before gates and commit", async () => {
  const { state, ports } = gatePorts({ coordination: { verify: async () => ({ active: false }) } });
  await assert.rejects(coordinator(ports).execute(gateInput()), { code: "VES_GATE_COMMIT_CONFLICT" });
  assert.equal(state.gateRuns, 0);
  assert.equal(state.commits.length, 0);
});

test("gate plan digest mismatch blocks before effects", async () => {
  const input = gateInput();
  input.gatePlan.commands[0].timeoutMs += 1;
  const { state, ports } = gatePorts();
  await assert.rejects(coordinator(ports).execute(input), { code: "VES_GATE_PLAN_INVALID" });
  assert.deepEqual(state.calls, []);
});

for (const [name, mutate] of [
  ["missing declared command", (input) => input.gatePlan.commands.pop()],
  ["uncovered requirement", (input) => (input.gatePlan.commands[1].requirementIds = ["VES-VFY-001"])],
  ["duplicate gate id", (input) => (input.gatePlan.commands[1].gateId = input.gatePlan.commands[0].gateId)],
  ["unknown plan authority", (input) => (input.gatePlan.commands[0].shell = true)]
]) {
  test(`${name} is rejected even with a recomputed-looking digest`, async () => {
    const input = gateInput();
    mutate(input);
    const { state, ports } = gatePorts();
    await assert.rejects(coordinator(ports).execute(input), { code: "VES_GATE_PLAN_INVALID" });
    assert.equal(state.commits.length, 0);
  });
}
