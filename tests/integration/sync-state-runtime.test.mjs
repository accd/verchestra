import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { WorkspaceReconcileService } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { NodeContentDigest, RuntimeStore, RuntimeSyncStateStore } from "../../packages/platform-node/src/index.ts";
import { canonical, digest, input, project, workspaceId } from "../helpers/workspace-reconcile-fixture.mjs";

async function reconciled() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-sync-state-"));
  const dbPath = join(root, "runtime.sqlite");
  const runtime = new RuntimeStore({ dbPath });
  runtime.open();
  const store = new RuntimeSyncStateStore({ runtimeStore: runtime, workspaceId });
  const service = new WorkspaceReconcileService({ store, digest: new NodeContentDigest() });
  await service.execute(input());
  runtime.close();
  return { root, dbPath, runtime, store, service };
}

function rewriteStoredState(dbPath, stateJson) {
  const database = new DatabaseSync(dbPath);
  try {
    database.prepare("UPDATE workspace_sync_states SET state_json=? WHERE workspace_id=?").run(stateJson, workspaceId);
  } finally {
    database.close();
  }
}

test("a stored sync state reads back through the adapter as the state that was saved", async () => {
  const fixture = await reconciled();
  try {
    fixture.runtime.open();
    const stored = fixture.runtime.getSyncState(workspaceId);
    const loaded = await fixture.store.load(workspaceId);
    assert.deepStrictEqual(loaded, JSON.parse(stored.stateJson));
    assert.equal(loaded.stateDigest, stored.stateDigest);
    assert.equal(Object.isFrozen(loaded), true);
  } finally {
    fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("a stored sync state made self-consistent behind the store fails closed before reconciliation", async () => {
  const fixture = await reconciled();
  try {
    fixture.runtime.open();
    const saved = await fixture.store.load(workspaceId);
    fixture.runtime.close();
    const material = Object.fromEntries(Object.entries(saved).filter(([member]) => member !== "stateDigest"));
    // why: the forged state carries the digest of its own content, so only
    // the binding to the digest the store saved can tell it apart.
    const forgedMaterial = { ...material, projects: [project("tampered", "tampered")] };
    const forged = { ...forgedMaterial, stateDigest: digest.sha256(canonicalizeJsonV2(forgedMaterial)) };
    rewriteStoredState(fixture.dbPath, JSON.stringify(forged));
    fixture.runtime.open();
    await assert.rejects(fixture.service.execute(input(canonical())), {
      code: "VES_RUNTIME_CORRUPT",
      message: "Stored sync state is not bound to its digest",
      recoverable: true
    });
  } finally {
    fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("stored sync state text that is not JSON fails closed", async () => {
  const fixture = await reconciled();
  try {
    rewriteStoredState(fixture.dbPath, "{");
    fixture.runtime.open();
    await assert.rejects(fixture.store.load(workspaceId), {
      code: "VES_RUNTIME_CORRUPT",
      message: "Stored sync state is not JSON",
      recoverable: true
    });
  } finally {
    fixture.runtime.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
