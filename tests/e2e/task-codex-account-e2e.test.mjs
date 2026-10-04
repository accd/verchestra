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
import { unlink, writeFile } from "node:fs/promises";
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

after(cleanupTaskFixtures);

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

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
    const start = fixture.launch(startArguments(fixture, plan.runId));
    assert.notEqual(start.status, 0, start.stdout);
    assert.equal(start.json?.error?.code, "VES_TASK_NOT_CONFIGURED", `${start.stdout}${start.stderr}`);
    assert.deepEqual(start.json.error.safeDetails, { requirement: "codex-credits" });
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

test(
  "a statement naming another plan type than the Codex login's is not configured before anything starts",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    const codex = { ...extraUsageConfirmation().providers.codex, planType: "pro" };
    await confirmExtraUsage(fixture.stateRoot, extraUsageConfirmation({ codex }));
    const start = fixture.launch(startArguments(fixture, plan.runId));
    assert.notEqual(start.status, 0, start.stdout);
    assert.equal(start.json?.error?.code, "VES_TASK_NOT_CONFIGURED", `${start.stdout}${start.stderr}`);
    assert.deepEqual(start.json.error.safeDetails, { requirement: "extra-usage-confirmation" });
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
