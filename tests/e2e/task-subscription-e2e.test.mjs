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
import { rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { assertTextAgrees } from "../helpers/cli-text-fixture.mjs";
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
    // invariant: SSI-32 in the run's own result: each node's state, and no
    // node a resume could not run again on its own.
    assert.deepEqual(
      suspended.coordination.nodes.map((node) => [node.nodeId, node.state]),
      [
        ["plan", "completed"],
        ["build", "failed"],
        ["review", "pending"]
      ]
    );
    assert.deepEqual(suspended.coordination.uncertain, []);
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

const resumeArguments = (fixture, runId, ...extra) => [
  "task",
  "resume",
  "--run-id",
  runId,
  ...extra,
  ...fixture.keychainArgs,
  "--output",
  "json"
];
const HOUR = 60 * 60 * 1000;
const unflag = (fixture, name) => unlink(join(fixture.scratch, name));
const ledgerText = (fixture, runId) =>
  readFileSync(join(fixture.stateRoot, "tasks", runId, "coordination", "ledger.json"), "utf8");

function refusedFor(result, reason, label) {
  assert.equal(refused(result, "VES_TASK_FAILED", label).safeDetails.reason, reason, label);
}

// why: a run suspended by the fake Claude Code's quota signal, with the flag
// lifted again so the node it stopped can run to its end when resumed.
async function suspendedRun(execution, quotaFlag = "claude-quota") {
  const fixture = await coordinatedFixture(execution);
  const plan = await approved(fixture);
  await flag(fixture, quotaFlag);
  const start = fixture.launch(startArguments(fixture, plan.runId));
  assert.equal(start.json?.data?.status, "SUSPENDED", start.stderr);
  await unflag(fixture, quotaFlag);
  return { fixture, plan, start: start.json.data };
}

function runWorktree(fixture) {
  const listed = fixture
    .git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
  assert.equal(listed.length, 2);
  return listed[1];
}

// invariant: the spec's independent test for this story, and SSI-65, SSI-67,
// SSI-39, SSI-68. Resume without the confirmation is `not configured` and
// changes nothing; with it the completed planner is replayed with no session,
// the writer the quota stopped (no effect landed) runs again and is recorded
// so, and the run reaches review on the one ledger of the whole run.
test(
  "resume of a quota-suspended graph needs the confirmation, then skips the completed node and re-runs the stopped one",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const { fixture, plan } = await suspendedRun(EXECUTIONS.graph);
    const billing = join(fixture.stateRoot, "task-billing.json");
    await rename(billing, `${billing}.away`);
    const ledgerBefore = ledgerText(fixture, plan.runId);
    notConfigured(
      fixture.launch(resumeArguments(fixture, plan.runId)),
      "extra-usage-confirmation",
      "resume without a confirmation"
    );
    assert.equal(status(fixture, plan.runId).state, "IMPLEMENTING");
    assert.equal(ledgerText(fixture, plan.runId), ledgerBefore);
    await rename(`${billing}.away`, billing);
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId));
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.state, "HUMAN_REVIEW");
    assert.deepEqual(visits(fixture, plan.runId), [
      "plan#1:completed",
      "build#1:failed",
      "build#1:completed",
      "review#1:completed"
    ]);
    const rerun = ledger(fixture, plan.runId).visits[2];
    assert.match(rerun.rerunOf, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(
      logLines(fixture, "fake-codex-node.log").length,
      2,
      "the completed planner started a provider session again"
    );
    assert.equal(logLines(fixture, "fake-claude.log").filter((entry) => entry.argv !== undefined).length, 2);
    const after = status(fixture, plan.runId);
    assert.equal(after.suspension, null);
    assert.equal(after.lastOutcome, "HUMAN_REVIEW");
    // why: the planner's 8 tokens before the suspension, then 18 for the
    // writer, 8 for the reviewer, and 8 for the verifier: one ledger, counted once.
    assert.equal(after.checkpoints.budget.consumedTokens, 42);
    assert.equal(after.checkpoints.budget.usageEvents, 4);
    assert.equal(after.checkpoints.budget.consumedCostUsd, "not billed (subscription)");
  }
);

// invariant: SSI-66, SSI-32, and D4. A writer stopped after its write landed
// is uncertain: the start it stopped already names it and the one command
// that reconciles it, resume refuses it and changes nothing, status names it
// with the digest of its uncertainty record and that command, in text as in
// JSON, a digest that names nothing is refused, and the typed-back digest runs
// that one node again on the current worktree.
test(
  "a node suspended after its write is refused at resume until its digest is typed back, then it runs again",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const { fixture, plan, start } = await suspendedRun(EXECUTIONS.graph, "claude-quota-after-write");
    assert.deepEqual(visits(fixture, plan.runId), ["plan#1:completed", "build#1:partial"]);
    const ledgerBefore = ledgerText(fixture, plan.runId);
    const refusedResume = fixture.launch(resumeArguments(fixture, plan.runId));
    refusedFor(refusedResume, "VES_TASK_NODE_UNCERTAIN", "resume of an uncertain node");
    assert.equal(ledgerText(fixture, plan.runId), ledgerBefore);
    assert.equal(worktrees(fixture), 2);
    const suspended = status(fixture, plan.runId);
    assert.equal(suspended.state, "IMPLEMENTING");
    assert.equal(suspended.suspension.reason, "VES_DRIVER_QUOTA_EXHAUSTED");
    const [uncertain] = suspended.coordination.uncertain;
    assert.deepEqual(
      { ...uncertain, digest: undefined },
      {
        nodeId: "build",
        visit: 1,
        state: "partial",
        receiptCount: 1,
        digest: undefined
      }
    );
    const reconcile = `vestra task resume --run-id ${plan.runId} --reconcile ${uncertain.digest}`;
    assert.deepEqual(suspended.next, [reconcile, `vestra task cancel --run-id ${plan.runId}`]);
    assert.ok(refusedResume.stderr.includes(reconcile), "the refusal names the command that reconciles the node");
    assert.deepEqual({ ...suspended.suspension, at: undefined }, { ...QUOTA, at: undefined });
    assert.equal(start.next, reconcile, "the suspended start offered a resume that would be refused");
    assert.deepEqual(start.coordination, suspended.coordination);
    const text = fixture.launch(["task", "status", "--run-id", plan.runId]);
    assert.equal(text.status, 0, text.stderr);
    assertTextAgrees(text.stdout, suspended);
    refusedFor(
      fixture.launch(resumeArguments(fixture, plan.runId, "--reconcile", `sha256:${"0".repeat(64)}`)),
      "VES_TASK_RECONCILE_UNMATCHED",
      "a digest that names no node"
    );
    const reconciled = fixture.launch(resumeArguments(fixture, plan.runId, "--reconcile", uncertain.digest));
    assert.equal(reconciled.status, 0, reconciled.stderr);
    assert.equal(reconciled.json.data.state, "HUMAN_REVIEW");
    assert.deepEqual(visits(fixture, plan.runId), [
      "plan#1:completed",
      "build#1:partial",
      "build#1:completed",
      "review#1:completed"
    ]);
    assert.equal(ledger(fixture, plan.runId).visits[2].rerunOf, uncertain.digest);
    assert.equal(logLines(fixture, "fake-codex-node.log").length, 2);
  }
);

// invariant: SSI-33 and the design's resume rules, with the child's clock
// moved ahead while the run waits. A worktree changed while suspended is
// refused as drift and kept as it is; an approval that expired while suspended
// is refused; after three hours, past the writer grant but within the
// approval, the resume renews the grant against the approval it proved valid
// and the stopped writer's effect lands.
test(
  "resume refuses drift and an approval that expired while suspended, and renews a writer grant that lapsed",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const { fixture, plan } = await suspendedRun(EXECUTIONS.agent);
    const grantBefore = status(fixture, plan.runId).evidence.grantId;
    const value = join(runWorktree(fixture), "src", "value.txt");
    await writeFile(value, "drifted\n");
    refusedFor(fixture.launch(resumeArguments(fixture, plan.runId)), "VES_EXECUTOR_WORKTREE_DRIFT", "drift");
    assert.equal(readFileSync(value, "utf8"), "drifted\n", "the drifted worktree was not kept as it was");
    assert.equal(status(fixture, plan.runId).state, "IMPLEMENTING");
    await writeFile(value, "old\n");
    refusedFor(
      fixture.launch(resumeArguments(fixture, plan.runId), "", { clockOffsetMs: 8 * 24 * HOUR }),
      "VES_APPROVAL_EXPIRED",
      "an approval that expired while suspended"
    );
    assert.equal(status(fixture, plan.runId).state, "IMPLEMENTING");
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId), "", { clockOffsetMs: 3 * HOUR });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.state, "HUMAN_REVIEW");
    assert.equal(fixture.git(["show", `vestra/${plan.runId}/T1:src/value.txt`]), "new");
    assert.notEqual(status(fixture, plan.runId).evidence.grantId, grantBefore, "the lapsed grant was not renewed");
  }
);

test(
  "Codex credits that are gone at resume let the suspended run continue from the node they stopped",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const fixture = await coordinatedFixture(EXECUTIONS.graph);
    const plan = await approved(fixture);
    await flag(fixture, "codex-credits");
    notConfigured(fixture.launch(startArguments(fixture, plan.runId)), "codex-credits", "credits present");
    notConfigured(fixture.launch(resumeArguments(fixture, plan.runId)), "codex-credits", "credits still present");
    await unflag(fixture, "codex-credits");
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId));
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.state, "HUMAN_REVIEW");
    assert.deepEqual(visits(fixture, plan.runId), [
      "plan#1:failed",
      "plan#1:failed",
      "plan#1:completed",
      "build#1:completed",
      "review#1:completed"
    ]);
  }
);

test("cancel of a suspended run removes its worktree and ends it aborted", TIMEOUT, async (t) => {
  if (!DARWIN) return t.diagnostic(PLATFORM);
  const { fixture, plan } = await suspendedRun(EXECUTIONS.graph);
  assert.equal(worktrees(fixture), 2);
  const cancelled = fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(status(fixture, plan.runId).state, "ABORTED");
  assert.equal(status(fixture, plan.runId).suspension, null);
  assert.equal(worktrees(fixture), 1);
});
