// invariant: SSI-81 for the records and outputs a v2 run adds. The plan
// record a coordinated run seals, the surface `task plan` presents for it,
// and the `status` output of a suspended coordinated run hold no credential,
// account data, session, or machine-local path (the home directory, the state
// root, the Workspace root, the repository, or the temporary root), whatever
// the owner's statement held. Commands run in this process on a real
// Workspace; no provider and no credential store is reached.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { subscriptionPreconditions } from "../../apps/vestra-cli/src/task/task-billing.ts";
import { planSurface } from "../../apps/vestra-cli/src/task/task-plan.ts";
import { statusTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { confirmExtraUsage, extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import { cleanupTaskCommandFixtures, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { boundPlan } from "../helpers/task-plan-fixture.mjs";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";
import { RUN_ID, TASK_ID, contextManifest, planRecord } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

const TOKEN = "sk-ant-oat01-fake-surface-security-6a2f";
const EMAIL = "owner@example.invalid";
const SUBSCRIPTION = Object.freeze({ implementer: "subscription", verifier: "subscription" });

function coordinatedRequest(mode) {
  const request = validTaskRequestV2(mode);
  return normalizeTaskRequest({ ...request, task: { ...request.task, taskId: TASK_ID } });
}

function localRoots(fixture) {
  const layout = fixture.workspace.layout;
  return [
    homedir(),
    fixture.io.homeDirectory,
    layout.stateRoot,
    layout.workspaceRoot,
    fixture.repositoryRoot,
    fixture.root,
    tmpdir()
  ];
}

function holdsNone(text, forbidden, label) {
  for (const value of forbidden) assert.equal(text.includes(value), false, `${label} holds ${value}`);
}

test("a v2 plan record and its plan surface hold no credential, account data, or machine-local path", async () => {
  for (const mode of ["agent", "graph", "swarm"]) {
    const fixture = await taskCommandFixture();
    const workspaceRoot = fixture.workspace.layout.workspaceRoot;
    // why: an owner's statement that holds a token, an address, and a path
    // is refused, and the surface reports only which precondition is unmet.
    const codex = { ...extraUsageConfirmation().providers.codex, email: EMAIL, token: TOKEN, home: homedir() };
    await confirmExtraUsage(workspaceRoot, extraUsageConfirmation({ codex }));
    const request = coordinatedRequest(mode);
    const bound = await boundPlan(request);
    const record = planRecord({
      request,
      packageId: bound.pkg.artifactId,
      packageDigest: `sha256:${bound.pkg.payloadDigest}`,
      approvalIntent: bound.intent,
      approvalRequest: bound.approvalRequest
    });
    const { directory } = await fixture.planned("AWAITING_EXECUTION_APPROVAL", record);
    const subscription = await subscriptionPreconditions({ workspaceRoot, auth: SUBSCRIPTION, request });
    const surface = planSurface(record, contextManifest(), false, SUBSCRIPTION, subscription);
    assert.equal(surface.coordination.mode, mode);
    assert.notEqual(subscription.preflight, "ready", "the hostile statement is refused");
    const forbidden = [TOKEN, EMAIL, ...localRoots(fixture)];
    holdsNone(await readFile(join(directory, "plan.json"), "utf8"), forbidden, `the ${mode} plan record`);
    holdsNone(JSON.stringify(surface), forbidden, `the ${mode} plan surface`);
  }
});

test("the status of a suspended coordinated run holds no credential, session, or machine-local path", async () => {
  const fixture = await taskCommandFixture();
  const request = coordinatedRequest("graph");
  const { runRecord } = await fixture.planned("IMPLEMENTING", planRecord({ request }));
  const suspension = {
    reason: "VES_DRIVER_QUOTA_EXHAUSTED",
    provider: "claude-code",
    at: "2026-10-03T12:00:00.000Z",
    scope: "five_hour"
  };
  await runRecord.saveOutcome({ status: "SUSPENDED", suspension });
  await runRecord.saveCoordinationLedger({
    schemaVersion: 1,
    mode: "graph",
    round: 1,
    roundState: "running",
    visits: [
      {
        round: 1,
        nodeId: "plan",
        visit: 1,
        state: "completed",
        startedAt: "2026-10-03T11:59:00.000Z",
        endedAt: "2026-10-03T11:59:30.000Z",
        receiptCount: 0,
        resultDigest: `sha256:${"5".repeat(64)}`,
        resultBytes: 40
      },
      {
        round: 1,
        nodeId: "build",
        visit: 1,
        state: "failed",
        startedAt: "2026-10-03T11:59:31.000Z",
        endedAt: "2026-10-03T12:00:00.000Z",
        receiptCount: 0,
        failureCode: "VES_DRIVER_QUOTA_EXHAUSTED"
      }
    ]
  });
  const status = await statusTask(fixture.io, { runId: RUN_ID });
  assert.equal(status.lastOutcome, "SUSPENDED");
  assert.deepEqual(status.suspension, suspension);
  assert.deepEqual(
    status.coordination.nodes.map((node) => [node.nodeId, node.state]),
    [
      ["plan", "completed"],
      ["build", "failed"],
      ["review", "pending"]
    ]
  );
  holdsNone(JSON.stringify(status), [TOKEN, EMAIL, "private-session", ...localRoots(fixture)], "the status output");
});
