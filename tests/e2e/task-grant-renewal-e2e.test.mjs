// invariant: AD-079, the writer grant of a resumed run, end to end through the
// real `vestra` binary with the DETERMINISTIC FAKE `claude` and `codex`
// executables (tests/helpers/task-cli-fakes), the child's clock moved ahead
// while the run waits. A run that was interrupted, not suspended, keeps the
// grant it had: once that grant expired, the resumed run's first effect is
// refused and no new grant is issued. A suspended run whose grant would lapse
// before its remaining duration is spent is given a new grant on resume, and
// the grant marker names the one it replaced, unless that grant was revoked.
// Every case runs on macOS, Linux, and Windows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
import {
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  logLines,
  running,
  startArguments,
  status,
  waitFor
} from "../helpers/task-coordinated-fixture.mjs";

after(cleanupTaskFixtures);

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// why: the fakes read their flags from the fixture's private log directory.
const flag = (fixture, name) => writeFile(join(fixture.scratch, name), "");
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

function grantMarker(fixture, runId) {
  return JSON.parse(readFileSync(join(fixture.stateRoot, "tasks", runId, "grant.json"), "utf8")).record;
}

// why: a run whose driving process is killed while a reader node runs is
// interrupted, not suspended: IMPLEMENTING, its grant issued, the node's visit
// durable as started. The orphaned provider is ended as an owner would.
async function interruptedRun(t) {
  const fixture = await coordinatedFixture(EXECUTIONS.graph);
  const plan = await approved(fixture);
  const hangFlag = join(fixture.scratch, "codex-node-hang");
  await writeFile(hangFlag, "");
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = new Promise((resolve) => child.once("close", resolve));
  const hung = () => logLines(fixture, "fake-codex-node.log").find((entry) => entry.hang === true)?.pid;
  t.after(() => {
    child.kill("SIGKILL");
    const pid = hung();
    if (pid !== undefined && running(pid)) process.kill(pid, "SIGKILL");
  });
  await waitFor(() => hung() !== undefined);
  child.kill("SIGKILL");
  await finished;
  try {
    process.kill(hung(), "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await waitFor(() => !running(hung()), 10_000);
  await unlink(hangFlag);
  return { fixture, plan };
}

test(
  "an interrupted run resumed after its grant expired keeps that grant, and its first effect is refused",
  TIMEOUT,
  async (t) => {
    const { fixture, plan } = await interruptedRun(t);
    const interrupted = status(fixture, plan.runId);
    assert.equal(interrupted.state, "IMPLEMENTING");
    assert.equal(interrupted.lastOutcome, null, "the interrupted run was suspended or ended");
    assert.match(interrupted.evidence.grantId, /^grant_/u);
    const [uncertain] = interrupted.coordination.uncertain;
    // why: the grant ended an hour and ten minutes after the start; three
    // hours later it has expired, and only a suspension would renew it. The
    // reconciled reader runs again, then the writer's first effect is refused.
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId, "--reconcile", uncertain.digest), "", {
      clockOffsetMs: 3 * HOUR
    });
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
  async () => {
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

// invariant: AD-082 item 5 at the composition. The stored grant the renewal
// decision is handed carries its revocation: a suspended run whose grant was
// revoked while it waited is not given a new one on resume, even when that
// grant would lapse first, so its first effect is refused.
test(
  "a suspended run whose grant was revoked while it waited is not renewed, and its first effect is refused",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    await flag(fixture, "claude-quota");
    assert.equal(fixture.launch(startArguments(fixture, plan.runId)).json?.data?.status, "SUSPENDED");
    await unlink(join(fixture.scratch, "claude-quota"));
    const before = status(fixture, plan.runId).evidence.grantId;
    const store = new RuntimeStore({ dbPath: join(fixture.stateRoot, "runtime", "runtime.sqlite"), timeoutMs: 5_000 });
    store.open();
    try {
      assert.equal(store.revokeAuthorityGrant(before, new Date().toISOString(), "owner-withdrew"), true);
    } finally {
      store.close();
    }
    // why: as in the renewal case above, the grant has five of its seventy
    // minutes left, fewer than the ten the run may still take, so only its
    // revocation keeps it from being renewed.
    const resumed = fixture.launch(resumeArguments(fixture, plan.runId), "", { clockOffsetMs: HOUR + 5 * MINUTE });
    assert.equal(resumed.status, 1, resumed.stderr);
    assert.equal(resumed.json.data.status, "FAILED");
    assert.equal(resumed.json.data.reason, "VES_EXECUTOR_APPROVAL_INVALID");
    assert.deepEqual(grantMarker(fixture, plan.runId), { grantId: before }, "a new grant was issued");
    assert.equal(status(fixture, plan.runId).evidence.grantId, before);
  }
);
