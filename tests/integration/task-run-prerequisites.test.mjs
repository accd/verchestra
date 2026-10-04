// invariant: SSI-73 on the task path, in order. `start` and `resume` prove the
// Windows prerequisites after they read the plan record, the approved
// package, the provider modes, and, for a coordinated run, the owner's billing
// statement, and before any credential, the active-process claim, the writer
// lease, a transition, or a worktree; either mediated Claude Code profile is
// refused under a managed policy. A DETERMINISTIC FAKE host stands in for the
// Windows machine, so the order is observed on every platform. The commands
// run in this process on a real Workspace; the deny guard of the fixture stops
// any case at its first credential read.
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { runTask } from "../../apps/vestra-cli/src/task/task-run.ts";
import { openRuntime } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { confirmExtraUsage } from "../helpers/task-billing-fixture.mjs";
import { cleanupTaskCommandFixtures, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { boundPlanRecord } from "../helpers/task-plan-fixture.mjs";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";
import { RUN_ID, TASK_ID, WORKSPACE_ID, taskRequest } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

const COMMANDS = Object.freeze([
  ["start", "EXECUTION_AUTHORIZED", false],
  ["resume", "IMPLEMENTING", true]
]);

function coordinatedRequest() {
  const request = validTaskRequestV2("agent");
  return normalizeTaskRequest({ ...request, task: { ...request.task, taskId: TASK_ID } });
}

async function boundRun(state, request = taskRequest()) {
  const fixture = await taskCommandFixture();
  const { record, pkg } = await boundPlanRecord(request);
  const run = await fixture.planned(state, record);
  await run.runRecord.savePackage(pkg);
  return { fixture, run };
}

// why: releasing the lease as an owner that never held one answers false when
// no writer lease is held and refuses when the run holds it.
function writerLeaseHeld(runtime) {
  try {
    return runtime.releaseLease(WORKSPACE_ID, "observer:prerequisites");
  } catch {
    return true;
  }
}

function worktreeCount(root) {
  return existsSync(root) ? readdirSync(root).length : 0;
}

// invariant: a DETERMINISTIC FAKE of the Windows machine. At each question it
// is asked it records what the run has done so far, and it answers the
// managed-policy question with `policy`.
function observingHost(fixture, run, policy) {
  const seen = [];
  const observe = (question) => {
    const runtime = openRuntime(fixture.workspace);
    try {
      seen.push({
        question,
        state: runtime.getRun(RUN_ID).state,
        lease: writerLeaseHeld(runtime),
        active: existsSync(join(run.directory, "active.json")),
        worktrees: worktreeCount(fixture.workspace.layout.worktreesRoot)
      });
    } finally {
      runtime.close();
    }
  };
  const host = {
    bridgeTransport: () => ({
      listen: () => {
        observe("bridge");
        return Promise.resolve({ endpoint: "\\\\.\\pipe\\verchestra-fake", close: () => Promise.resolve() });
      }
    }),
    ownerOnly: () => {
      observe("owner-only-acl");
      return Promise.resolve(true);
    },
    managedPolicyPresent: () => {
      observe("managed-policy");
      return Promise.resolve(policy);
    }
  };
  return { machine: { platform: "win32", host }, seen };
}

function notConfigured(requirement) {
  return (error) => {
    assert.equal(error?.envelope?.code, "VES_TASK_NOT_CONFIGURED", String(error?.stack));
    assert.deepEqual(error.envelope.safeDetails, { requirement });
    return true;
  };
}

// why: the deny guard stops the first credential read; reaching it proves the
// run got past every check before it.
function reachedCredentialRead(error) {
  const causes = [];
  for (let cause = error; cause !== undefined; cause = cause.cause) causes.push(String(cause.message));
  assert.ok(
    causes.some((message) => message.includes("attempted to run")),
    causes.join(" <- ")
  );
  return true;
}

function assertNothingDone(seen, state) {
  assert.deepEqual(
    seen.map((entry) => entry.question),
    ["bridge", "owner-only-acl", "managed-policy"]
  );
  for (const entry of seen)
    assert.deepEqual(
      { ...entry, question: undefined },
      { question: undefined, state, lease: false, active: false, worktrees: 0 },
      entry.question
    );
}

async function providers(fixture, auth) {
  await mkdir(fixture.workspace.layout.workspaceRoot, { recursive: true });
  await writeFile(
    join(fixture.workspace.layout.workspaceRoot, "task-providers.json"),
    JSON.stringify({ schemaVersion: 1, providers: { "claude-code": { auth } } })
  );
}

for (const [command, state, resume] of COMMANDS)
  for (const auth of ["subscription", "api-key"])
    test(`${command} of a run on the ${auth} profile is refused under a managed policy before anything is read or claimed`, async () => {
      const { fixture, run } = await boundRun(state);
      await providers(fixture, auth);
      const { machine, seen } = observingHost(fixture, run, true);
      await assert.rejects(
        runTask(fixture.io, { runId: RUN_ID, resume }, machine),
        notConfigured("claude-managed-policy")
      );
      assertNothingDone(seen, state);
      assert.equal(fixture.state(), state);
      assert.equal(existsSync(join(run.directory, "active.json")), false);
    });

for (const [command, state, resume] of COMMANDS)
  test(`${command} on a machine with every prerequisite goes on to its first credential read`, async () => {
    const { fixture, run } = await boundRun(state);
    const { machine, seen } = observingHost(fixture, run, false);
    await assert.rejects(runTask(fixture.io, { runId: RUN_ID, resume }, machine), reachedCredentialRead);
    assertNothingDone(seen, state);
    assert.equal(fixture.state(), state);
  });

test("a coordinated run proves the machine after the owner's billing statement", async () => {
  const { fixture, run } = await boundRun("EXECUTION_AUTHORIZED", coordinatedRequest());
  const unread = observingHost(fixture, run, true);
  await assert.rejects(
    runTask(fixture.io, { runId: RUN_ID, resume: false }, unread.machine),
    notConfigured("extra-usage-confirmation")
  );
  assert.deepEqual(unread.seen, [], "the machine was asked before the billing statement was read");
  await confirmExtraUsage(fixture.workspace.layout.workspaceRoot);
  const managed = observingHost(fixture, run, true);
  await assert.rejects(
    runTask(fixture.io, { runId: RUN_ID, resume: false }, managed.machine),
    notConfigured("claude-managed-policy")
  );
  assertNothingDone(managed.seen, "EXECUTION_AUTHORIZED");
});
