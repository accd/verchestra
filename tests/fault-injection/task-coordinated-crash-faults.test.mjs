// invariant: SSI-66 and D4 under a crash. The process driving a coordinated
// run is killed while a node runs, so the node's visit is durable as started
// and has no recorded end. Resume refuses it as uncertain and changes nothing;
// status names it with the digest of its uncertainty record; the typed-back
// digest runs that one node again and the run reaches review. The providers
// are the DETERMINISTIC FAKE `claude` and `codex` executables
// (tests/helpers/task-cli-fakes), steered by a fixture flag. The case runs on
// macOS, Linux, and Windows.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
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
  visits,
  waitFor
} from "../helpers/task-coordinated-fixture.mjs";

after(cleanupTaskFixtures);

const resume = (fixture, runId, ...extra) =>
  fixture.launch(["task", "resume", "--run-id", runId, ...extra, ...fixture.keychainArgs, "--output", "json"]);

test("a run killed while a node runs leaves it uncertain until the owner reconciles it", TIMEOUT, async (t) => {
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
  // why: the killed driver could not stop its provider; the orphan is ended
  // here, as an owner would, before the run is resumed. One that already ended
  // on its closed input has nothing left to stop.
  try {
    process.kill(hung(), "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
  await waitFor(() => !running(hung()), 10_000);
  await unlink(hangFlag);
  assert.deepEqual(visits(fixture, plan.runId), ["plan#1:started"]);
  const ledgerPath = join(fixture.stateRoot, "tasks", plan.runId, "coordination", "ledger.json");
  const ledgerBefore = readFileSync(ledgerPath, "utf8");
  const interrupted = status(fixture, plan.runId);
  assert.equal(interrupted.state, "IMPLEMENTING");
  assert.equal(interrupted.activeProcess, false);
  const [uncertain] = interrupted.coordination.uncertain;
  assert.deepEqual(
    { ...uncertain, digest: undefined },
    { nodeId: "plan", visit: 1, state: "started", receiptCount: 0, digest: undefined }
  );
  const refused = resume(fixture, plan.runId);
  assert.notEqual(refused.status, 0);
  assert.equal(refused.json?.error?.code, "VES_TASK_FAILED", refused.stdout);
  assert.equal(refused.json.error.safeDetails.reason, "VES_TASK_NODE_UNCERTAIN");
  assert.equal(readFileSync(ledgerPath, "utf8"), ledgerBefore, "a refused resume changed the ledger");
  assert.equal(status(fixture, plan.runId).state, "IMPLEMENTING");
  const reconciled = ok(resume(fixture, plan.runId, "--reconcile", uncertain.digest), "reconciled resume");
  assert.equal(reconciled.state, "HUMAN_REVIEW");
  assert.deepEqual(visits(fixture, plan.runId), [
    "plan#1:started",
    "plan#1:completed",
    "build#1:completed",
    "review#1:completed"
  ]);
});
