import assert from "node:assert/strict";
import { test } from "node:test";

import {
  WIN32_HOST,
  eventuallyDead,
  fileDigest,
  NODE_WORKER,
  probeHostRefusedOnWin32,
  spawnedProbe
} from "../helpers/spawned-probe-worker-fixture.mjs";

// why: the journey a workspace team takes: a probe worker locked as an approved
// Plugin, admitted by a controller grant, launched out of process, and driven by
// the unchanged supervisor bounds to one protected result envelope.
test("a locked, approved, granted workspace worker delivers one protected result out of process", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({ parameter: "journey-parameter" });
  assert.equal(fixture.trust.kind, "workspace");
  assert.equal(fixture.trust.componentDigest, fileDigest(NODE_WORKER));
  assert.equal(fixture.transport.launchedComponentDigest, fixture.trust.componentDigest);

  const envelope = await fixture.supervisor.execute();

  assert.equal(envelope.status, "complete");
  assert.deepEqual(
    [envelope.workspaceId, envelope.planDigest, envelope.grantRef, envelope.rowCount],
    [fixture.plan.workspaceId, fixture.plan.planDigest, fixture.plan.grantRef, 2]
  );
  assert.equal(envelope.identityReadOnly, true);
  assert.equal(envelope.sessionReadOnly, true);
  assert.match(envelope.protectedResultRef, /^protected-result:/u);
  const serialized = JSON.stringify(envelope);
  for (const prohibited of ["journey-parameter", '"rows"', "fixture"])
    assert.equal(serialized.includes(prohibited), false, `${prohibited} stays behind the protected reference`);
  assert.equal(fixture.results.commits, 1);
  assert.equal(
    fixture.parameters.lastDelivered.every((byte) => byte === 0),
    true
  );
  assert.equal(fixture.framed.parameterFrameZeroized, true);
  assert.equal(await eventuallyDead(fixture.transport.pid), true);
  assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
});
