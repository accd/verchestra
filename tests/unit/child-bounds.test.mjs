// invariant: ARQ-003 (#597). A child process outside a provider session runs
// to a bound and is killed with SIGKILL past it, and the timeout is told apart
// from every other way a child fails, so each caller can map it to a named
// code instead of reading it as an answer.
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import {
  GIT_CHILD_BOUND,
  INSPECTION_CHILD_BOUND,
  childTimedOut
} from "../../packages/application/src/execution/child-bounds.ts";
import { publicError } from "../../apps/vestra-cli/src/task/task-public-error.ts";
import { probeDriverVersion, providerVersion } from "../../packages/drivers/src/driver-version-probe.ts";
import { GitTimeoutError, runGit, runGitBytes } from "../../packages/platform-node/src/task-worktree.ts";

const execFileAsync = promisify(execFile);
const SHORT = Object.freeze({ timeout: 300, killSignal: "SIGKILL" });
const HANG = "setTimeout(() => {}, 60_000)";
// why: a bound that is dropped leaves the child running, so each test that
// starts one has its own timeout and fails instead of hanging the suite.

async function failure(start) {
  try {
    await start();
  } catch (error) {
    return error;
  }
  assert.fail("the child was expected to fail");
}

async function elapsed(start) {
  const began = Date.now();
  const error = await failure(start);
  return { error, ms: Date.now() - began };
}

test("every bound kills with SIGKILL, and task-path git may run longer than an inspection", () => {
  for (const bound of [GIT_CHILD_BOUND, INSPECTION_CHILD_BOUND]) {
    assert.equal(bound.killSignal, "SIGKILL");
    assert.ok(Number.isSafeInteger(bound.timeout) && bound.timeout > 0);
    assert.ok(Object.isFrozen(bound));
  }
  assert.equal(INSPECTION_CHILD_BOUND.timeout, 60_000);
  assert.equal(GIT_CHILD_BOUND.timeout, 600_000);
});

test("a child that outlives its bound is killed and reads as timed out", { timeout: 30_000 }, async () => {
  const { error, ms } = await elapsed(() => execFileAsync(process.execPath, ["-e", HANG], SHORT));
  assert.equal(childTimedOut(error), true);
  assert.ok(ms < 10_000, `the child ran ${ms}ms past a 300ms bound`);
  // why: the scanner and check-ignore read exit status 1 as "no match", so a
  // timed-out child must carry no exit status for a timeout to fail instead.
  assert.notEqual(error.code, 1);
  assert.equal(typeof error.code === "number", false);
  let sync;
  try {
    execFileSync(process.execPath, ["-e", HANG], { ...SHORT, stdio: "pipe" });
  } catch (caught) {
    sync = caught;
  }
  assert.equal(childTimedOut(sync), true);
});

test("an exit status, an output overflow, and a missing executable are not timeouts", async () => {
  const exited = await failure(() => execFileAsync(process.execPath, ["-e", "process.exit(1)"], { timeout: 30_000 }));
  assert.equal(exited.code, 1);
  const overflowed = await failure(() =>
    execFileAsync(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], {
      maxBuffer: 16,
      timeout: 30_000
    })
  );
  assert.equal(overflowed.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
  const missing = await failure(() =>
    execFileAsync(join(tmpdir(), "no-such-verchestra-child"), [], { timeout: 30_000 })
  );
  for (const error of [exited, overflowed, missing]) assert.equal(childTimedOut(error), false);
  for (const value of [undefined, null, "text", new Error("plain")]) assert.equal(childTimedOut(value), false);
});

test(
  "task-path git past its bound fails with VES_GIT_TIMEOUT, which a task command names",
  { timeout: 30_000 },
  async (t) => {
    const repository = await mkdtemp(join(tmpdir(), "ves-git-bound-"));
    t.after(() => rm(repository, { recursive: true, force: true }));
    await runGit(repository, ["init", "--quiet"]);
    // why: `hash-object --stdin` waits for the end of a stdin that execFile
    // never closes, so this is a real git that never answers.
    for (const start of [
      () => runGit(repository, ["hash-object", "--stdin"], undefined, SHORT),
      () => runGitBytes(repository, ["hash-object", "--stdin"], 1024, SHORT)
    ]) {
      const { error, ms } = await elapsed(start);
      assert.ok(error instanceof GitTimeoutError, String(error));
      assert.equal(error.code, "VES_GIT_TIMEOUT");
      assert.equal(childTimedOut(error.cause), true);
      assert.ok(ms < 10_000, `git ran ${ms}ms past a 300ms bound`);
    }
    const refused = await failure(() => runGit(repository, ["no-such-git-command"]));
    assert.equal(refused instanceof GitTimeoutError, false);
    const shown = publicError(new GitTimeoutError()).envelope;
    assert.equal(shown.code, "VES_TASK_FAILED");
    assert.equal(shown.safeDetails.reason, "VES_GIT_TIMEOUT");
  }
);

test("a provider version probe past its bound reports the provider unavailable", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ves-probe-bound-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hang = join(directory, "hang.mjs");
  await writeFile(hang, `${HANG};\n`);
  const profile = { identity: { driverId: "fake" }, errorCodePrefix: "VES_FAKE", noun: "Fake", capabilities: [] };
  const requirement = { exact: "1.0.0" };
  const began = Date.now();
  const report = await probeDriverVersion(profile, requirement, () =>
    providerVersion([process.execPath, hang], { env: process.env }, SHORT)
  );
  assert.equal(report.available, false);
  assert.equal(report.error.code, "VES_FAKE_NOT_AVAILABLE");
  assert.ok(Date.now() - began < 10_000, "the probe outlived its bound");
  const answer = join(directory, "answer.mjs");
  await writeFile(answer, `process.stdout.write("1.0.0");\n`);
  const answered = await probeDriverVersion(profile, requirement, () =>
    providerVersion([process.execPath, answer], { env: process.env })
  );
  assert.equal(answered.available, true);
});
