// invariant: a planned v2 run's record seals its whole normalized descriptor
// and loads through the same validated reader as a v1 run (SSI-22, SSI-29).
// Until coordinated runs are composed, every command that would drive or
// review an implementer refuses a v2 run before it reads a credential, applies
// a transition, or creates a worktree, and leaves the run as it was. The
// commands run in this process on a real Workspace; the deny guard of the
// fixture fails any case that reaches a credential.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { reviewTask } from "../../apps/vestra-cli/src/task/task-review.ts";
import { runTask } from "../../apps/vestra-cli/src/task/task-run.ts";
import { statusTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import {
  cleanupTaskCommandFixtures,
  listing,
  refusedState,
  taskCommandFixture
} from "../helpers/task-command-fixture.mjs";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";
import { RUN_ID, TASK_ID, canonicalDigestOf, filled, planRecord } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

const RUN = Object.freeze({ runId: RUN_ID });

function coordinatedRequest(mode = "graph") {
  const request = validTaskRequestV2(mode);
  return normalizeTaskRequest({ ...request, task: { ...request.task, taskId: TASK_ID } });
}

async function plannedCoordinated(state, request = coordinatedRequest()) {
  const fixture = await taskCommandFixture();
  const run = await fixture.planned(state, planRecord({ request }));
  return { fixture, ...run };
}

function notConfigured(requirement) {
  return (error) => {
    assert.equal(error?.envelope?.code, "VES_TASK_NOT_CONFIGURED");
    assert.deepEqual(error.envelope.safeDetails, { requirement });
    return true;
  };
}

test("a v2 plan record seals its whole descriptor and loads unchanged", async () => {
  for (const mode of ["agent", "graph", "swarm"]) {
    const request = coordinatedRequest(mode);
    const run = await plannedCoordinated("AWAITING_EXECUTION_APPROVAL", request);
    const loaded = await run.runRecord.loadPlan();
    assert.deepEqual(loaded, planRecord({ request }), mode);
    assert.equal(loaded.request.schemaVersion, 2, mode);
    assert.equal(loaded.requestDigest, canonicalDigestOf(request), mode);
    assert.equal(loaded.request.execution.limits.maxNodes, 64, mode);
  }
});

test("a stored v2 request that the intake contract refuses fails the load closed", async () => {
  const stored = structuredClone(coordinatedRequest());
  stored.execution.edges.push({ from: "review", to: "plan" });
  const run = await plannedCoordinated("AWAITING_EXECUTION_APPROVAL", stored);
  await assert.rejects(run.runRecord.loadPlan(), refusedState("VES_TASK_STATE_MALFORMED"));
});

test("a v2 request whose digest no longer matches its plan record is refused as tampered", async () => {
  const request = coordinatedRequest();
  const fixture = await taskCommandFixture();
  const run = await fixture.planned(
    "AWAITING_EXECUTION_APPROVAL",
    planRecord({ request, requestDigest: canonicalDigestOf(coordinatedRequest("swarm")) })
  );
  await assert.rejects(run.runRecord.loadPlan(), refusedState("VES_TASK_STATE_TAMPERED"));
});

test("status reads a planned v2 run", async () => {
  const run = await plannedCoordinated("AWAITING_EXECUTION_APPROVAL");
  const status = await statusTask(run.fixture.io, RUN);
  assert.equal(status.state, "AWAITING_EXECUTION_APPROVAL");
  assert.equal(status.bindingDigest, run.plan.approvalRequest.bindingDigest);
  assert.equal(status.activeProcess, false);
});

for (const [command, state, invoke] of [
  ["start", "EXECUTION_AUTHORIZED", (io) => runTask(io, { ...RUN, resume: false })],
  ["resume", "IMPLEMENTING", (io) => runTask(io, { ...RUN, resume: true })],
  [
    "review",
    "HUMAN_REVIEW",
    (io) => reviewTask(io, { ...RUN, outcome: "accepted", surfaceDigest: filled("0"), confirmStdin: false })
  ]
]) {
  test(`${command} refuses a v2 run as not configured and leaves it as it was`, async () => {
    const run = await plannedCoordinated(state);
    const before = await listing(run.fixture.workspace.layout.workspaceRoot);
    await assert.rejects(invoke(run.fixture.io), notConfigured("coordinated-run"));
    assert.equal(run.fixture.state(), state);
    assert.deepEqual(await listing(run.fixture.workspace.layout.workspaceRoot), before);
    assert.equal(existsSync(join(run.directory, "active.json")), false);
  });
}
