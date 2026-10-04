// invariant: the Codex account of a coordinated run (D3b, SSI-52), end to end
// through the real `vestra` binary with the DETERMINISTIC FAKE `claude` and
// `codex` executables (tests/helpers/task-cli-fakes), steered by fixture
// flags. Before the first transition the run reads its Codex login's plan
// type, and one the owner's statement does not name is `not configured`. The
// verifier of an `agent` run, whose only Codex session it is, proves its
// account before its turn: credits on the account are `not configured` and an
// exhausted allowance suspends the run, in VERIFYING with its task commit
// kept, and a resume once the account is clear verifies it. Every case runs on
// macOS, Linux, and Windows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { confirmExtraUsage, extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import { cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
import {
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  logLines,
  startArguments,
  status,
  visits
} from "../helpers/task-coordinated-fixture.mjs";
import { sealedText } from "../helpers/task-run-record-fixture.mjs";

after(cleanupTaskFixtures);

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const HOUR = 60 * 60 * 1000;

function refusedAs(result, code, safeDetails) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.json?.error?.code, code, `${result.stdout}${result.stderr}`);
  assert.deepEqual(result.json.error.safeDetails, safeDetails);
}

// why: a record spells a Windows path with its separators escaped, so a path
// is looked for as written and as JSON writes it.
const spellings = (path) => [path, JSON.stringify(path).slice(1, -1)];
// why: the fakes read their flags from the fixture's private log directory.
const flag = (fixture, name) => writeFile(join(fixture.scratch, name), "");
const unflag = (fixture, name) => unlink(join(fixture.scratch, name));
const resumeArguments = (fixture, runId) => [
  "task",
  "resume",
  "--run-id",
  runId,
  ...fixture.keychainArgs,
  "--output",
  "json"
];

function outcomeRecord(fixture, runId) {
  return JSON.parse(readFileSync(join(fixture.stateRoot, "tasks", runId, "outcome.json"), "utf8")).record;
}

// invariant: the run the verifier stopped: implemented and committed, its one
// node completed, waiting in VERIFYING with no process, and no verifier turn
// was opened.
function assertStoppedAtVerification(fixture, runId) {
  const after = status(fixture, runId);
  assert.equal(after.state, "VERIFYING");
  assert.equal(after.lastOutcome, "SUSPENDED");
  assert.equal(after.activeProcess, false);
  assert.match(after.evidence.commitId, /^[a-f0-9]{40,64}$/u);
  assert.equal(after.evidence.verificationVerdict, null);
  assert.deepEqual(after.next, [`vestra task resume --run-id ${runId}`, `vestra task cancel --run-id ${runId}`]);
  assert.deepEqual(visits(fixture, runId), ["build#1:completed"]);
  assert.deepEqual(logLines(fixture, "fake-codex-turn.log"), [], "the verifier opened a turn");
  return after;
}

test(
  "Codex credits seen by the verifier of an agent run are not configured, and the run waits in VERIFYING",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    await flag(fixture, "codex-credits");
    refusedAs(fixture.launch(startArguments(fixture, plan.runId)), "VES_TASK_NOT_CONFIGURED", {
      requirement: "codex-credits"
    });
    const after = assertStoppedAtVerification(fixture, plan.runId);
    assert.deepEqual(
      { ...after.suspension, at: undefined },
      { reason: "VES_CODEX_CREDITS_PRESENT", provider: "codex", at: undefined }
    );
    assert.match(after.suspension.at, INSTANT);
    assert.deepEqual(outcomeRecord(fixture, plan.runId).suspension, after.suspension);
    for (const secret of ["owner@example.invalid", "25.00", ...spellings(fixture.home), ...spellings(fixture.root)])
      assert.equal(JSON.stringify(outcomeRecord(fixture, plan.runId)).includes(secret), false, secret);

    await unflag(fixture, "codex-credits");
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId));
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.state, "HUMAN_REVIEW");
    assert.deepEqual(
      logLines(fixture, "fake-codex-turn.log").map((entry) => entry.accountChecked),
      [true],
      "the resumed verifier did not prove its account before its turn"
    );
    assert.equal(status(fixture, plan.runId).suspension, null);
  }
);

test("an exhausted Codex allowance suspends an agent run at its verifier instead of failing it", TIMEOUT, async () => {
  const fixture = await coordinatedFixture(EXECUTIONS.agent);
  const plan = await approved(fixture);
  await flag(fixture, "codex-quota");
  const start = fixture.launch(startArguments(fixture, plan.runId));
  assert.equal(start.status, 1, start.stderr);
  const suspended = start.json.data;
  assert.equal(suspended.status, "SUSPENDED");
  assert.equal(suspended.state, "VERIFYING");
  assert.equal(suspended.next, `vestra task resume --run-id ${plan.runId}`);
  // why: the fake's five-hour window is used up and resets at 1_790_000_000 s.
  assert.deepEqual(
    { ...suspended.suspension, at: undefined },
    {
      reason: "VES_DRIVER_QUOTA_EXHAUSTED",
      provider: "codex",
      scope: "ordinary_usage_disallowed",
      resetsAt: "2026-09-21T14:13:20.000Z",
      at: undefined
    }
  );
  assert.deepEqual(assertStoppedAtVerification(fixture, plan.runId).suspension, suspended.suspension);
});

// invariant: SSI-33 for a run suspended at its verifier. Its resume proves what
// a node suspension's does before the verifier starts: the owner's billing
// statement, the approval against the policy in force, and what the run left,
// here its task commit under its anchored branch, recorded on the plan's
// revision and with that revision as its only parent. Each refusal leaves the
// run in VERIFYING with its suspension, and once all hold it verifies and
// reaches review.
test(
  "a run suspended at its verifier resumes only on its statement, a valid approval, and the commit it left",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    await flag(fixture, "codex-quota");
    assert.equal(fixture.launch(startArguments(fixture, plan.runId)).json?.data?.state, "VERIFYING");
    await unflag(fixture, "codex-quota");
    const { evidence } = assertStoppedAtVerification(fixture, plan.runId);
    const ref = `refs/heads/${evidence.branch}`;
    const base = fixture.git(["rev-parse", `${evidence.commitId}^`]);
    const stillSuspended = (label) => {
      const after = status(fixture, plan.runId);
      assert.deepEqual([after.state, after.lastOutcome], ["VERIFYING", "SUSPENDED"], label);
      assert.deepEqual(logLines(fixture, "fake-codex-turn.log"), [], `${label}: the verifier opened a turn`);
    };

    const billing = join(fixture.stateRoot, "task-billing.json");
    await rename(billing, `${billing}.away`);
    refusedAs(fixture.launch(resumeArguments(fixture, plan.runId)), "VES_TASK_NOT_CONFIGURED", {
      requirement: "extra-usage-confirmation"
    });
    stillSuspended("no statement");
    await rename(`${billing}.away`, billing);

    refusedAs(
      fixture.launch(resumeArguments(fixture, plan.runId), "", { clockOffsetMs: 8 * 24 * HOUR }),
      "VES_TASK_FAILED",
      { reason: "VES_APPROVAL_EXPIRED" }
    );
    stillSuspended("an approval that expired while suspended");

    for (const [label, move, restore] of [
      ["a branch moved to the base", ["update-ref", ref, base], ["update-ref", ref, evidence.commitId]],
      ["a branch deleted", ["update-ref", "-d", ref], ["update-ref", ref, evidence.commitId]]
    ]) {
      fixture.git(move);
      refusedAs(fixture.launch(resumeArguments(fixture, plan.runId)), "VES_TASK_FAILED", {
        reason: "VES_TASK_COMMIT_DRIFT"
      });
      stillSuspended(label);
      fixture.git(restore);
    }

    // why: the branch anchors the commit the record names in both cases, so
    // only the record's base and the commit's parent can refuse them.
    const commitRecord = join(fixture.stateRoot, "tasks", plan.runId, "commit.json");
    const recorded = await readFile(commitRecord, "utf8");
    const child = fixture.git([
      "commit-tree",
      fixture.git(["rev-parse", `${evidence.commitId}^{tree}`]),
      "-p",
      evidence.commitId,
      "-m",
      "a commit on top of the task commit"
    ]);
    const { record } = JSON.parse(recorded);
    for (const [label, rewritten] of [
      ["a recorded commit whose parent is not the base", { ...record, commitId: child }],
      ["a recorded commit on another base", { ...record, commitId: child, baseCommit: evidence.commitId }]
    ]) {
      await writeFile(commitRecord, sealedText(rewritten));
      fixture.git(["update-ref", ref, child]);
      refusedAs(fixture.launch(resumeArguments(fixture, plan.runId)), "VES_TASK_FAILED", {
        reason: "VES_TASK_COMMIT_DRIFT"
      });
      stillSuspended(label);
      await writeFile(commitRecord, recorded);
      fixture.git(["update-ref", ref, evidence.commitId]);
    }

    const resumed = fixture.launch(resumeArguments(fixture, plan.runId));
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.state, "HUMAN_REVIEW");
    assert.equal(fixture.git(["rev-parse", ref]), evidence.commitId);
  }
);

test(
  "a statement naming another plan type than the Codex login's is not configured before anything starts",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    const codex = { ...extraUsageConfirmation().providers.codex, planType: "pro" };
    await confirmExtraUsage(fixture.stateRoot, extraUsageConfirmation({ codex }));
    const start = fixture.launch(startArguments(fixture, plan.runId));
    refusedAs(start, "VES_TASK_NOT_CONFIGURED", { requirement: "extra-usage-confirmation" });
    assert.match(start.stderr, /Codex reports the plan type plus .* names pro/u);
    assert.equal(start.stderr.includes("owner@example.invalid"), false, "the account's e-mail address was shown");
    const after = status(fixture, plan.runId);
    assert.equal(after.state, "EXECUTION_AUTHORIZED");
    assert.equal(after.checkpoints.executor, "none");
    assert.equal(after.evidence.grantId, null);
    assert.equal(after.activeProcess, false);
    for (const log of ["fake-claude.log", "fake-codex.log", "fake-codex-turn.log"])
      assert.deepEqual(logLines(fixture, log), [], `${log} shows a provider session was started`);
    assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);

    await confirmExtraUsage(fixture.stateRoot);
    const confirmed = fixture.launch(startArguments(fixture, plan.runId));
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.equal(confirmed.json.data.state, "HUMAN_REVIEW");
  }
);
