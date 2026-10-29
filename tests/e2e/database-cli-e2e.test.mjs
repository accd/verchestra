// invariant: the independent test of .specs/features/database-registration/plan.md.
// The real `vestra` binary registers a PostgreSQL database in a disposable
// Workspace, refuses a changed policy for it, lists it, reports it invalid
// once its file is edited, and removes it; nothing connects to a database.
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { LINUX, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";

const TIMEOUT = { timeout: 600_000 };

afterEach(cleanupTaskFixtures);

// why: the fixture database is PostgreSQL `orders` with policy maxRows 100;
// a case names only what it changes.
function definition(policy = {}) {
  return {
    schemaVersion: 1,
    database: {
      databaseId: "orders",
      engine: "postgresql",
      logicalEnvironment: "production",
      classification: "confidential",
      approvedSchemas: ["public", "sales"],
      schemaSourceRefs: ["repo:db/migrations"],
      allowedPurposes: ["schema-discovery"],
      logicalCredentialName: "orders-reader",
      production: true
    },
    policy: {
      allowedObjects: ["public.orders", "sales.invoices"],
      allowedFunctions: ["count", "sum"],
      deniedFunctions: ["pg_read_file"],
      allowCatalogAccess: false,
      maxTimeoutMs: 5_000,
      maxRows: 100,
      maxBytes: 1_048_576,
      maxConcurrency: 2,
      ...policy
    }
  };
}

function vestra(fixture, argv) {
  const result = fixture.launch(["database", ...argv, "--output", "json"]);
  assert.ok(result.json !== undefined, `no JSON envelope: ${result.stderr}\n${result.stdout}`);
  return result;
}

function succeeded(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.json.ok, true, label);
  return result.json.data;
}

function refused(result, code, status, label) {
  assert.equal(result.status, status, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.json.ok, false, label);
  assert.equal(result.json.error.code, code, `${label}: ${JSON.stringify(result.json.error)}`);
}

test("the plan's independent test", TIMEOUT, async () => {
  const fixture = await taskFixture({ secretService: LINUX });
  const path = join(fixture.root, "orders.json");
  const changed = join(fixture.root, "orders-changed.json");
  await writeFile(path, JSON.stringify(definition()));
  await writeFile(changed, JSON.stringify(definition({ maxRows: 200 })));
  const add = (file) => vestra(fixture, ["add", "--definition", file, ...fixture.keychainArgs]);
  const list = () => succeeded(vestra(fixture, ["list"]), "list").databases;

  const first = succeeded(add(path), "add");
  assert.equal(first.databaseId, "orders");
  assert.match(first.registrationDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(first.created, true);
  const registration = join(fixture.repository, ".verchestra", "databases", "orders.json");
  const written = await readFile(registration);
  assert.deepEqual(succeeded(add(path), "add again"), { ...first, created: false });
  refused(add(changed), "VES_DATABASE_REGISTRATION_CONFLICT", 5, "a changed policy");
  assert.deepEqual(await readFile(registration), written);

  assert.deepEqual(list(), [
    {
      databaseId: "orders",
      engine: "postgresql",
      logicalEnvironment: "production",
      classification: "confidential",
      production: true,
      registrationDigest: first.registrationDigest,
      state: "valid"
    }
  ]);

  // An edited maxRows no longer verifies.
  const envelope = JSON.parse(written.toString("utf8"));
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  assert.equal(statement.predicate.content.policy.maxRows, 100);
  statement.predicate.content.policy.maxRows = 100_000;
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(registration, JSON.stringify(envelope));
  assert.deepEqual(list(), [{ databaseId: "orders", state: "invalid" }]);

  assert.deepEqual(succeeded(vestra(fixture, ["remove", "--database", "orders"]), "remove"), {
    databaseId: "orders",
    removed: true
  });
  assert.deepEqual(await readdir(join(fixture.repository, ".verchestra", "databases")), []);
  assert.deepEqual(list(), []);
});
