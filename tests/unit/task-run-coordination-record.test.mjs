// invariant: the Run record owns a coordinated run's node ledger and node
// results (AD-047, AD-052, AD-061). The ledger is sealed and read through the
// application's validator; each result is sealed in a file named by the
// digest of its canonical bytes and is returned only when it is that result.
// These cases drive the interface in a temporary directory.
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { NativeAgentEngine } from "../../packages/application/src/index.ts";
import {
  coordinatedDriver,
  coordinatedRequest,
  control,
  driverRequest,
  resultBytes,
  scriptedEngine
} from "../helpers/coordinated-driver-fixture.mjs";
import {
  RUN_ID,
  WORKSPACE_ID,
  bytesDigest,
  cleanupRunRecordFixtures,
  sealedText,
  temporaryRoot
} from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);

const byText = (left, right) => Number(left > right) - Number(left < right);

const LEDGER = Object.freeze({
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
      startedAt: "2026-10-03T12:00:00.000Z",
      endedAt: "2026-10-03T12:01:00.000Z",
      receiptCount: 0,
      resultDigest: `sha256:${"a".repeat(64)}`,
      resultBytes: 40
    }
  ]
});

async function opened() {
  const root = await temporaryRoot();
  const tasksRoot = join(root, "tasks");
  const directory = join(tasksRoot, RUN_ID, "coordination");
  return {
    root,
    directory,
    runRecord: openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID),
    fresh: () => openRunRecord({ workspaceId: WORKSPACE_ID, tasksRoot }, RUN_ID)
  };
}

const refused = (reason) => (error) => {
  assert.equal(error?.envelope?.code, "VES_TASK_STATE_INVALID");
  assert.deepEqual(error.envelope.safeDetails, { reason });
  return true;
};

test("a node ledger is sealed under coordination/ and reads back as the ledger it was", async () => {
  const { runRecord, directory } = await opened();
  assert.equal(await runRecord.loadCoordinationLedger(), undefined);
  await runRecord.saveCoordinationLedger(LEDGER);
  assert.equal(await readFile(join(directory, "ledger.json"), "utf8"), sealedText(LEDGER));
  assert.deepEqual(await runRecord.loadCoordinationLedger(), LEDGER);
});

test("a ledger edited on disk is tampered, and one of another shape is malformed, never read in part", async () => {
  const { runRecord, directory } = await opened();
  await runRecord.saveCoordinationLedger(LEDGER);
  const text = await readFile(join(directory, "ledger.json"), "utf8");
  await writeFile(join(directory, "ledger.json"), text.replace('"completed"', '"started"'));
  await assert.rejects(runRecord.loadCoordinationLedger(), refused("VES_TASK_STATE_TAMPERED"));
  for (const changed of [
    { ...LEDGER, extra: true },
    { ...LEDGER, visits: [{ ...LEDGER.visits[0], prompt: "hello" }] },
    { ...LEDGER, visits: [{ ...LEDGER.visits[0], state: "done" }] },
    { ...LEDGER, visits: [{ ...LEDGER.visits[0], resultDigest: undefined }] },
    { ...LEDGER, visits: [{ ...LEDGER.visits[0], nodeId: "/Users/owner" }] },
    { ...LEDGER, mode: "chain" }
  ]) {
    await writeFile(join(directory, "ledger.json"), sealedText(JSON.parse(JSON.stringify(changed))));
    await assert.rejects(runRecord.loadCoordinationLedger(), refused("VES_TASK_STATE_MALFORMED"));
  }
});

test("a ledger of another shape is refused before it is written", async () => {
  const { runRecord, directory } = await opened();
  await assert.rejects(
    runRecord.saveCoordinationLedger({ ...LEDGER, visits: [{ ...LEDGER.visits[0], state: "running" }] }),
    refused("VES_TASK_STATE_MALFORMED")
  );
  await assert.rejects(readdir(directory), { code: "ENOENT" });
});

test("a node result is sealed in a file named by its digest and reads back byte for byte", async () => {
  const { runRecord, directory } = await opened();
  const bytes = resultBytes({ outcome: "done", summary: "greeting changed" });
  const digest = await runRecord.saveCoordinationResult(bytes);
  assert.equal(digest, bytesDigest(bytes));
  assert.deepEqual(await readdir(join(directory, "results")), [`${digest.slice(7)}.json`]);
  assert.deepEqual(await runRecord.loadCoordinationResult(digest), bytes);
});

test("a result filed under another digest, a missing one, or bytes that are not canonical are refused", async () => {
  const { runRecord, directory } = await opened();
  const first = await runRecord.saveCoordinationResult(resultBytes({ outcome: "done", summary: "one" }));
  const second = await runRecord.saveCoordinationResult(resultBytes({ outcome: "done", summary: "two" }));
  const results = join(directory, "results");
  await writeFile(join(results, `${first.slice(7)}.json`), await readFile(join(results, `${second.slice(7)}.json`)));
  await assert.rejects(runRecord.loadCoordinationResult(first), refused("VES_TASK_STATE_TAMPERED"));
  await assert.rejects(
    runRecord.loadCoordinationResult(`sha256:${"9".repeat(64)}`),
    refused("VES_TASK_STATE_MALFORMED")
  );
  // why: a sealed record waits where the traversal would land, so only the
  // digest grammar, checked before any read, refuses it as malformed.
  await writeFile(join(directory, "..", "plan.json"), sealedText({ planted: true }));
  await assert.rejects(runRecord.loadCoordinationResult("sha256:../../plan"), refused("VES_TASK_STATE_MALFORMED"));
  await assert.rejects(
    runRecord.saveCoordinationResult(new TextEncoder().encode('{ "outcome": "done" }')),
    refused("VES_TASK_STATE_MALFORMED")
  );
});

test("a coordinated run resumed from the Run record replays its completed node from disk", async () => {
  const { runRecord, fresh } = await opened();
  const request = coordinatedRequest("graph");
  const first = coordinatedDriver(request, {
    records: runRecord.coordination(),
    engine: scriptedEngine([["plan"]], { outcome: { status: "cancelled" } }),
    script: { plan: async () => ({ result: { outcome: "done", summary: "the persisted plan" } }) }
  });
  assert.equal((await first.driver.execute(driverRequest(request), control().control)).status, "cancelled");
  const resumed = coordinatedDriver(request, { records: fresh().coordination() });
  assert.equal((await resumed.driver.execute(driverRequest(request), control().control)).status, "completed");
  assert.deepEqual(
    resumed.nodes.state.sessions.map((entry) => entry.node.nodeId),
    ["build", "review"]
  );
  assert.match(resumed.nodes.state.sessions[0].prompt, /the persisted plan/u);
  const ledger = await runRecord.loadCoordinationLedger();
  assert.deepEqual(
    ledger.visits.map((entry) => `${entry.nodeId}:${entry.state}`),
    ["plan:completed", "build:completed", "review:completed"]
  );
  assert.equal(ledger.roundState, "completed");
});

test("an agent run through the Run record leaves exactly a ledger and one result", async () => {
  const { runRecord, directory } = await opened();
  const request = coordinatedRequest("agent");
  const fixture = coordinatedDriver(request, { records: runRecord.coordination(), engine: new NativeAgentEngine() });
  await fixture.driver.execute(driverRequest(request), control().control);
  assert.deepEqual((await readdir(directory)).sort(byText), ["ledger.json", "results"]);
  assert.equal((await readdir(join(directory, "results"))).length, 1);
});
