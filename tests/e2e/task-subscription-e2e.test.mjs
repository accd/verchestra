// invariant: subscriptions only, with suspension (SSI-51..53, SSI-56,
// SSI-59..61), end to end through the real `vestra` binary with the
// DETERMINISTIC FAKE `claude` and `codex` executables
// (tests/helpers/task-cli-fakes), steered by fixture flags. A coordinated run
// without the owner's extra-usage confirmation, or with a provider on an API
// key, is `not configured` before any credential, transition, worktree, or
// provider. A provider's quota signal, or credits on the Codex account,
// suspends the run in IMPLEMENTING with its worktree and completed nodes kept.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { confirmExtraUsage, extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import { DARWIN, cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
import {
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  ledger,
  logLines,
  running,
  startArguments,
  status,
  visits,
  waitFor
} from "../helpers/task-coordinated-fixture.mjs";

after(cleanupTaskFixtures);

const PLATFORM = "the governed task path runs these journeys on macOS";

function refused(result, code, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.equal(result.json?.error?.code, code, `${label}: ${result.stdout}${result.stderr}`);
  return result.json.error;
}

function notConfigured(result, requirement, label) {
  assert.equal(refused(result, "VES_TASK_NOT_CONFIGURED", label).safeDetails.requirement, requirement, label);
}

function assertNothingStarted(fixture, runId) {
  const after = status(fixture, runId);
  assert.equal(after.state, "EXECUTION_AUTHORIZED");
  assert.equal(after.checkpoints.executor, "none");
  assert.equal(after.evidence.grantId, null);
  for (const log of ["fake-claude.log", "fake-codex.log", "fake-codex-status.log"])
    assert.deepEqual(logLines(fixture, log), [], `${log} shows a provider was started`);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
}

test(
  "a coordinated run without the extra-usage confirmation is not configured before anything starts",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const fixture = await coordinatedFixture(EXECUTIONS.graph, { confirmed: false });
    const plan = await approved(fixture);
    const start = fixture.launch(startArguments(fixture, plan.runId));
    notConfigured(start, "extra-usage-confirmation", "start without a confirmation");
    assert.match(start.stderr, /paid usage beyond your plan is turned off/u);
    assert.equal(start.stdout.includes(fixture.stateRoot), false, "no machine path in the public error");
    assertNothingStarted(fixture, plan.runId);
    // why: a statement for another method is no statement for this one.
    const codex = { ...extraUsageConfirmation().providers.codex, auth: "apiKey" };
    await confirmExtraUsage(fixture.stateRoot, extraUsageConfirmation({ codex }));
    notConfigured(fixture.launch(startArguments(fixture, plan.runId)), "extra-usage-confirmation", "another method");
    assertNothingStarted(fixture, plan.runId);
  }
);

test("a coordinated run with a provider on an API key is not configured, confirmation or not", TIMEOUT, async (t) => {
  if (!DARWIN) return t.diagnostic(PLATFORM);
  const fixture = await coordinatedFixture(EXECUTIONS.agent, {
    providers: { schemaVersion: 1, providers: { codex: { auth: "api-key" } } }
  });
  const plan = await approved(fixture);
  notConfigured(fixture.launch(startArguments(fixture, plan.runId)), "coordinated-run-subscription", "API key");
  assertNothingStarted(fixture, plan.runId);
});

// why: the fakes read their flags from the fixture's private log directory.
const flag = (fixture, name) => writeFile(join(fixture.scratch, name), "");
const worktrees = (fixture) => fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length;
const QUOTA = Object.freeze({
  reason: "VES_DRIVER_QUOTA_EXHAUSTED",
  provider: "claude-code",
  scope: "five_hour",
  resetsAt: "2026-09-21T14:13:20.000Z"
});

// invariant: SSI-81. What a suspended run leaves on disk and reports names no
// session, account, purchase field, credential, or machine path.
function assertNothingPrivate(fixture, runId, texts) {
  const files = [
    readFileSync(join(fixture.stateRoot, "tasks", runId, "outcome.json"), "utf8"),
    readFileSync(join(fixture.stateRoot, "tasks", runId, "coordination", "ledger.json"), "utf8")
  ];
  for (const text of [...files, ...texts])
    for (const secret of [
      "private-session-id",
      "private-event-id",
      "out_of_credits",
      "owner@example.invalid",
      "sk-ant-oat01",
      fixture.home,
      fixture.root
    ])
      assert.equal(text.includes(secret), false, `a suspended run's record holds ${secret}`);
}

test(
  "a quota signal mid-graph suspends the run in IMPLEMENTING with its worktree and first node kept",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const fixture = await coordinatedFixture(EXECUTIONS.graph);
    const plan = await approved(fixture);
    await flag(fixture, "claude-quota");
    const start = fixture.launch(startArguments(fixture, plan.runId));
    assert.equal(start.status, 1, start.stderr);
    const suspended = start.json.data;
    assert.equal(suspended.status, "SUSPENDED");
    assert.equal(suspended.state, "IMPLEMENTING");
    assert.match(suspended.suspension.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    assert.deepEqual({ ...suspended.suspension, at: undefined }, { ...QUOTA, at: undefined });
    assert.equal(suspended.next, `vestra task resume --run-id ${plan.runId}`);
    const after = status(fixture, plan.runId);
    assert.equal(after.state, "IMPLEMENTING");
    assert.equal(after.lastOutcome, "SUSPENDED");
    assert.equal(after.activeProcess, false);
    assert.equal(after.checkpoints.executor, "suspended");
    // invariant: SSI-59. The planner completed, the writer stopped before its
    // write, and the reviewer never started.
    assert.deepEqual(visits(fixture, plan.runId), ["plan#1:completed", "build#1:failed"]);
    assert.equal(ledger(fixture, plan.runId).roundState, "running");
    assert.equal(logLines(fixture, "fake-codex-node.log").length, 1);
    assert.equal(worktrees(fixture), 2, "the suspended run's worktree was removed");
    // invariant: TM-019. The session that reported the signal did not outlive it.
    const stopped = logLines(fixture, "fake-claude.log").find((entry) => entry.quota === true).pid;
    await waitFor(() => !running(stopped), 10_000).catch(() => undefined);
    assert.equal(running(stopped), false, "the suspended node's provider is still running");
    assert.equal(after.checkpoints.budget.billing, "subscription");
    assertNothingPrivate(fixture, plan.runId, [start.stdout, JSON.stringify(after)]);
  }
);

test("Codex credits on a node's account are not configured, and the run is suspended, not lost", TIMEOUT, async (t) => {
  if (!DARWIN) return t.diagnostic(PLATFORM);
  const fixture = await coordinatedFixture(EXECUTIONS.graph);
  const plan = await approved(fixture);
  await flag(fixture, "codex-credits");
  const start = fixture.launch(startArguments(fixture, plan.runId));
  notConfigured(start, "codex-credits", "credits present");
  const after = status(fixture, plan.runId);
  assert.equal(after.state, "IMPLEMENTING");
  assert.equal(after.lastOutcome, "SUSPENDED");
  assert.equal(after.checkpoints.executor, "suspended");
  assert.deepEqual(visits(fixture, plan.runId), ["plan#1:failed"]);
  assert.deepEqual(logLines(fixture, "fake-claude.log"), [], "a node started after the credits were reported");
  const outcome = JSON.parse(readFileSync(join(fixture.stateRoot, "tasks", plan.runId, "outcome.json"), "utf8"));
  assert.deepEqual(
    { ...outcome.record.suspension, at: undefined },
    { reason: "VES_CODEX_CREDITS_PRESENT", provider: "codex", at: undefined }
  );
  assertNothingPrivate(fixture, plan.runId, [start.stdout, JSON.stringify(after)]);
});
