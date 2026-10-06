// invariant: the Codex verifier session (ADP-4, C4-2). `runCodexVerifier` runs
// its session through the driver session runner: a caller that is already
// cancelled starts no Codex process, a stop cancels the running one, every
// usage event spends from the run's budget, and a failure of the metering
// itself is raised instead of being read as a verifier that merely failed.
//
// The DETERMINISTIC FAKE `codex` in tests/helpers/task-cli-fakes stands in for
// the CLI. On Windows the governed task path is refused before a verifier
// session is reachable, so each case asserts that refusal there instead.
import assert from "node:assert/strict";
import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { codexAccountPlanType } from "../../apps/vestra-cli/src/task/task-codex.ts";
import { createBudgetMeter } from "../../packages/application/src/execution/budget-meter.ts";
import {
  VERIFIER_MODEL,
  WIN32_HOST,
  verifierFixtures,
  verifierRefusedOnWin32
} from "../helpers/codex-verifier-fixture.mjs";
import { eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";

const verifierSession = verifierFixtures(after);
// why: one turn of the fake reports 5 input and 3 output tokens.
const TURN_TOKENS = 8;
const PRICES = Object.freeze({
  version: "test.1",
  models: Object.freeze({ [VERIFIER_MODEL]: Object.freeze({ inputPerMToken: 1, outputPerMToken: 2 }) })
});
const meterWith = (budgets = {}, priceTable = PRICES) =>
  createBudgetMeter({
    budgets: { maximumCostUsd: 10, maximumTokens: 1_000_000, maximumDurationMs: 600_000, ...budgets },
    priceTable
  });

function failedWith(reason) {
  return (error) => {
    assert.equal(error.envelope.code, "VES_TASK_FAILED");
    assert.deepEqual(error.envelope.safeDetails, { reason });
    return true;
  };
}

test("a verifier whose caller is already cancelled starts no Codex process", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const controller = new AbortController();
  controller.abort();
  const session = await verifierSession({ signal: controller.signal });
  await assert.rejects(session.run(), failedWith("VES_EXECUTOR_CANCELLED"));
  assert.deepEqual(await session.sessions(), [], "Codex never opened a thread");
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
});

test("cancelling a running verifier stops its Codex process and fails as cancelled", { timeout: 60_000 }, async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const controller = new AbortController();
  t.after(() => controller.abort());
  const session = await verifierSession({ scenario: "hang", signal: controller.signal });
  const run = session.run();
  // hazard: the rejection is observed only after the turn is open; without a
  // handler it would be reported as unhandled if the run ended early.
  const settled = run.then(
    () => undefined,
    (error) => error
  );
  const { pid, scenario } = await session.turn();
  assert.equal(scenario, "hang");
  assert.equal(isAlive(pid), true, "the verifier was running when it was cancelled");
  const cancelledAt = Date.now();
  controller.abort();
  const error = await settled;
  assert.ok(error, "a cancelled verifier does not return a verdict");
  assert.equal(failedWith("VES_EXECUTOR_CANCELLED")(error), true);
  // invariant: the runner cancels the session itself; it does not wait for the
  // driver's interrupt grace period to pass before the process is stopped.
  assert.ok(Date.now() - cancelledAt < 5_000, "the cancel did not hang");
  assert.equal(await eventuallyDead(pid), true, "the Codex process is gone");
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
});

test("usage below every ceiling is spent from the run's budget and the verdict is returned", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const meter = meterWith();
  const session = await verifierSession({ meter });
  assert.match(await session.run(), /VERCHESTRA-VERDICT-BEGIN/u);
  const snapshot = meter.snapshot();
  assert.equal(snapshot.consumedTokens, TURN_TOKENS);
  assert.equal(snapshot.usageEvents, 1);
  assert.equal(snapshot.stopReason, null);
});

test("a verifier whose usage reaches the token ceiling fails as budget exceeded, not as a verdict", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  // why: the threshold is 90% of the ceiling, so one turn of the fake reaches it.
  const meter = meterWith({ maximumTokens: TURN_TOKENS });
  const session = await verifierSession({ meter });
  await assert.rejects(session.run(), failedWith("VES_EXECUTOR_BUDGET_EXCEEDED"));
  assert.equal(meter.snapshot().consumedTokens, TURN_TOKENS);
  assert.equal(meter.snapshot().stopReason, "token-threshold");
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
});

test(
  "a verifier that outlives the run's remaining duration is stopped as budget exceeded",
  { timeout: 60_000 },
  async (t) => {
    if (WIN32_HOST) return verifierRefusedOnWin32(t);
    const startedAt = Date.now();
    const meter = meterWith({ maximumDurationMs: 2_000 });
    const session = await verifierSession({ scenario: "hang", meter });
    await assert.rejects(session.run(), failedWith("VES_EXECUTOR_BUDGET_EXCEEDED"));
    // why: the stop is the duration timer at 90% of the ceiling; a session that
    // ended earlier ended for another reason.
    assert.ok(Date.now() - startedAt >= 1_700, "the verifier was stopped before its duration was reached");
    assert.equal(meter.snapshot().stopReason, "duration-threshold");
    // invariant: whatever Codex process had opened a turn by then is gone.
    for (const { pid } of await session.turns())
      assert.equal(await eventuallyDead(pid), true, "the Codex process is gone");
    await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
  }
);

test("usage the meter refuses stops the verifier with the meter's own code", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const meter = meterWith({}, { version: "test.1", models: {} });
  const session = await verifierSession({ meter });
  await assert.rejects(session.run(), failedWith("VES_BUDGET_MODEL_UNKNOWN"));
  assert.equal(meter.snapshot().usageEvents, 0);
});

test("a defect in the metering is raised as itself, never as a verifier that failed", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const defect = new TypeError("the meter is broken");
  const meter = {
    ...meterWith(),
    recordUsage: () => {
      throw defect;
    }
  };
  const session = await verifierSession({ meter });
  await assert.rejects(session.run(), (error) => error === defect);
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
});

test("a verifier with no meter is not stopped by its usage", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const session = await verifierSession();
  assert.match(await session.run(), /VERCHESTRA-VERDICT-BEGIN/u);
  assert.equal((await session.sessions()).length, 1);
});

// invariant: the reason names a reached ceiling before a caller's cancel, as the
// executor does: a run whose budget is gone is a budget outcome even when it
// was also cancelled.
test("a reached ceiling outranks a caller's cancel in the reason", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const meter = meterWith({ maximumTokens: TURN_TOKENS });
  meter.recordUsage({ model: VERIFIER_MODEL, inputTokens: TURN_TOKENS, outputTokens: 0 });
  const controller = new AbortController();
  controller.abort();
  const session = await verifierSession({ meter, signal: controller.signal });
  await assert.rejects(session.run(), failedWith("VES_EXECUTOR_BUDGET_EXCEEDED"));
  assert.deepEqual(await session.sessions(), [], "Codex never opened a thread");
});

// invariant: a verifier does not start on a budget that is already gone. The
// refusal is the verdict the meter would give on the first usage event, it
// comes before anything of the session exists, and nobody cancelled.
test("a verifier whose run is already at its ceiling starts no Codex process", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const meter = meterWith({ maximumTokens: TURN_TOKENS });
  meter.recordUsage({ model: VERIFIER_MODEL, inputTokens: TURN_TOKENS, outputTokens: 0 });
  const session = await verifierSession({ meter });
  await assert.rejects(session.run(), failedWith("VES_EXECUTOR_BUDGET_EXCEEDED"));
  assert.deepEqual(await session.sessions(), [], "Codex opened a thread");
  assert.deepEqual(await session.turns(), [], "Codex opened a turn");
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
  assert.equal(meter.snapshot().consumedTokens, TURN_TOKENS, "a refused verifier spent tokens");

  // why: the duration ceiling is a ceiling like the others.
  let clock = 0;
  const late = createBudgetMeter({
    budgets: { maximumCostUsd: 10, maximumTokens: 1_000_000, maximumDurationMs: 10_000 },
    priceTable: PRICES,
    now: () => clock
  });
  clock = 9_000;
  const second = await verifierSession({ meter: late });
  await assert.rejects(second.run(), failedWith("VES_EXECUTOR_BUDGET_EXCEEDED"));
  assert.deepEqual(await second.sessions(), [], "Codex opened a thread");
  assert.equal(late.snapshot().stopReason, "duration-threshold");
});

// invariant: the task composition injects the tree terminator (ADP-4, C4-4).
// A verifier that started processes of its own is stopped with all of them:
// the one in its process group, which holds its output open, and the one that
// left the group with setsid().
test(
  "cancelling a running verifier kills everything it started, including a process that left its group",
  { timeout: 60_000 },
  async (t) => {
    if (WIN32_HOST) return verifierRefusedOnWin32(t);
    const controller = new AbortController();
    t.after(() => controller.abort());
    const session = await verifierSession({ scenario: "fork", signal: controller.signal });
    const settled = session.run().then(
      () => undefined,
      (error) => error
    );
    const tree = await session.turn();
    for (const name of ["pid", "sameGroup", "escaped"])
      assert.equal(isAlive(tree[name]), true, `${name} was running when the verifier was cancelled`);
    controller.abort();
    // invariant: the run ends. With only the Codex process killed, the
    // descendant that holds its output open would keep the session waiting.
    const error = await settled;
    assert.ok(error, "a cancelled verifier does not return a verdict");
    assert.equal(failedWith("VES_EXECUTOR_CANCELLED")(error), true);
    for (const name of ["pid", "sameGroup", "escaped"])
      assert.equal(await eventuallyDead(tree[name]), true, `${name} is still running`);
    await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
  }
);

// invariant: D3b for the verifier. The verifier of a coordinated (v2) run is a
// subscription-only session: it proves its account and reads its rate limits
// before its turn, and credits on the account or a usage limit, before the
// turn or during it, raise a suspension record instead of a failure. A v1
// verifier on a subscription keeps the T04 conversation (SSI-83).
function suspendedWith(expected) {
  return (error) => {
    assert.equal(error.code, "VES_EXECUTOR_SUSPENDED", String(error.stack));
    const { at, ...record } = error.suspension;
    assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    assert.deepEqual(record, expected);
    return true;
  };
}

test("the verifier of a coordinated run proves its account before its turn and returns its verdict", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const session = await verifierSession({ schemaVersion: 2, subscription: true });
  assert.match(await session.run(), /VERCHESTRA-VERDICT-BEGIN/u);
  assert.deepEqual(
    (await session.turns()).map((entry) => entry.accountChecked),
    [true]
  );
});

test("a v1 verifier on a subscription reads no account and is not stopped by credits", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const session = await verifierSession({ schemaVersion: 1, subscription: true, flags: ["codex-credits"] });
  assert.match(await session.run(), /VERCHESTRA-VERDICT-BEGIN/u);
  assert.deepEqual(
    (await session.turns()).map((entry) => entry.accountChecked),
    [false]
  );
});

// invariant: SSI-83. A v1 verifier whose allowance runs out mid-turn fails
// the run as it did before the v2 verifier could suspend one, whether it
// authenticates from the Workspace login or from an API key; it never raises
// a suspension.
test("a v1 verifier that meets a usage limit fails the run, on a subscription and on an API key", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  for (const subscription of [true, false]) {
    const session = await verifierSession({ schemaVersion: 1, subscription, scenario: "usage-limit" });
    await assert.rejects(session.run(), failedWith("VES_CODEX_EXECUTION_FAILED"), `subscription: ${subscription}`);
    assert.deepEqual(
      (await session.turns()).map((entry) => entry.accountChecked),
      [false],
      `subscription: ${subscription}`
    );
    await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
  }
});

// invariant: the cause of a verifier that did not complete is the stable code
// its session reported. A model the account does not offer fails the verifier
// as `VES_CODEX_MODEL_UNAVAILABLE`, before a thread or a turn is opened, in a v1
// and in a v2 run, on a subscription and on an API key.
test("a verifier whose model the account does not offer fails with that cause, opening no thread", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  for (const [schemaVersion, subscription] of [
    [1, false],
    [1, true],
    [2, true]
  ]) {
    const session = await verifierSession({ schemaVersion, subscription, flags: ["codex-model-missing"] });
    const label = `schema ${schemaVersion}, subscription: ${subscription}`;
    await assert.rejects(session.run(), failedWith("VES_CODEX_MODEL_UNAVAILABLE"), label);
    assert.deepEqual(await session.sessions(), [], `${label}: Codex opened a thread`);
    assert.deepEqual(await session.turns(), [], `${label}: Codex opened a turn`);
    await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
  }
});

test("credits on the account suspend a coordinated run's verifier before its turn", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const session = await verifierSession({ schemaVersion: 2, subscription: true, flags: ["codex-credits"] });
  await assert.rejects(session.run(), suspendedWith({ reason: "VES_CODEX_CREDITS_PRESENT", provider: "codex" }));
  assert.deepEqual(await session.turns(), [], "Codex opened a turn");
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
});

test("an exhausted allowance suspends a coordinated run's verifier, before its turn or during it", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const before = await verifierSession({ schemaVersion: 2, subscription: true, flags: ["codex-quota"] });
  // why: the fake's five-hour window is used up and resets at 1_790_000_000 s.
  await assert.rejects(
    before.run(),
    suspendedWith({
      reason: "VES_DRIVER_QUOTA_EXHAUSTED",
      provider: "codex",
      scope: "ordinary_usage_disallowed",
      resetsAt: "2026-09-21T14:13:20.000Z"
    })
  );
  assert.deepEqual(await before.turns(), [], "Codex opened a turn");
  const during = await verifierSession({ schemaVersion: 2, subscription: true, scenario: "usage-limit" });
  await assert.rejects(
    during.run(),
    suspendedWith({ reason: "VES_DRIVER_QUOTA_EXHAUSTED", provider: "codex", scope: "usage_limit_exceeded" })
  );
  assert.equal((await during.turns()).length, 1);
  await assert.rejects(stat(during.sessionRoot), { code: "ENOENT" });
});

// invariant: SSI-52. The plan type of a coordinated run's Codex login is read
// by an account-only session that opens no thread and no turn; a login that
// is not a ChatGPT one, or a Codex below the floor of the account read, is not
// configured, each with its own requirement.
async function accountPlanType(session) {
  return codexAccountPlanType({
    workspaceId: session.options.workspaceId,
    runId: session.options.runId,
    manifestId: session.options.manifestId,
    model: VERIFIER_MODEL,
    executable: session.options.executable,
    identityDirectory: session.options.identityDirectory,
    env: session.options.env,
    sessionRoot: join(session.root, "sessions", "codex-account"),
    stderr: () => undefined
  });
}

function notConfiguredAs(requirement) {
  return (error) => {
    assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
    assert.deepEqual(error.envelope.safeDetails, { requirement });
    return true;
  };
}

test("the plan type of a Codex login is read by a session that opens no thread", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const session = await verifierSession({ subscription: true });
  assert.equal(await accountPlanType(session), "plus");
  assert.deepEqual(await session.sessions(), [], "Codex opened a thread");
  assert.deepEqual(await session.turns(), [], "Codex opened a turn");
  await assert.rejects(stat(join(session.root, "sessions", "codex-account")), { code: "ENOENT" });
});

test("a login that is no ChatGPT one, or a Codex below the account floor, is not configured", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const apiKey = await verifierSession({ subscription: true });
  await writeFile(join(apiKey.options.identityDirectory, "auth.json"), JSON.stringify({ fixtureLogin: "api-key" }));
  await assert.rejects(accountPlanType(apiKey), notConfiguredAs("codex-account"));
  const older = await verifierSession({ subscription: true, flags: ["codex-0.159.2"] });
  await assert.rejects(accountPlanType(older), notConfiguredAs("codex-version"));
  assert.deepEqual(await older.sessions(), []);
});
