// invariant: one run, one account of usage, for the whole run. The
// implementer's usage is recorded on the Run's ledger when it is metered, as
// the verifier's is, so a run killed during an attempt keeps what the attempt
// had reported and a resumed run adds it once. A budget stop fails the run
// with the budget's own code whichever provider it stopped.
//
// The run is the production task run coordinator, repair loop, workflow
// machine and budget module over the Run record's checkpoint projections in a
// real runtime store, composed as the task composition composes them
// (tests/helpers/verifier-usage-fixture.mjs). A provider is scripted: it
// reports usage to the meter it is handed and then returns, fails, or never
// returns, which is where a killed process leaves a run. A resumed run is a
// new composition over a new connection to the same store. The cases that run
// the verifier use the production session against the DETERMINISTIC FAKE
// `codex`; on Windows the governed task path is refused before a verifier
// session is reachable, so those cases assert that refusal there instead.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";

import { taskError } from "../../apps/vestra-cli/src/task/task-errors.ts";
import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { WIN32_HOST, verifierFixtures, verifierRefusedOnWin32 } from "../helpers/codex-verifier-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";
import { filled } from "../helpers/task-run-record-fixture.mjs";
import {
  IMPLEMENTER,
  IMPLEMENTER_TOKENS,
  VERIFIER,
  VERIFIER_TOKENS,
  commitGate,
  composedRun,
  priced,
  runCheckpoints,
  workflowOf
} from "../helpers/verifier-usage-fixture.mjs";

const RUN_TOKENS = IMPLEMENTER_TOKENS + VERIFIER_TOKENS;
const BUDGET_EXCEEDED = "VES_EXECUTOR_BUDGET_EXCEEDED";
const verifierSession = verifierFixtures(after);
const reopened = [];

afterEach(async () => {
  for (const store of reopened.splice(0)) store.close();
  await cleanup();
});

async function newRun(state) {
  const { root, dbPath, store } = await opened();
  const tasksRoot = join(root, "tasks");
  return { dbPath, tasksRoot, workflow: workflowOf(state), checkpoints: runCheckpoints(store, tasksRoot) };
}

// why: a resumed run is a new process: a new connection to the store and a
// new composition, with nothing but the store and the workflow state kept.
function resumed(run, script) {
  const store = new RuntimeStore({ dbPath: run.dbPath });
  store.open();
  reopened.push(store);
  const checkpoints = runCheckpoints(store, run.tasksRoot);
  return {
    ...composedRun(checkpoints, run.workflow, script),
    checkpoints,
    state: () => checkpoints.repairPort().loadState()
  };
}

// invariant: resolves once `provider` reached the point where the process is
// killed: after it did what the script says, on the call `when` selects. The
// provider never returns from that call, so the run records nothing after that
// point: no attempt ends, and no closing record is made.
function killedWhen(run, script, provider, when = () => true) {
  return new Promise((reached, failed) => {
    const killed = async (...received) => {
      await script[provider]?.(...received);
      if (!when(...received)) return;
      reached();
      await new Promise(() => undefined);
    };
    composedRun(run.checkpoints, run.workflow, { ...script, [provider]: killed })
      .run()
      .then(() => failed(new Error("the run ended instead of being killed")), failed);
  });
}

const spend = (usage) => async (meter) => meter.recordUsage(usage);
const implementerLedger = { consumedTokens: IMPLEMENTER_TOKENS, usageEvents: 1, consumedCostUsd: priced(IMPLEMENTER) };

function assertLedger(ledger, expected) {
  for (const [member, value] of Object.entries(expected)) assert.equal(ledger[member], value, member);
}

test("an attempt's usage is on the Run's ledger when it is metered, before the attempt ends", async () => {
  const run = await newRun();
  await killedWhen(run, { implement: spend(IMPLEMENTER) }, "implement");
  const stored = await resumed(run).state();
  // invariant: no attempt has ended, so the state is the loop's own between
  // attempts with none recorded: what a resumed loop starts its first from.
  assert.deepEqual(
    { stage: stored.stage, attempts: stored.attempts, attemptCapsuleDigests: stored.attemptCapsuleDigests },
    { stage: "repair", attempts: 0, attemptCapsuleDigests: [] }
  );
  assertLedger(stored.budgetLedger, { ...implementerLedger, stopReason: null });
  assert.equal(run.workflow.current.state, "IMPLEMENTING");
});

test("a run killed after its implementer finished resumes at its gate and counts that usage once", async () => {
  const run = await newRun();
  await killedWhen(run, { implement: spend(IMPLEMENTER) }, "implement");

  const again = resumed(run, { resumable: true, verify: spend(VERIFIER) });
  assert.equal((await again.run()).status, "HUMAN_REVIEW");
  assert.deepEqual(again.calls, { implemented: 0, gated: 1, verified: 1, released: 0 });
  const stored = await again.state();
  assert.deepEqual(
    { stage: stored.stage, attempts: stored.attempts, attemptCapsuleDigests: stored.attemptCapsuleDigests },
    { stage: "converged", attempts: 1, attemptCapsuleDigests: [filled("1")] }
  );
  // why: 18 from the attempt that was killed and 8 from the verifier. 8 alone
  // would have lost the attempt; 44 would have counted it twice.
  assertLedger(stored.budgetLedger, {
    consumedTokens: RUN_TOKENS,
    usageEvents: 2,
    consumedCostUsd: priced(IMPLEMENTER) + priced(VERIFIER),
    stopReason: null
  });
});

test("a run whose killed attempt is run again adds the new session to the one already recorded", async () => {
  const run = await newRun();
  await killedWhen(run, { implement: spend(IMPLEMENTER) }, "implement");

  const again = resumed(run, { implement: spend(IMPLEMENTER), verify: spend(VERIFIER) });
  assert.equal((await again.run()).status, "HUMAN_REVIEW");
  assert.equal(again.calls.implemented, 1);
  // why: two implementer sessions reported usage and both were spent:
  // 18 + 18 + 8 = 44 tokens in 3 events.
  assertLedger((await again.state()).budgetLedger, {
    consumedTokens: 2 * IMPLEMENTER_TOKENS + VERIFIER_TOKENS,
    usageEvents: 3,
    consumedCostUsd: priced(IMPLEMENTER) + priced(IMPLEMENTER) + priced(VERIFIER)
  });
});

// invariant: Claude Code reports usage when its session ends. A session killed
// before that reported nothing, so nothing is recorded for it and the resumed
// run's total is the usage that was reported: the second session's.
test("an attempt killed before its implementer reported usage leaves nothing to record", async () => {
  const run = await newRun();
  await killedWhen(run, {}, "implement");
  assert.equal(await resumed(run).state(), undefined);

  const again = resumed(run, { implement: spend(IMPLEMENTER), verify: spend(VERIFIER) });
  assert.equal((await again.run()).status, "HUMAN_REVIEW");
  assertLedger((await again.state()).budgetLedger, { consumedTokens: RUN_TOKENS, usageEvents: 2 });
});

test("usage of a later attempt is recorded on the state the earlier attempts left", async () => {
  const onGateFailure = { maxAttempts: 2, feedbackToDriver: false, escalateAfter: 2 };
  const run = await newRun();
  // why: the first attempt reports usage and fails its gate; the second
  // reports usage and is killed before it ends.
  await killedWhen(
    run,
    { onGateFailure, gateResults: ["fail"], implement: spend(IMPLEMENTER) },
    "implement",
    (_meter, attempt) => attempt === 2
  );
  const killed = await resumed(run).state();
  assert.deepEqual(
    { stage: killed.stage, attempts: killed.attempts, attemptCapsuleDigests: killed.attemptCapsuleDigests },
    { stage: "repair", attempts: 1, attemptCapsuleDigests: [filled("1")] }
  );
  assertLedger(killed.budgetLedger, { consumedTokens: 2 * IMPLEMENTER_TOKENS, usageEvents: 2 });

  const again = resumed(run, { onGateFailure, resumable: true, verify: spend(VERIFIER) });
  assert.equal((await again.run()).status, "HUMAN_REVIEW");
  assert.deepEqual(again.calls, { implemented: 0, gated: 1, verified: 1, released: 0 });
  const stored = await again.state();
  assert.deepEqual(
    { stage: stored.stage, attempts: stored.attempts, attemptCapsuleDigests: stored.attemptCapsuleDigests },
    { stage: "converged", attempts: 2, attemptCapsuleDigests: [filled("1"), filled("2")] }
  );
  assertLedger(stored.budgetLedger, { consumedTokens: 2 * IMPLEMENTER_TOKENS + VERIFIER_TOKENS, usageEvents: 3 });
});

test("a ceiling a killed attempt had reached stops the resumed run before it spends again", async () => {
  // why: 90% of 20 is 18, which the implementer's one usage event reaches.
  const metering = { budgets: { maximumTokens: 20 } };
  const run = await newRun();
  await killedWhen(run, { metering, implement: spend(IMPLEMENTER) }, "implement");
  assertLedger((await resumed(run).state()).budgetLedger, { ...implementerLedger, stopReason: "token-threshold" });

  const again = resumed(run, { metering, implement: spend(IMPLEMENTER), verify: spend(VERIFIER) });
  assert.deepEqual(await again.run(), { status: "FAILED", reason: BUDGET_EXCEEDED });
  assert.deepEqual(again.calls, { implemented: 0, gated: 0, verified: 0, released: 1 });
  const stored = await again.state();
  assert.equal(stored.stage, "budget-exceeded");
  assertLedger(stored.budgetLedger, { ...implementerLedger, stopReason: "token-threshold" });
});

test("a failure to record an implementer's usage fails the run as itself", async () => {
  const run = await newRun();
  const defect = Object.assign(new Error("the runtime store refused the record"), { code: "VES_RUNTIME_CONSTRAINT" });
  const unrecordable = {
    repairPort: () => run.checkpoints.repairPort(),
    repair: () => run.checkpoints.repair(),
    gate: () => run.checkpoints.gate(),
    recordBudgetLedger: () => {
      throw defect;
    }
  };
  const composed = composedRun(unrecordable, run.workflow, { implement: spend(IMPLEMENTER) });
  assert.deepEqual(await composed.run(), { status: "FAILED", reason: "VES_RUNTIME_CONSTRAINT" });
  assert.equal(composed.calls.gated, 0, "the attempt went on to its gate");
});

// invariant: a budget stop names itself, on both paths. The implementer's is
// raised by the executor under its own code. The verifier's is a task failure
// whose reason is that code, and it fails the run under it as well.
test("a budget stop fails the run with the budget's own code, whichever provider it stopped", async () => {
  // why: as the executor does it: the usage that reaches the ceiling is
  // metered (90% of 20 is 18), and the attempt then fails under its code.
  const implementer = await newRun();
  const stoppedImplementer = composedRun(implementer.checkpoints, implementer.workflow, {
    metering: { budgets: { maximumTokens: 20 } },
    implement: async (meter) => {
      meter.recordUsage(IMPLEMENTER);
      throw Object.assign(new Error("declared token-threshold was reached"), { code: BUDGET_EXCEEDED });
    }
  });
  assert.deepEqual(await stoppedImplementer.run(), { status: "FAILED", reason: BUDGET_EXCEEDED });

  const verifier = await newRun();
  const stoppedVerifier = composedRun(verifier.checkpoints, verifier.workflow, {
    implement: spend(IMPLEMENTER),
    verify: async () => {
      throw taskError("VES_TASK_FAILED", { reason: BUDGET_EXCEEDED }, "The independent verifier did not complete");
    }
  });
  assert.deepEqual(await stoppedVerifier.run(), { status: "FAILED", reason: BUDGET_EXCEEDED });
  assert.equal(verifier.workflow.current.state, "FAILED");
  assert.equal(stoppedVerifier.calls.released, 1);
});

test("a verifier's usage the meter refuses fails the run with the meter's code, as an implementer's does", async () => {
  const unpriced = { ...VERIFIER, model: "a-model-without-a-price" };
  const implementer = await newRun();
  assert.deepEqual(
    await composedRun(implementer.checkpoints, implementer.workflow, { implement: spend(unpriced) }).run(),
    { status: "FAILED", reason: "VES_BUDGET_MODEL_UNKNOWN" }
  );

  const verifier = await newRun();
  const refused = composedRun(verifier.checkpoints, verifier.workflow, {
    implement: spend(IMPLEMENTER),
    verify: async () => {
      throw taskError("VES_TASK_FAILED", { reason: "VES_BUDGET_MODEL_UNKNOWN" }, "The verifier did not complete");
    }
  });
  assert.deepEqual(await refused.run(), { status: "FAILED", reason: "VES_BUDGET_MODEL_UNKNOWN" });
});

test("a verification failure that is not a budget stop keeps the code it had", async () => {
  for (const [failure, reason] of [
    [
      taskError("VES_TASK_FAILED", { reason: "VES_TASK_VERIFIER_FAILED" }, "The verifier did not complete"),
      "VES_TASK_FAILED"
    ],
    [taskError("VES_TASK_STATE_INVALID", { reason: BUDGET_EXCEEDED }, "not a task failure"), "VES_TASK_STATE_INVALID"],
    [Object.assign(new Error("git failed"), { code: "VES_GIT_FAILED" }), "VES_GIT_FAILED"],
    [new Error("no code at all"), "VES_TASK_RUN_FAILED"]
  ]) {
    const run = await newRun();
    const composed = composedRun(run.checkpoints, run.workflow, {
      implement: spend(IMPLEMENTER),
      verify: async () => {
        throw failure;
      }
    });
    assert.deepEqual(await composed.run(), { status: "FAILED", reason }, reason);
  }
});

test("the verifier reaching the run's ceiling fails the run as a budget stop and the ledger names it", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  // why: 90% of 28 is 25.2: neither the implementer's 18 nor the verifier's 8
  // reaches it, the run's 26 do.
  const metering = { budgets: { maximumTokens: 28 } };
  const run = await newRun();
  const session = await verifierSession();
  const composed = composedRun(run.checkpoints, run.workflow, {
    metering,
    implement: spend(IMPLEMENTER),
    verify: (meter) => session.run(meter)
  });
  assert.deepEqual(await composed.run(), { status: "FAILED", reason: BUDGET_EXCEEDED });
  assert.equal((await session.sessions()).length, 1, "the verifier was never asked");
  const stored = await resumed(run).state();
  assert.equal(stored.stage, "converged");
  assertLedger(stored.budgetLedger, { consumedTokens: RUN_TOKENS, usageEvents: 2, stopReason: "token-threshold" });
});

test("a committed run whose loop saved no state has its verifier's usage filed under converged", async () => {
  const run = await newRun("VERIFYING");
  await commitGate(run.checkpoints);
  const composed = composedRun(run.checkpoints, run.workflow, { verify: spend(VERIFIER) });
  assert.equal((await composed.run()).status, "HUMAN_REVIEW");
  const stored = await resumed(run).state();
  assert.deepEqual(
    { stage: stored.stage, attempts: stored.attempts, attemptCapsuleDigests: stored.attemptCapsuleDigests },
    { stage: "converged", attempts: 0, attemptCapsuleDigests: [] }
  );
  assertLedger(stored.budgetLedger, { consumedTokens: VERIFIER_TOKENS, usageEvents: 1 });
});
