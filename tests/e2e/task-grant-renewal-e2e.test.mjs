// invariant: AD-079, the writer grant of a resumed run, end to end through the
// real `vestra` binary with the DETERMINISTIC FAKE `claude` and `codex`
// executables (tests/helpers/task-cli-fakes), the child's clock moved ahead
// while the run waits. A run that was interrupted, not suspended, keeps the
// grant it had: once that grant expired, the resumed run's first effect is
// refused and no new grant is issued. A suspended run whose grant would lapse
// before its remaining duration is spent is given a new grant on resume, and
// the grant marker names the one it replaced.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { DARWIN, approveArguments, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";
import {
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  logLines,
  ok,
  running,
  startArguments,
  status,
  waitFor
} from "../helpers/task-coordinated-fixture.mjs";

after(cleanupTaskFixtures);

const PLATFORM = "the governed task path runs these journeys on macOS";
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// why: the fakes read their flags from the fixture's private log directory.
const flag = (fixture, name) => writeFile(join(fixture.scratch, name), "");
const resumeArguments = (fixture, runId) => [
  "task",
  "resume",
  "--run-id",
  runId,
  ...fixture.keychainArgs,
  "--output",
  "json"
];

function grantMarker(fixture, runId) {
  return JSON.parse(readFileSync(join(fixture.stateRoot, "tasks", runId, "grant.json"), "utf8")).record;
}

async function approvedSingleSession(fixture) {
  const plan = ok(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan"
  );
  ok(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  return plan;
}

function exited(child) {
  return new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
}

// why: SIGTERM while the implementer runs leaves a run as a killed command
// does: IMPLEMENTING, no outcome, its grant issued, nothing suspended.
async function interruptedRun(t) {
  const fixture = await taskFixture();
  await flag(fixture, "fork-implementer");
  const plan = await approvedSingleSession(fixture);
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = exited(child);
  const tree = () => logLines(fixture, "fake-claude.log").find((entry) => entry.tree !== undefined)?.tree;
  // hazard: a case that fails before it signals the command would leave the
  // command and the fake's processes alive.
  t.after(() => {
    child.kill("SIGKILL");
    for (const pid of Object.values(tree() ?? {})) if (running(pid)) process.kill(pid, "SIGKILL");
  });
  await waitFor(() => tree() !== undefined);
  child.kill("SIGTERM");
  assert.deepEqual(await finished, { code: null, signal: "SIGTERM" });
  for (const pid of Object.values(tree())) await waitFor(() => !running(pid), 10_000).catch(() => undefined);
  await rm(join(fixture.scratch, "fork-implementer"));
  return { fixture, plan };
}

test(
  "an interrupted run resumed after its grant expired keeps that grant, and its first effect is refused",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const { fixture, plan } = await interruptedRun(t);
    const interrupted = status(fixture, plan.runId);
    assert.equal(interrupted.state, "IMPLEMENTING");
    assert.equal(interrupted.lastOutcome, null, "the interrupted run was suspended or ended");
    assert.match(interrupted.evidence.grantId, /^grant_/u);
    // why: the grant ended an hour and ten minutes after the start; three
    // hours later it has expired, and only a suspension would renew it.
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId), "", { clockOffsetMs: 3 * HOUR });
    assert.equal(resumed.status, 1, resumed.stderr);
    assert.equal(resumed.json.data.status, "FAILED");
    // why: the executor refuses an effect its authority does not authorize as
    // an approval that no longer holds; the approval itself is valid for days.
    assert.equal(resumed.json.data.reason, "VES_EXECUTOR_APPROVAL_INVALID");
    assert.equal(status(fixture, plan.runId).evidence.grantId, interrupted.evidence.grantId, "a new grant was issued");
    assert.deepEqual(grantMarker(fixture, plan.runId), { grantId: interrupted.evidence.grantId });
  }
);

test(
  "a suspended run whose grant would lapse before its remaining duration is renewed, and the marker names the grant replaced",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return t.diagnostic(PLATFORM);
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    await flag(fixture, "claude-quota");
    assert.equal(fixture.launch(startArguments(fixture, plan.runId)).json?.data?.status, "SUSPENDED");
    await unlink(join(fixture.scratch, "claude-quota"));
    const before = status(fixture, plan.runId).evidence.grantId;
    // why: an hour and five minutes on, the grant has five of its seventy
    // minutes left, fewer than the ten the run may still take; it has not
    // expired, so only the remaining-life rule renews it.
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId), "", { clockOffsetMs: HOUR + 5 * MINUTE });
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.state, "HUMAN_REVIEW");
    const marker = grantMarker(fixture, plan.runId);
    assert.notEqual(marker.grantId, before, "the grant was not renewed");
    assert.deepEqual(marker, { grantId: marker.grantId, replaced: [before] });
    assert.equal(status(fixture, plan.runId).evidence.grantId, marker.grantId);
  }
);
