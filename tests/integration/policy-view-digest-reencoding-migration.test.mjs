import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { CedarPolicyAdapter, PolicyActivationService } from "../../packages/policy/src/index.ts";
import {
  DEFAULT_RUNTIME_MIGRATIONS,
  RuntimePolicyViewStore,
  RuntimeStore
} from "../../packages/platform-node/src/index.ts";
import { cedar, view } from "../helpers/policy-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";

// The migration list an older build shipped: everything up to, but not
// including, the policy-view digest re-encoding. Opening with it produces a
// database in exactly the state a developer would have had before pulling
// #58's T4d slice.
const BEFORE_REENCODING = DEFAULT_RUNTIME_MIGRATIONS.filter(
  (migration) => migration.id !== "010_policy_view_digest_reencoding"
);

test("the migration that discards re-encoded policy views is registered exactly once and after the table exists", () => {
  const ids = DEFAULT_RUNTIME_MIGRATIONS.map((migration) => migration.id);
  assert.ok(ids.includes("010_policy_view_digest_reencoding"));
  assert.equal(new Set(ids).size, ids.length, "migration ids must be unique");
  assert.ok(ids.indexOf("005_policy_views") < ids.indexOf("010_policy_view_digest_reencoding"));
});

test("an active policy view written before the re-encoding does not outlive it", async () => {
  const older = await opened({ migrations: BEFORE_REENCODING });
  const store = new RuntimePolicyViewStore({ runtimeStore: older.store, workspaceId });
  const service = new PolicyActivationService({ validator: new CedarPolicyAdapter({ engine: cedar }), store });
  const activated = await service.activate(view());
  assert.equal(activated.status, "activated");
  older.store.close();

  // Pulling the change applies the pending migration.
  const upgraded = new RuntimeStore({ dbPath: older.dbPath });
  const { appliedMigrations } = upgraded.open();
  assert.equal(appliedMigrations, 1, "exactly the policy-view re-encoding migration is pending");

  const reloadedStore = new RuntimePolicyViewStore({ runtimeStore: upgraded, workspaceId });
  assert.equal(await reloadedStore.load(), undefined);
  upgraded.close();
});

test("the migration runs once, not on every open", async () => {
  const first = await opened();
  const store = new RuntimePolicyViewStore({ runtimeStore: first.store, workspaceId });
  const service = new PolicyActivationService({ validator: new CedarPolicyAdapter({ engine: cedar }), store });
  const activated = await service.activate(view());
  first.store.close();

  const second = new RuntimeStore({ dbPath: first.dbPath });
  assert.equal(second.open().appliedMigrations, 0, "no migration is pending on an already-current database");
  // A view activated after the upgrade must survive re-opening, or the
  // migration would be quietly clearing policy views forever.
  const reloaded = await new RuntimePolicyViewStore({ runtimeStore: second, workspaceId }).load();
  assert.equal(reloaded.policyViewDigest, activated.policyViewDigest);
  second.close();
});
