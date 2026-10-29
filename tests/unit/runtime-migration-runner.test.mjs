import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  applyRuntimeMigration,
  runtimeMigrationChecksum
} from "../../packages/platform-node/src/runtime-store/runtime-migration-runner.ts";

const AT = "2026-10-29T12:00:00.000Z";

// why: a parent and a child that references it, with foreign keys on as the
// runtime store opens every connection.
function database() {
  const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true });
  db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE ves_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE parents (parent_id TEXT PRIMARY KEY, label TEXT NOT NULL CHECK (label IN ('a', 'b'))) STRICT;
CREATE TABLE children (child_id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parents(parent_id)) STRICT;
INSERT INTO parents VALUES ('p1', 'a');
INSERT INTO children VALUES ('c1', 'p1');`);
  return db;
}

const read = (db, sql) =>
  db
    .prepare(sql)
    .all()
    .map((row) => ({ ...row }));
const foreignKeys = (db) => read(db, "PRAGMA foreign_keys")[0].foreign_keys;
const ledger = (db) => read(db, "SELECT id FROM ves_migrations ORDER BY id").map((row) => row.id);

const REBUILD = `CREATE TABLE parents_next (parent_id TEXT PRIMARY KEY, label TEXT NOT NULL CHECK (label IN ('a', 'b', 'c'))) STRICT;
INSERT INTO parents_next (rowid, parent_id, label) SELECT rowid, parent_id, label FROM parents;
DROP TABLE parents;
ALTER TABLE parents_next RENAME TO parents;`;

test("a migration's checksum is the digest of its statement alone", () => {
  const up = "CREATE TABLE notes (note_id TEXT PRIMARY KEY) STRICT;";
  const digest = createHash("sha256").update(up).digest("hex");
  assert.equal(runtimeMigrationChecksum({ id: "001", up }), digest);
  assert.equal(runtimeMigrationChecksum({ id: "001", up, tableRebuild: true }), digest);
});

test("a migration commits with its ledger row and leaves foreign keys as they were", () => {
  const db = database();
  const migration = { id: "001_notes", up: "CREATE TABLE notes (note_id TEXT PRIMARY KEY) STRICT;" };
  applyRuntimeMigration(db, migration, AT);
  assert.deepEqual(read(db, "SELECT * FROM ves_migrations"), [
    { id: "001_notes", checksum: runtimeMigrationChecksum(migration), applied_at: AT }
  ]);
  assert.equal(foreignKeys(db), 1);
  db.close();
});

test("a migration that fails is rolled back with its ledger row", () => {
  const db = database();
  assert.throws(
    () =>
      applyRuntimeMigration(
        db,
        { id: "002_orphan", up: "CREATE TABLE notes (note_id TEXT); INSERT INTO children VALUES ('c2', 'none');" },
        AT
      ),
    { code: "VES_RUNTIME_CONSTRAINT" }
  );
  assert.equal(db.isTransaction, false);
  assert.deepEqual(ledger(db), []);
  assert.deepEqual(read(db, "SELECT name FROM sqlite_schema WHERE name = 'notes'"), []);
  db.close();
});

test("a table rebuild runs with foreign keys off and restores them after it commits", () => {
  const db = database();
  applyRuntimeMigration(
    db,
    {
      id: "003_parent_labels",
      tableRebuild: true,
      up: `CREATE TABLE observed AS SELECT foreign_keys AS foreign_keys FROM pragma_foreign_keys;\n${REBUILD}`
    },
    AT
  );
  assert.deepEqual(read(db, "SELECT * FROM observed"), [{ foreign_keys: 0 }]);
  assert.equal(foreignKeys(db), 1);
  assert.deepEqual(ledger(db), ["003_parent_labels"]);
  db.exec("INSERT INTO parents VALUES ('p2', 'c')");
  assert.throws(() => db.exec("INSERT INTO children VALUES ('c2', 'missing')"), /FOREIGN KEY constraint failed/u);
  db.close();
});

test("a table rebuild that leaves a reference without its parent is refused and rolled back", () => {
  const db = database();
  const dropping = {
    id: "003_parent_drop",
    tableRebuild: true,
    up: `CREATE TABLE parents_next (parent_id TEXT PRIMARY KEY, label TEXT NOT NULL) STRICT;
DROP TABLE parents;
ALTER TABLE parents_next RENAME TO parents;`
  };
  assert.throws(() => applyRuntimeMigration(db, dropping, AT), {
    code: "VES_RUNTIME_MIGRATION_FOREIGN_KEY",
    message: "Table rebuild 003_parent_drop would leave a reference without its parent"
  });
  assert.equal(db.isTransaction, false);
  assert.equal(foreignKeys(db), 1);
  assert.deepEqual(ledger(db), []);
  assert.deepEqual(read(db, "SELECT * FROM parents"), [{ parent_id: "p1", label: "a" }]);
  db.close();
});

test("a table rebuild whose statement fails restores foreign keys", () => {
  const db = database();
  assert.throws(
    () => applyRuntimeMigration(db, { id: "003_broken", tableRebuild: true, up: "DROP TABLE absent;" }, AT),
    {
      message: /no such table: absent/u
    }
  );
  assert.equal(db.isTransaction, false);
  assert.equal(foreignKeys(db), 1);
  assert.deepEqual(ledger(db), []);
  db.close();
});
