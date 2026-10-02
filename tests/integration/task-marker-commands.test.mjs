// invariant: what the task commands do with a marker that does not verify.
// A sealed Run's grant, worktree, and outcome markers fail a command closed.
// Its active marker counts as a driver nobody can name: `status` reports the
// run as driven and `cancel` asks it to stop, waits as it waits for a live
// process, and then ends the run itself, so a user can always stop a run. A
// marker that verifies and names a live process is never cleared. A legacy
// Run behaves as it did before the markers were sealed. The commands run in
// this process on a real Workspace; the cancel wait is advanced with the test
// runner's mock timers, so no case sleeps through it.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { reviewTask } from "../../apps/vestra-cli/src/task/task-review.ts";
import { cancelTask, statusTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";
import { cleanupTaskCommandFixtures, refusedState, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { GRANT_ID, RUN_ID, filled, planRecord, sealedText } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

const RUN = Object.freeze({ runId: RUN_ID });
const CANCEL = `vestra task cancel --run-id ${RUN_ID}`;
const DEAD_PID = Number.MAX_SAFE_INTEGER;
const FORMS = Object.freeze({ legacy: {}, sealed: { markerSeal: 1 } });

async function planned(form, state = "IMPLEMENTING", overrides = {}) {
  const fixture = await taskCommandFixture();
  const run = await fixture.planned(state, planRecord({ ...FORMS[form], ...overrides }));
  const file = (name) => join(run.directory, name);
  return { fixture, ...run, file, text: (name) => readFile(file(name), "utf8") };
}

// why: an edit that keeps the seal envelope and the record's shape, so only
// the digest can tell.
async function edit(run, name, change) {
  const stored = JSON.parse(await run.text(name));
  await writeFile(run.file(name), JSON.stringify({ digest: stored.digest, record: { ...stored.record, ...change } }));
}

// why: `cancel` waits up to a minute for a driver to stop. The mock clock is
// advanced one poll at a time, and each turn of the event loop lets the
// command's own file reads finish, so the wait elapses without being slept.
async function elapsing(t, command) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  let settled = false;
  const outcome = command().finally(() => (settled = true));
  outcome.catch(() => undefined);
  while (!settled) {
    t.mock.timers.tick(200);
    await new Promise((resolve) => setImmediate(resolve));
  }
  t.mock.timers.reset();
  return outcome;
}

function isSealed(text) {
  const stored = JSON.parse(text);
  return Object.keys(stored).join(",") === "digest,record" && text === sealedText(stored.record);
}

test("status reports a sealed Run whose active marker was edited as driven, and offers only cancel", async () => {
  const run = await planned("sealed");
  await run.runRecord.claimActive(process.pid);
  await edit(run, "active.json", { pid: DEAD_PID });
  const status = await statusTask(run.fixture.io, RUN);
  assert.equal(status.activeProcess, true);
  assert.deepEqual(status.next, [CANCEL]);
});

test("cancel ends a sealed Run whose active marker does not verify: it asks, waits, clears the marker, and aborts", async (t) => {
  const run = await planned("sealed");
  await run.runRecord.claimActive(process.pid);
  await edit(run, "active.json", { pid: DEAD_PID });
  const result = await elapsing(t, () => cancelTask(run.fixture.io, RUN));
  assert.deepEqual(result, { runId: RUN_ID, state: "ABORTED", cancelRequested: true, stopped: true });
  assert.equal(run.fixture.state(), "ABORTED");
  assert.equal(existsSync(run.file("active.json")), false, "the marker that did not verify was left behind");
  assert.equal(isSealed(await run.text("cancel.json")), true, "the request was not written in the sealed form");
  assert.equal(await run.runRecord.activeProcess(), undefined);
});

test("cancel ends a sealed Run whose active marker was replaced by a plain one naming a dead process", async (t) => {
  const run = await planned("sealed");
  await writeFile(run.file("active.json"), `${JSON.stringify({ pid: DEAD_PID })}\n`);
  const result = await elapsing(t, () => cancelTask(run.fixture.io, RUN));
  assert.equal(result.state, "ABORTED");
  assert.equal(result.stopped, true);
  assert.equal(existsSync(run.file("active.json")), false);
});

// invariant: a marker that verifies and names a live process is the driver.
// `cancel` asks it to stop and reports what happened; it never clears the
// marker or aborts the run under it.
for (const form of Object.keys(FORMS)) {
  test(`cancel never aborts a ${form} Run under a live driver that has not stopped`, async (t) => {
    const run = await planned(form);
    await run.runRecord.claimActive(process.pid);
    const marker = await run.text("active.json");
    const result = await elapsing(t, () => cancelTask(run.fixture.io, RUN));
    assert.deepEqual(result, { runId: RUN_ID, state: "IMPLEMENTING", cancelRequested: true, stopped: false });
    assert.equal(run.fixture.state(), "IMPLEMENTING");
    assert.equal(await run.text("active.json"), marker, "the live driver's marker was touched");
    assert.equal(isSealed(await run.text("cancel.json")), form === "sealed");
  });

  test(`cancel of a ${form} Run reports a driver that stopped once it released its marker`, async (t) => {
    const run = await planned(form);
    await run.runRecord.claimActive(process.pid);
    const driver = setInterval(() => {
      if (existsSync(run.file("cancel.json"))) void run.runRecord.releaseActive();
    }, 10);
    t.after(() => clearInterval(driver));
    const result = await cancelTask(run.fixture.io, RUN);
    assert.equal(result.stopped, true);
    assert.equal(result.state, "IMPLEMENTING", "cancel aborted a run its driver was answering for");
  });
}

test("cancel of a legacy Run whose active marker cannot be read ends the run at once, as before", async () => {
  for (const content of ["{not json", `${JSON.stringify({ pid: DEAD_PID })}\n`, sealedText({ pid: process.pid })]) {
    const run = await planned("legacy");
    await writeFile(run.file("active.json"), content);
    assert.equal((await statusTask(run.fixture.io, RUN)).activeProcess, false, content);
    const result = await cancelTask(run.fixture.io, RUN);
    assert.deepEqual(result, { runId: RUN_ID, state: "ABORTED", cancelRequested: true, stopped: true }, content);
    assert.equal(existsSync(run.file("cancel.json")), false, "an idle cancel wrote a request");
  }
});

test("an idle cancel of a sealed Run still stops before the abort when its worktree marker does not verify", async () => {
  const run = await planned("sealed");
  await run.runRecord.saveWorktreeRef(`worktree:${"a".repeat(32)}:${"b".repeat(40)}`);
  await edit(run, "worktree.json", { worktreeRef: `worktree:${"c".repeat(32)}:${"b".repeat(40)}` });
  await assert.rejects(cancelTask(run.fixture.io, RUN), refusedState("VES_TASK_STATE_TAMPERED"));
  assert.equal(run.fixture.state(), "IMPLEMENTING");
});

test("status fails closed on a sealed Run's grant or outcome marker that does not verify", async () => {
  const grant = await planned("sealed");
  await grant.runRecord.saveGrant(GRANT_ID);
  assert.equal((await statusTask(grant.fixture.io, RUN)).evidence.grantId, GRANT_ID);
  await edit(grant, "grant.json", { grantId: "grant_018f0b6d-7b1a-7abc-8def-999999999999" });
  await assert.rejects(statusTask(grant.fixture.io, RUN), refusedState("VES_TASK_STATE_TAMPERED"));
  await writeFile(grant.file("grant.json"), `${JSON.stringify({ grantId: GRANT_ID })}\n`);
  await assert.rejects(statusTask(grant.fixture.io, RUN), refusedState("VES_TASK_STATE_MALFORMED"), "a plain marker");

  const outcome = await planned("sealed");
  await outcome.runRecord.saveOutcome({ status: "FAILED", reason: "VES_EXECUTOR_CANCELLED" });
  assert.equal((await statusTask(outcome.fixture.io, RUN)).lastOutcome, "FAILED");
  await edit(outcome, "outcome.json", { status: "HUMAN_REVIEW" });
  await assert.rejects(statusTask(outcome.fixture.io, RUN), refusedState("VES_TASK_STATE_TAMPERED"));

  const legacy = await planned("legacy");
  await writeFile(legacy.file("grant.json"), `${JSON.stringify({ grantId: GRANT_ID })}\n`);
  assert.equal((await statusTask(legacy.fixture.io, RUN)).evidence.grantId, GRANT_ID, "a legacy Run reads it");
});

// invariant: the Run Capsule binds the grant marker, so `review` reads it
// before it records anything. With no task commit record a review that gets
// past the marker stops at the review surface; that code is the proof.
test("review refuses a grant marker that does not verify before it records anything", async () => {
  const pkg = await executionHarness().builder.build(packageInput());
  const bound = { packageId: pkg.artifactId, packageDigest: `sha256:${pkg.payloadDigest}` };
  const run = await planned("sealed", "HUMAN_REVIEW", bound);
  await run.runRecord.savePackage(pkg);
  await run.runRecord.saveGrant(GRANT_ID);
  const review = () =>
    reviewTask(run.fixture.io, { ...RUN, outcome: "accepted", surfaceDigest: filled("0"), confirmStdin: false });
  await assert.rejects(review(), refusedState("VES_TASK_REVIEW_UNAVAILABLE"), "the marker as it was written");
  await edit(run, "grant.json", { grantId: "grant_018f0b6d-7b1a-7abc-8def-999999999999" });
  await assert.rejects(review(), refusedState("VES_TASK_STATE_TAMPERED"));
  assert.equal(run.fixture.state(), "HUMAN_REVIEW");
  assert.equal(existsSync(run.file("review.json")), false);
});
