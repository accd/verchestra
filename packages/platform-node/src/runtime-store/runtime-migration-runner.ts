import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { RuntimeMigration } from "./runtime-migrations.ts";
import { mapSqliteError, runtimeError } from "./runtime-sqlite.ts";

// invariant: the checksum a store records for a migration and compares on
// every open. It is the digest of `up` alone, so a flag on the migration never
// changes the checksum of a migration a store already applied.
export function runtimeMigrationChecksum(migration: RuntimeMigration): string {
  return createHash("sha256").update(migration.up).digest("hex");
}

// invariant: one migration is one transaction, recorded in the ledger in the
// same commit or not at all. A table rebuild (AD-086) follows SQLite's
// documented procedure: foreign keys go off before the transaction, because
// dropping a referenced table fails a transaction that enforces them, deferred
// or not; the rebuild commits only when no row is left referencing a missing
// parent; and foreign keys are back on afterwards whatever happened, since the
// connection goes on serving the store.
export function applyRuntimeMigration(db: DatabaseSync, migration: RuntimeMigration, appliedAt: string): void {
  const rebuild = migration.tableRebuild === true;
  if (rebuild) db.exec("PRAGMA foreign_keys=OFF");
  try {
    db.exec("BEGIN IMMEDIATE");
    db.exec(migration.up);
    if (rebuild && db.prepare("PRAGMA foreign_key_check").get() !== undefined) {
      throw runtimeError(
        "VES_RUNTIME_MIGRATION_FOREIGN_KEY",
        `Table rebuild ${migration.id} would leave a reference without its parent`
      );
    }
    db.prepare("INSERT INTO ves_migrations(id, checksum, applied_at) VALUES (?, ?, ?)").run(
      migration.id,
      runtimeMigrationChecksum(migration),
      appliedAt
    );
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw mapSqliteError(error);
  } finally {
    if (rebuild) db.exec("PRAGMA foreign_keys=ON");
  }
}
