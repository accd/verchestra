// invariant: a planned v2 run's record seals its whole normalized descriptor
// and loads through the same validated reader as a v1 run (SSI-22, SSI-29).
// Coordinated runs are composed for subscriptions only, with the owner's
// extra-usage confirmation (SSI-51, SSI-52): `start` and `resume` of a v2 run
// whose providers are not both on a subscription, or that has no such
// confirmation, are refused before a credential, a transition, or a worktree,
// and leave the run as it was; with both they go on to read their
// credentials, as a v1 run does. The commands run in this process on a real
// Workspace; the deny guard of the fixture stops any case at its first
// credential read.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { runTask } from "../../apps/vestra-cli/src/task/task-run.ts";
import { statusTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { openRuntime } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { confirmExtraUsage, extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import {
  cleanupTaskCommandFixtures,
  listing,
  refusedState,
  taskCommandFixture
} from "../helpers/task-command-fixture.mjs";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";
import { RUN_ID, TASK_ID, WORKSPACE_ID, canonicalDigestOf, planRecord } from "../helpers/task-run-record-fixture.mjs";

function without(record, key) {
  const copy = { ...record };
  delete copy[key];
  return copy;
}

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

const COMMANDS = Object.freeze([
  ["start", "EXECUTION_AUTHORIZED", (io) => runTask(io, { ...RUN, resume: false })],
  ["resume", "IMPLEMENTING", (io) => runTask(io, { ...RUN, resume: true })]
]);

async function providers(fixture, setting) {
  await mkdir(fixture.workspace.layout.workspaceRoot, { recursive: true });
  await writeFile(join(fixture.workspace.layout.workspaceRoot, "task-providers.json"), JSON.stringify(setting));
}

for (const [command, state, invoke] of COMMANDS)
  for (const provider of ["claude-code", "codex"])
    test(`${command} refuses a v2 run whose ${provider} provider is on an API key, and leaves it as it was`, async () => {
      const run = await plannedCoordinated(state);
      await providers(run.fixture, { schemaVersion: 1, providers: { [provider]: { auth: "api-key" } } });
      const before = await listing(run.fixture.workspace.layout.workspaceRoot);
      await assert.rejects(invoke(run.fixture.io), notConfigured("coordinated-run-subscription"));
      assert.equal(run.fixture.state(), state);
      assert.deepEqual(await listing(run.fixture.workspace.layout.workspaceRoot), before);
      assert.equal(existsSync(join(run.directory, "active.json")), false);
    });

for (const [command, state, invoke] of COMMANDS)
  for (const [label, confirmation] of [
    ["no extra-usage confirmation", undefined],
    [
      "a confirmation that does not name Claude Code",
      { schemaVersion: 1, providers: { codex: extraUsageConfirmation().providers.codex } }
    ],
    [
      "a confirmation of another Codex method",
      extraUsageConfirmation({ codex: { ...extraUsageConfirmation().providers.codex, auth: "apiKey" } })
    ]
  ])
    test(`${command} refuses a v2 run on subscriptions with ${label}, and leaves it as it was`, async () => {
      const run = await plannedCoordinated(state);
      if (confirmation !== undefined) await confirmExtraUsage(run.fixture.workspace.layout.workspaceRoot, confirmation);
      else await mkdir(run.fixture.workspace.layout.workspaceRoot, { recursive: true });
      const before = await listing(run.fixture.workspace.layout.workspaceRoot);
      await assert.rejects(invoke(run.fixture.io), notConfigured("extra-usage-confirmation"));
      assert.equal(run.fixture.state(), state);
      assert.deepEqual(await listing(run.fixture.workspace.layout.workspaceRoot), before);
      assert.equal(existsSync(join(run.directory, "active.json")), false);
      assert.match(run.fixture.stderr.join(""), /task-billing\.json/u);
    });

for (const [command, state, invoke] of COMMANDS)
  test(`${command} of a v2 run on subscriptions with the confirmation is composed: it goes on to its credential read`, async () => {
    const run = await plannedCoordinated(state);
    await confirmExtraUsage(run.fixture.workspace.layout.workspaceRoot);
    // why: the deny guard stops the first credential read; reaching it proves
    // the plan loaded and the run was composed rather than refused.
    await assert.rejects(invoke(run.fixture.io), (error) => {
      const causes = [];
      for (let cause = error; cause !== undefined; cause = cause.cause) causes.push(String(cause.message));
      assert.ok(
        causes.some((message) => message.includes("attempted to run")),
        causes.join(" <- ")
      );
      return true;
    });
    assert.equal(run.fixture.state(), state);
  });

// invariant: SSI-32. Status of a suspended coordinated run names the
// suspension, the state, visit count, and result digest of each node, and
// every node a resume could not run again on its own, with the digest the
// owner types back and the one command that does; the plain resume, which
// would be refused, is not offered.
test("status of a suspended run shows its suspension, each node, and each uncertain node with its digest", async () => {
  const run = await plannedCoordinated("IMPLEMENTING");
  const suspension = {
    reason: "VES_DRIVER_QUOTA_EXHAUSTED",
    provider: "claude-code",
    at: "2026-10-03T12:00:00.000Z",
    scope: "five_hour",
    resetsAt: "2026-10-03T17:00:00.000Z"
  };
  const left = `sha256:${"a".repeat(64)}`;
  const runtime = openRuntime(run.fixture.workspace);
  try {
    await run.runRecord
      .checkpoints(runtime, TASK_ID)
      .executorPort()
      .save({
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        taskId: TASK_ID,
        stage: "suspended",
        sequence: 1,
        data: { changeDigest: left, changedPaths: ["src/value.txt"], toolReceiptRefs: ["receipt:1"], suspension }
      });
  } finally {
    runtime.close();
  }
  const bytes = new TextEncoder().encode(canonicalizeJsonV2({ outcome: "done", summary: "the plan" }));
  const planned = await run.runRecord.saveCoordinationResult(bytes);
  const partial = {
    round: 1,
    nodeId: "build",
    visit: 1,
    state: "partial",
    startedAt: "2026-10-03T11:00:02.000Z",
    endedAt: "2026-10-03T11:00:03.000Z",
    changeDigestBefore: left,
    receiptCount: 1,
    failureCode: "VES_DRIVER_QUOTA_EXHAUSTED"
  };
  await run.runRecord.saveCoordinationLedger({
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
        startedAt: "2026-10-03T11:00:00.000Z",
        endedAt: "2026-10-03T11:00:01.000Z",
        changeDigestBefore: left,
        receiptCount: 0,
        resultDigest: planned,
        resultBytes: bytes.byteLength
      },
      partial
    ]
  });
  await run.runRecord.saveOutcome({ status: "SUSPENDED", suspension });
  const status = await statusTask(run.fixture.io, RUN);
  assert.equal(status.state, "IMPLEMENTING");
  assert.equal(status.lastOutcome, "SUSPENDED");
  assert.equal(status.lastReason, "VES_DRIVER_QUOTA_EXHAUSTED");
  assert.deepEqual(status.suspension, suspension);
  assert.equal(status.checkpoints.executor, "suspended");
  const digest = canonicalDigestOf({ schemaVersion: 1, runId: RUN_ID, ...without(partial, "state") });
  assert.deepEqual(status.coordination, {
    mode: "graph",
    round: 1,
    roundState: "running",
    nodes: [
      { nodeId: "plan", state: "completed", visits: 1, resultDigest: planned },
      { nodeId: "build", state: "partial", visits: 1, resultDigest: null },
      { nodeId: "review", state: "pending", visits: 0, resultDigest: null }
    ],
    uncertain: [{ nodeId: "build", visit: 1, state: "partial", receiptCount: 1, digest }]
  });
  assert.deepEqual(status.next, [
    `vestra task resume --run-id ${RUN_ID} --reconcile ${digest}`,
    `vestra task cancel --run-id ${RUN_ID}`
  ]);
});

test("a single-session run's status names no coordination and no suspension", async () => {
  const fixture = await taskCommandFixture();
  await fixture.planned("IMPLEMENTING", planRecord());
  const status = await statusTask(fixture.io, RUN);
  assert.equal(status.coordination, null);
  assert.equal(status.suspension, null);
  assert.deepEqual(status.next, [`vestra task resume --run-id ${RUN_ID}`, `vestra task cancel --run-id ${RUN_ID}`]);
});

test("resume refuses a reconcile value that is not a digest before it reads anything", async () => {
  const run = await plannedCoordinated("IMPLEMENTING");
  const before = await listing(run.directory);
  await assert.rejects(runTask(run.fixture.io, { ...RUN, resume: true, reconcile: "build" }), (error) => {
    assert.equal(error.envelope.code, "VES_CLI_ARGUMENT_INVALID");
    assert.deepEqual(error.envelope.safeDetails, { argument: "--reconcile" });
    return true;
  });
  assert.deepEqual(await listing(run.directory), before);
});
