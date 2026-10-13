// invariant: a run that fails says why, end to end through the real `vestra`
// binary with the DETERMINISTIC FAKE `claude` and `codex` executables
// (tests/helpers/task-cli-fakes), steered by fixture flags. The cause the
// driver reported, a stable code, is the run's recorded reason: in the data
// `start` prints and in `status.lastReason`, for the verifier of a run, for a
// Codex node, and for a Claude Code node. The public error code is not
// promoted: it stays `VES_TASK_FAILED`, and the catalog stays as it was. Every
// case runs on macOS, Linux, and Windows.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

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

// why: the fakes read their flags from the fixture's private log directory.
const flag = (fixture, name) => writeFile(join(fixture.scratch, name), "");

async function failedRun(execution, flagName) {
  const fixture = await coordinatedFixture(execution);
  const plan = await approved(fixture);
  await flag(fixture, flagName);
  const run = fixture.launch(startArguments(fixture, plan.runId));
  assert.equal(run.status, 1, `${run.stderr}\n${run.stdout}`);
  assert.equal(run.json.data.status, "FAILED");
  return { fixture, plan, run };
}

test("a verifier whose model the account does not offer fails the run with that cause", TIMEOUT, async () => {
  const { fixture, plan, run } = await failedRun(EXECUTIONS.agent, "codex-model-missing");
  assert.equal(run.json.data.reason, "VES_CODEX_MODEL_UNAVAILABLE");
  const after = status(fixture, plan.runId);
  assert.equal(after.state, "FAILED");
  assert.equal(after.lastOutcome, "FAILED");
  assert.equal(after.lastReason, "VES_CODEX_MODEL_UNAVAILABLE");
  assert.equal(after.evidence.verificationVerdict, null);
  assert.deepEqual(logLines(fixture, "fake-codex-turn.log"), [], "the verifier opened a turn");
});

test("a Codex node whose model the account does not offer fails the run with that cause", TIMEOUT, async () => {
  const { fixture, plan, run } = await failedRun(EXECUTIONS.graph, "codex-model-missing");
  assert.equal(run.json.data.reason, "VES_CODEX_MODEL_UNAVAILABLE");
  assert.equal(status(fixture, plan.runId).lastReason, "VES_CODEX_MODEL_UNAVAILABLE");
  assert.deepEqual(visits(fixture, plan.runId), ["plan#1:failed"], "no node that follows it started");
});

test("a Claude Code node whose turn failed fails the run with the driver's code", TIMEOUT, async () => {
  const { fixture, plan, run } = await failedRun(EXECUTIONS.agent, "claude-error");
  assert.equal(run.json.data.reason, "VES_CLAUDE_EXECUTION_FAILED");
  const after = status(fixture, plan.runId);
  assert.equal(after.lastReason, "VES_CLAUDE_EXECUTION_FAILED");
  // why: the node's write landed before its turn failed, so its visit is partial.
  assert.deepEqual(visits(fixture, plan.runId), ["build#1:partial"]);
  assert.deepEqual(logLines(fixture, "fake-codex.log"), [], "the verifier was never asked");
});
