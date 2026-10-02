import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { DEFAULT_RUNTIME_MIGRATIONS, RuntimeStore } from "../../packages/platform-node/src/index.ts";

const roots = [];
const open = [];
afterEach(async () => {
  // SQLite handles must be closed before the directory can be removed on
  // Windows; leaving them open turns cleanup into EBUSY rather than a failure.
  for (const instance of open.splice(0)) instance.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const opened = (instance) => {
  open.push(instance);
  return instance;
};

const dbPath = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-claim-migration-"));
  roots.push(root);
  return join(root, "runtime.db");
};

const WORKSPACE = "workspace_018f0b6d-7b1a-7abc-8def-012345678901";
const SCOPE_DIGEST = `sha256:${"a".repeat(64)}`;

// why: the runtime store no longer has a claim writer (the legacy
// acquireClaim/releaseClaim pair had no production caller and was removed), but
// migration 001 still creates the table and migration 008 still clears it, so
// the rows an older build left behind are written here directly.
function withClaims(path, action) {
  const database = new DatabaseSync(path, { defensive: true });
  try {
    return action({
      insert: (claimId, ownerId) =>
        database
          .prepare(
            "INSERT INTO claims(claim_id, workspace_id, scope_digest, owner_id, expires_at) VALUES (?, ?, ?, ?, ?)"
          )
          .run(claimId, WORKSPACE, SCOPE_DIGEST, ownerId, new Date(Date.now() + 60 * 60 * 1000).toISOString()),
      owners: () =>
        database
          .prepare("SELECT owner_id FROM claims WHERE workspace_id=? AND scope_digest=? ORDER BY claim_id")
          .all(WORKSPACE, SCOPE_DIGEST)
          .map((row) => row.owner_id)
    });
  } finally {
    database.close();
  }
}

// The migration list an older build shipped: everything up to, but not
// including, the claim re-encoding. Opening with it produces a database in
// exactly the state a developer would have had before pulling #58's T4b slice.
const BEFORE_REENCODING = DEFAULT_RUNTIME_MIGRATIONS.filter(
  (migration) => migration.id !== "008_claim_digest_reencoding"
);

// #58 T4b re-encoded scopeDigest, which changes the digest a given scope
// produces. Exclusivity is a pure digest-equality lookup over
// UNIQUE (workspace_id, scope_digest) with no target-overlap computation, so a
// claim written under the old encoding would never collide with the same
// logical scope under the new one — two runs holding the same scope
// exclusively, for as long as the TTL allows (up to 24 hours).

test("the migration that discards re-encoded claims is registered exactly once and after the table exists", () => {
  const ids = DEFAULT_RUNTIME_MIGRATIONS.map((migration) => migration.id);
  assert.ok(ids.includes("008_claim_digest_reencoding"));
  assert.equal(new Set(ids).size, ids.length, "migration ids must be unique");
  assert.ok(ids.indexOf("001_runtime") < ids.indexOf("008_claim_digest_reencoding"));
});

test("a claim written before the re-encoding does not outlive it", async () => {
  const path = await dbPath();
  const older = opened(new RuntimeStore({ dbPath: path, migrations: BEFORE_REENCODING }));
  older.open();
  withClaims(path, (claims) => claims.insert("claim-old", "run-old"));
  assert.deepEqual(
    withClaims(path, (claims) => claims.owners()),
    ["run-old"]
  );

  // Pulling the change applies the pending migration.
  const upgraded = opened(new RuntimeStore({ dbPath: path }));
  const { appliedMigrations } = upgraded.open();
  assert.equal(appliedMigrations, 1, "exactly the claim re-encoding migration is pending");
  assert.deepEqual(
    withClaims(path, (claims) => claims.owners()),
    []
  );

  // The behavioural consequence, which is what actually matters: a different
  // owner can now take the same scope. Before the migration the orphaned row
  // would have blocked it while its owner still believed it held the scope —
  // and under the new encoding the same scope hashes differently, so the row
  // could never be matched or released again either.
  withClaims(path, (claims) => claims.insert("claim-new", "run-new"));
  assert.deepEqual(
    withClaims(path, (claims) => claims.owners()),
    ["run-new"]
  );
});

test("discarding stale claims does not weaken the scope uniqueness the table enforces", async () => {
  const path = await dbPath();
  const instance = opened(new RuntimeStore({ dbPath: path }));
  instance.open();
  withClaims(path, (claims) => claims.insert("claim-first", "run-first"));

  assert.throws(
    () => withClaims(path, (claims) => claims.insert("claim-second", "run-second")),
    /UNIQUE constraint failed: claims\.workspace_id, claims\.scope_digest/u
  );
  assert.deepEqual(
    withClaims(path, (claims) => claims.owners()),
    ["run-first"]
  );
});

test("the migration runs once, not on every open", async () => {
  const path = await dbPath();
  const first = opened(new RuntimeStore({ dbPath: path }));
  first.open();
  withClaims(path, (claims) => claims.insert("claim-live", "run-live"));

  const second = opened(new RuntimeStore({ dbPath: path }));
  assert.equal(second.open().appliedMigrations, 0, "no migration is pending on an already-current database");
  // A live claim taken after the upgrade must survive re-opening, or the
  // migration would be quietly clearing claims forever.
  assert.deepEqual(
    withClaims(path, (claims) => claims.owners()),
    ["run-live"]
  );
});
