// invariant: subscriptions only (SSI-51..53), end to end through the real
// `vestra` binary with the DETERMINISTIC FAKE `claude` and `codex` executables
// (tests/helpers/task-cli-fakes). A coordinated run without the owner's
// extra-usage confirmation, or with a provider on an API key, is `not
// configured` before any credential, transition, worktree, or provider.
import assert from "node:assert/strict";
import { after, test } from "node:test";

import { confirmExtraUsage, extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import { DARWIN, cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
import {
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  logLines,
  startArguments,
  status
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
