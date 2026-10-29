// invariant: the fixture of .specs/features/probe-run/checks.md, shared by the
// in-process command test and the launcher test: a SQLite file holding
// `main.orders` with 3 rows, registered as `orders` (engine `sqlite`, purpose
// `diagnostics`, allowedObjects [`main.orders`], maxRows 100); a SQLite worker
// over data-probe's real read connection, approved with the file's path as its
// argument; and a request reading one order by its id. A case names only what
// it changes.
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export const SENTINEL = "PARAM-7f3a-SENTINEL";
export const ORIGIN = "https://fixture-user:fixture-token@example.invalid/acme/orders.git";
export const REFERENCE_SOURCE = fileURLToPath(
  new URL("../fixtures/probe-workers/reference-worker.mjs", import.meta.url)
);
const SQLITE_MODULE = new URL("../fixtures/probe-workers/sqlite-worker.mjs", import.meta.url);

export const SQLITE_WORKER = Object.freeze({
  skill: "acme-orders-sqlite",
  extension: "plugin:acme-orders-sqlite",
  ref: "orders-sqlite",
  entry: "probe/sqlite-worker.mjs"
});
// why: the reference worker answers its handshake as this extension id unless
// told otherwise, so it needs no environment of its own beyond its mode.
export const REFERENCE_WORKER = Object.freeze({
  skill: "acme-orders-probe",
  extension: "plugin:acme-orders-probe",
  ref: "orders-probe",
  entry: "probe/worker.mjs"
});

// why: the Workspace's entry for the SQLite worker: one line that runs the
// fixture module under the extension id it is registered as.
export function sqliteWorkerEntry() {
  return [
    "// A Workspace probe worker: the SQLite fixture worker of the probe-run checks.",
    `import { serveSqliteProbe } from ${JSON.stringify(SQLITE_MODULE.href)};`,
    "",
    `serveSqliteProbe({ componentId: ${JSON.stringify(SQLITE_WORKER.extension)} });`,
    ""
  ].join("\n");
}

// why: the worker's approved argument naming the database file (see
// tests/fixtures/probe-workers/sqlite-worker.mjs).
export const databaseArgument = (path) => `--title=${path}`;

export function ordersDatabase(path) {
  const db = new DatabaseSync(path);
  try {
    db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO orders(id, status) VALUES (?, ?)");
    for (const [id, status] of [
      [1, "paid"],
      [2, "pending"],
      [3, "shipped"]
    ])
      insert.run(id, status);
  } finally {
    db.close();
  }
}

export function ordersDefinition({ database = {}, policy = {} } = {}) {
  return {
    schemaVersion: 1,
    database: {
      databaseId: "orders",
      engine: "sqlite",
      logicalEnvironment: "staging",
      classification: "confidential",
      approvedSchemas: ["main"],
      schemaSourceRefs: ["repo:db/orders.sql"],
      allowedPurposes: ["diagnostics"],
      logicalCredentialName: "orders-reader",
      production: false,
      ...database
    },
    policy: {
      allowedObjects: ["main.orders"],
      allowedFunctions: ["count"],
      deniedFunctions: [],
      allowCatalogAccess: false,
      maxTimeoutMs: 20_000,
      maxRows: 100,
      maxBytes: 1_048_576,
      maxConcurrency: 2,
      ...policy
    }
  };
}

// why: a valid PostgreSQL registration, which no probe can run yet (AC 9).
export function postgresDefinition() {
  return ordersDefinition({
    database: { databaseId: "orders-pg", engine: "postgresql", approvedSchemas: ["public"] },
    policy: { allowedObjects: ["public.orders"] }
  });
}

// why: SQLite's parser reads only main-qualified objects, so the statement of
// the checks' fixture names `main.orders`.
export function probeRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    purpose: "diagnostics",
    sql: "SELECT id, status FROM main.orders WHERE id = ?",
    parameters: [1],
    bounds: { timeoutMs: 20_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
    ...overrides
  };
}

export function bindingDigestOf(review) {
  return /^ {2}binding digest: +(sha256:[0-9a-f]{64})$/mu.exec(review)?.[1];
}

// why: a committed repository with an origin whose URL carries credentials
// (registration records only the public form), and each worker's entry.
export async function installWorkers(fixture, workers) {
  fixture.git(["remote", "add", "origin", ORIGIN]);
  await mkdir(join(fixture.repository, "probe"), { recursive: true });
  for (const worker of workers) {
    const path = join(fixture.repository, ...worker.entry.split("/"));
    if (worker === SQLITE_WORKER) await writeFile(path, sqliteWorkerEntry());
    else await copyFile(REFERENCE_SOURCE, path);
  }
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "--quiet", "-m", "probe workers"]);
}
