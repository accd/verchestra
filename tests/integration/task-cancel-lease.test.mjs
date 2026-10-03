// invariant: the writer lease a crashed run left is held in the runtime store
// under the run's id. An idle `vestra task cancel` ends that run, so it
// releases that lease, and only that one: a lease another run holds is not
// this run's to release, and the cancel still ends the run.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { cancelTask } from "../../apps/vestra-cli/src/task/task-status.ts";
import { openRuntime } from "../../apps/vestra-cli/src/task/task-workspace.ts";
import { cleanupTaskCommandFixtures, taskCommandFixture } from "../helpers/task-command-fixture.mjs";
import { OTHER_RUN_ID, RUN_ID, WORKSPACE_ID, planRecord } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

function withRuntime(workspace, use) {
  const runtime = openRuntime(workspace);
  try {
    return use(runtime);
  } finally {
    runtime.close();
  }
}

for (const holder of [RUN_ID, OTHER_RUN_ID]) {
  const verdict = holder === RUN_ID ? "releases its run's" : "leaves another run's";
  test(`an idle cancel ${verdict} writer lease`, async () => {
    const fixture = await taskCommandFixture();
    await fixture.planned("IMPLEMENTING", planRecord());
    withRuntime(fixture.workspace, (runtime) =>
      runtime.acquireLease({
        leaseId: "lease_018f0b6d-7b1a-7abc-8def-112345678905",
        workspaceId: WORKSPACE_ID,
        ownerId: holder,
        now: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3_600_000).toISOString()
      })
    );
    const result = await cancelTask(fixture.io, { runId: RUN_ID });
    assert.deepEqual(result, { runId: RUN_ID, state: "ABORTED", cancelRequested: true, stopped: true });
    const stillHeld = withRuntime(fixture.workspace, (runtime) => runtime.releaseLease(WORKSPACE_ID, holder));
    assert.equal(stillHeld, holder !== RUN_ID);
  });
}
