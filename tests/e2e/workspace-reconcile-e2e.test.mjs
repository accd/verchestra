import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { WorkspaceReconcileService } from "../../packages/application/src/index.ts";
import { NodeContentDigest, RuntimeSyncStateStore, RuntimeStore } from "../../packages/platform-node/src/index.ts";
import { canonical, input, opId, project, projection, workspaceId } from "../helpers/workspace-reconcile-fixture.mjs";

async function runtimeFixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-sync-"));
  const runtime = new RuntimeStore({ dbPath: join(root, "runtime.sqlite") });
  runtime.open();
  const service = new WorkspaceReconcileService({
    store: new RuntimeSyncStateStore({ runtimeStore: runtime, workspaceId }),
    digest: new NodeContentDigest()
  });
  return { root, runtime, service };
}

test("SQLite-backed sync survives restart and repeats with no mutation", async () => {
  const fixture = await runtimeFixture();
  try {
    const first = await fixture.service.execute(input());
    fixture.runtime.close();
    fixture.runtime.open();
    const before = fixture.runtime.stateDigest();
    const second = await fixture.service.execute(input());
    assert.equal(second.stateDigest, first.stateDigest);
    assert.equal(second.stateChanged, false);
    assert.equal(fixture.runtime.stateDigest(), before);
  } finally {
    fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("SQLite-backed authorized monorepo topology reconciliation is atomic", async () => {
  const fixture = await runtimeFixture();
  try {
    await fixture.service.execute(
      input(canonical({ projects: [project("api", "projects/api"), project("web", "projects/web")] }))
    );
    const configuration = canonical({
      projects: [project("api", "apps/api"), project("web", "projects/web", { state: "retired" })]
    });
    const result = await fixture.service.execute(
      input(configuration, {
        directions: { [opId("move", "api")]: "accept", [opId("retire", "web")]: "accept" }
      })
    );
    assert.equal(result.status, "reconciled");
    assert.deepEqual(
      fixture.runtime.getSyncState(workspaceId).projects.map((entry) => entry.state),
      ["active", "retired"]
    );
  } finally {
    fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("projection drift and uncertain acknowledgement remain explicit across SQLite restart", async () => {
  const fixture = await runtimeFixture();
  try {
    await fixture.service.execute(input(canonical({ projections: [projection()] })));
    const configuration = canonical({
      projections: [projection({ observedRemoteDigest: "sha256:edited", observedRemoteVersion: "9" })]
    });
    const result = await fixture.service.execute(
      input(configuration, {
        directions: { "projection-drift:projection-orders-jira": "canonical-to-remote" },
        uncertainEffects: [
          {
            effectId: "effect-lost-ack",
            connectorId: "jira",
            correlationMarker: "ves:workspace:projection",
            inputDigest: "sha256:projection"
          }
        ]
      })
    );
    assert.deepEqual(
      result.effects.map((entry) => entry.kind),
      ["upsert-projection", "reconcile-effect"]
    );
    fixture.runtime.close();
    fixture.runtime.open();
    assert.equal(fixture.runtime.getSyncState(workspaceId).projections[0].observedRemoteVersion, "9");
  } finally {
    fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
