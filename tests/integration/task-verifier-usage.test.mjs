// invariant: one run, one account of usage. The verifier spends from the Run's
// ledger, the one its latest repair state carries, and what it spends is
// recorded there when each usage event is metered. `task status` and the Run
// Capsule read that ledger, so they report the implementer's usage and the
// verifier's; a crash after a usage event loses nothing; and a verification
// that is repeated adds its own usage once.
//
// The ledger lives in a real runtime store and is read and recorded through
// the Run record's checkpoint projections. The work is metered as the task
// composition meters it (`meterOnRunLedger`). The verifier cases run the
// production session against the DETERMINISTIC FAKE `codex` in
// tests/helpers/task-cli-fakes; on Windows the governed task path is refused
// before a verifier session is reachable, so each of those cases asserts that
// refusal there instead.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { after, afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  budgetStatus,
  capsuleBudgetConsumption,
  meterOnRunLedger
} from "../../apps/vestra-cli/src/task/task-budget.ts";
import { createBudgetMeter, recordUsageAndDecide } from "../../packages/application/src/index.ts";
import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { WIN32_HOST, verifierFixtures, verifierRefusedOnWin32 } from "../helpers/codex-verifier-fixture.mjs";
import { eventually } from "../helpers/process-liveness.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";
import { filled } from "../helpers/task-run-record-fixture.mjs";
import {
  IMPLEMENTER,
  IMPLEMENTER_TOKENS,
  VERIFIER,
  VERIFIER_TOKENS,
  meterOptions,
  meteredOnLedger,
  priced,
  runCheckpoints
} from "../helpers/verifier-usage-fixture.mjs";

const CHILD = fileURLToPath(new URL("../helpers/verifier-usage-crash-child.mjs", import.meta.url));
const RUN_TOKENS = IMPLEMENTER_TOKENS + VERIFIER_TOKENS;
const verifierSession = verifierFixtures(after);
const reopened = [];
const children = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
  for (const store of reopened.splice(0)) store.close();
  await cleanup();
});

// why: the ledger a repair loop leaves behind once the implementer's one usage
// event was metered and its gate converged. It is produced by a real meter, as
// the loop produces it.
function implementerLedger(metering) {
  const meter = createBudgetMeter(meterOptions(metering));
  meter.recordUsage(IMPLEMENTER);
  return meter.ledger();
}

async function runWith(ledger) {
  const { root, dbPath, store } = await opened();
  const tasksRoot = join(root, "tasks");
  const checkpoints = runCheckpoints(store, tasksRoot);
  if (ledger !== undefined)
    await checkpoints
      .repairPort()
      .saveState({ stage: "converged", attempts: 1, attemptCapsuleDigests: [filled("7")], budgetLedger: ledger });
  const recorded = async () => (await checkpoints.repair())?.budgetLedger;
  return { dbPath, tasksRoot, checkpoints, recorded };
}

// why: a resumed run is a new process, so it reads the ledger through a
// connection of its own.
function resumed(run) {
  const store = new RuntimeStore({ dbPath: run.dbPath });
  store.open();
  reopened.push(store);
  const checkpoints = runCheckpoints(store, run.tasksRoot);
  return { checkpoints, recorded: async () => (await checkpoints.repair())?.budgetLedger };
}

// why: work that is interrupted where a killed process would be: after
// `spend`, with the work never ending, so the ledger is never recorded again.
function interruptedAfter(checkpoints, metering, spend) {
  return new Promise((reached, failed) => {
    meteredOnLedger(checkpoints, metering, async (meter) => {
      spend(meter);
      reached();
      await new Promise(() => undefined);
    }).catch(failed);
  });
}

function failedWith(reason) {
  return (error) => {
    assert.equal(error.envelope.code, "VES_TASK_FAILED");
    assert.deepEqual(error.envelope.safeDetails, { reason });
    return true;
  };
}

test("work metered on the run's ledger continues from it and stores each usage event when it is metered", async () => {
  const run = await runWith(implementerLedger());
  await interruptedAfter(run.checkpoints, undefined, (meter) => {
    assert.equal(meter.snapshot().consumedTokens, IMPLEMENTER_TOKENS, "the meter did not continue from the ledger");
    meter.recordUsage(VERIFIER);
  });
  // invariant: the work has not ended and nothing after the event was
  // awaited: the event itself stored the ledger.
  const stored = await resumed(run).recorded();
  assert.equal(stored.consumedTokens, RUN_TOKENS);
  assert.equal(stored.usageEvents, 2);
  assert.equal(stored.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER));
  assert.equal(stored.stopReason, null);
  assert.equal(Object.hasOwn(stored, "unbilledTokens"), false, "billed usage alone names no unbilled tokens");
  assert.deepEqual(await run.checkpoints.repairPort().loadState(), {
    stage: "converged",
    attempts: 1,
    attemptCapsuleDigests: [filled("7")],
    budgetLedger: stored
  });
});

test("a run with no recorded usage starts its account with the first event metered", async () => {
  const run = await runWith(undefined);
  await interruptedAfter(run.checkpoints, undefined, (meter) => {
    assert.equal(meter.snapshot().consumedTokens, 0);
    meter.recordUsage(VERIFIER);
  });
  const stored = await run.recorded();
  assert.equal(stored.consumedTokens, VERIFIER_TOKENS);
  assert.equal(stored.usageEvents, 1);
  assert.equal((await run.checkpoints.repair()).stage, "converged");
});

test("a repeated verification adds its usage once and keeps what the interrupted one spent", async () => {
  const run = await runWith(implementerLedger());
  await interruptedAfter(run.checkpoints, undefined, (meter) => meter.recordUsage(VERIFIER));

  const again = resumed(run);
  await meteredOnLedger(again.checkpoints, undefined, async (meter) => {
    assert.equal(meter.snapshot().consumedTokens, RUN_TOKENS, "the interrupted verification's usage was lost");
    meter.recordUsage(VERIFIER);
  });
  const stored = await again.recorded();
  assert.equal(stored.consumedTokens, RUN_TOKENS + VERIFIER_TOKENS);
  assert.equal(stored.usageEvents, 3);
  assert.equal(stored.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER) + priced(VERIFIER));
});

test("unbilled usage stays unbilled and billed usage costs what the price table says", async () => {
  const spendVerifier = async (meter) => meter.recordUsage(VERIFIER);

  const both = { unbilledModels: [IMPLEMENTER.model, VERIFIER.model] };
  const subscription = await runWith(implementerLedger(both));
  await meteredOnLedger(subscription.checkpoints, both, spendVerifier);
  const unbilled = await subscription.recorded();
  assert.equal(unbilled.consumedCostUsd, 0);
  assert.equal(unbilled.unbilledTokens, RUN_TOKENS);
  assert.equal(unbilled.consumedTokens, RUN_TOKENS);
  assert.equal(budgetStatus(unbilled).consumedCostUsd, "not billed (subscription)");
  assert.deepEqual(capsuleBudgetConsumption(unbilled), {
    consumed: {
      tokens: RUN_TOKENS,
      durationMs: unbilled.consumedDurationMs,
      usageEvents: 2,
      unbilledTokens: RUN_TOKENS
    },
    billing: "subscription"
  });

  const apiKey = await runWith(implementerLedger());
  await meteredOnLedger(apiKey.checkpoints, undefined, spendVerifier);
  const billed = await apiKey.recorded();
  assert.equal(billed.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER));
  assert.deepEqual(budgetStatus(billed), billed, "billed usage is reported as it is stored");
  assert.equal(capsuleBudgetConsumption(billed).consumed.costUsd, priced(IMPLEMENTER) + priced(VERIFIER));

  // why: the implementer on a subscription and the verifier on a key. While
  // the verifier's usage went unrecorded this run reported no cost at all.
  const implementerOnly = { unbilledModels: [IMPLEMENTER.model] };
  const mixed = await runWith(implementerLedger(implementerOnly));
  await meteredOnLedger(mixed.checkpoints, implementerOnly, spendVerifier);
  const part = await mixed.recorded();
  assert.equal(part.consumedCostUsd, priced(VERIFIER));
  assert.equal(part.unbilledTokens, IMPLEMENTER_TOKENS);
  assert.equal(budgetStatus(part).billing, "mixed");
  assert.equal(budgetStatus(part).consumedCostUsd, priced(VERIFIER));
  assert.deepEqual(capsuleBudgetConsumption(part), {
    consumed: {
      costUsd: priced(VERIFIER),
      tokens: RUN_TOKENS,
      durationMs: part.consumedDurationMs,
      usageEvents: 2,
      unbilledTokens: IMPLEMENTER_TOKENS
    },
    billing: "mixed"
  });
});

test("usage the meter refuses is not recorded, and the refusal stays the meter's own", async () => {
  const ledger = implementerLedger();
  const run = await runWith(ledger);
  await interruptedAfter(run.checkpoints, undefined, (meter) => {
    const decision = recordUsageAndDecide(meter, { ...VERIFIER, model: "a-model-without-a-price" });
    assert.equal(decision.stop, true);
    assert.equal(decision.reason, "VES_BUDGET_MODEL_UNKNOWN");
  });
  assert.deepEqual(await run.recorded(), ledger);
});

test("a failure to record the ledger is raised as itself, never read as a budget stop", async () => {
  const defect = new Error("the runtime store is gone");
  const unrecordable = {
    repair: async () => undefined,
    recordBudgetLedger: () => {
      throw defect;
    }
  };
  const create = () => createBudgetMeter(meterOptions());
  let metered = false;
  await assert.rejects(
    meterOnRunLedger(unrecordable, create, async (meter) => {
      assert.throws(
        () => recordUsageAndDecide(meter, VERIFIER),
        (error) => error === defect
      );
      metered = true;
    }),
    (error) => error === defect,
    "the closing record failed without a trace"
  );
  assert.equal(metered, true);
});

test("the ledger is recorded once more when the work ends, with the time that passed and however it ends", async () => {
  let clock = 1_000_000;
  const metering = { now: () => clock };
  const run = await runWith(implementerLedger(metering));
  const result = await meteredOnLedger(run.checkpoints, metering, async (meter) => {
    clock += 250;
    meter.recordUsage(VERIFIER);
    assert.equal((await run.recorded()).consumedDurationMs, 250);
    // why: the verifier's mutation runs take time and report no usage.
    clock += 4_000;
    assert.equal((await run.recorded()).consumedDurationMs, 250);
    return "verdict";
  });
  assert.equal(result, "verdict", "the work's own result is returned");
  const closing = await run.recorded();
  assert.equal(closing.consumedDurationMs, 4_250);
  assert.equal(closing.consumedTokens, RUN_TOKENS);
  assert.equal(closing.usageEvents, 2);

  const failure = new Error("the work failed");
  await assert.rejects(
    meteredOnLedger(run.checkpoints, metering, async () => {
      clock += 1_000;
      throw failure;
    }),
    (error) => error === failure
  );
  assert.equal((await run.recorded()).consumedDurationMs, 5_250, "work that failed left its time unrecorded");
});

test("the verifier's usage is recorded on the run's ledger with the implementer's", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const run = await runWith(implementerLedger());
  const session = await verifierSession();
  const verdict = await meteredOnLedger(run.checkpoints, undefined, (meter) => session.run(meter));
  assert.match(verdict, /VERCHESTRA-VERDICT-BEGIN/u);
  const stored = await run.recorded();
  assert.equal(stored.consumedTokens, RUN_TOKENS);
  assert.equal(stored.usageEvents, 2);
  assert.equal(stored.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER));
  assert.equal(stored.stopReason, null);
});

test("a ceiling the verifier reaches alone stops it as budget exceeded, and the ledger says why", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  // why: the threshold is 90% of the ceiling, so one turn of the fake reaches
  // it. No implementer usage was recorded for this run.
  const run = await runWith(undefined);
  const session = await verifierSession();
  await assert.rejects(
    meteredOnLedger(run.checkpoints, { budgets: { maximumTokens: VERIFIER_TOKENS } }, (meter) => session.run(meter)),
    failedWith("VES_EXECUTOR_BUDGET_EXCEEDED")
  );
  const stored = await run.recorded();
  assert.equal(stored.consumedTokens, VERIFIER_TOKENS);
  assert.equal(stored.usageEvents, 1);
  assert.equal(stored.stopReason, "token-threshold");
});

test("a ceiling the implementer and the verifier reach only together stops the verifier", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  // why: 90% of 28 is 25.2. The implementer's 18 tokens are below it and so
  // are the verifier's 8; the run's 26 are not.
  const metering = { budgets: { maximumTokens: 28 } };
  const ledger = implementerLedger(metering);
  assert.equal(ledger.stopReason, null, "the implementer alone reached the ceiling");
  const alone = createBudgetMeter(meterOptions(metering));
  assert.match(await (await verifierSession()).run(alone), /VERCHESTRA-VERDICT-BEGIN/u);
  assert.equal(alone.ledger().stopReason, null, "the verifier alone reached the ceiling");

  const run = await runWith(ledger);
  const session = await verifierSession();
  await assert.rejects(
    meteredOnLedger(run.checkpoints, metering, (meter) => session.run(meter)),
    failedWith("VES_EXECUTOR_BUDGET_EXCEEDED")
  );
  const stored = await run.recorded();
  assert.equal(stored.consumedTokens, RUN_TOKENS);
  assert.equal(stored.usageEvents, 2);
  assert.equal(stored.stopReason, "token-threshold");
});

// invariant: the duration ceiling is reached with no usage event at all, so
// only the record made when the work ends can say that it was.
test(
  "a verifier that outlives the run's remaining time leaves the duration ceiling on the ledger",
  { timeout: 60_000 },
  async (t) => {
    if (WIN32_HOST) return verifierRefusedOnWin32(t);
    const metering = { budgets: { maximumDurationMs: 2_000 } };
    const run = await runWith(implementerLedger(metering));
    const session = await verifierSession({ scenario: "hang" });
    await assert.rejects(
      meteredOnLedger(run.checkpoints, metering, (meter) => session.run(meter)),
      failedWith("VES_EXECUTOR_BUDGET_EXCEEDED")
    );
    const stored = await run.recorded();
    assert.equal(stored.stopReason, "duration-threshold");
    assert.ok(stored.consumedDurationMs >= 1_700, "the time the verifier took was not recorded");
    assert.equal(stored.consumedTokens, IMPLEMENTER_TOKENS, "a verifier that reported nothing spent tokens");
    assert.equal(stored.usageEvents, 1);
  }
);

// invariant: a crash during verification. The stand-in is a real process that
// is killed after the verifier's usage was metered and before anything else is
// recorded, as a task command killed during its mutation runs would be. The
// store alone then holds the usage, and a second verification, in this
// process, continues from it.
test(
  "a process killed after the verifier's usage loses none of it, and the resumed verification counts it once",
  { timeout: 60_000 },
  async (t) => {
    if (WIN32_HOST) return verifierRefusedOnWin32(t);
    const run = await runWith(implementerLedger());
    const first = await verifierSession();
    const child = spawn(
      process.execPath,
      [CHILD, run.dbPath, run.tasksRoot, JSON.stringify(first.options), JSON.stringify({})],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const ended = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
    const metered = await Promise.race([eventually(() => stdout.includes("metered"), 30_000), ended]);
    assert.equal(metered, true, `the stand-in ended before it metered the verifier: ${stderr}`);
    child.kill("SIGKILL");
    assert.deepEqual(await ended, { code: null, signal: "SIGKILL" });

    const interrupted = resumed(run);
    const kept = await interrupted.recorded();
    assert.equal(kept.consumedTokens, RUN_TOKENS, "the killed verifier's usage was lost");
    assert.equal(kept.usageEvents, 2);
    assert.equal(kept.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER));

    const session = await verifierSession();
    const verdict = await meteredOnLedger(interrupted.checkpoints, undefined, (meter) => session.run(meter));
    assert.match(verdict, /VERCHESTRA-VERDICT-BEGIN/u);
    const total = await interrupted.recorded();
    assert.equal(total.consumedTokens, RUN_TOKENS + VERIFIER_TOKENS);
    assert.equal(total.usageEvents, 3);
    assert.equal(total.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER) + priced(VERIFIER));
    assert.equal(total.stopReason, null);
  }
);
