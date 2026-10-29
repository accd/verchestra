// invariant: door 3 of .specs/features/database-registration/plan.md. A
// definition file is read relative to the directory `vestra` runs in, judged
// for its shape as an argument, and turned into a registration document only
// through the data-probe normalizers.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { readDefinition, registrationDocument } from "../../apps/vestra-cli/src/database/database-definition.ts";

const WORKSPACE_ID = "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

function definition() {
  return {
    schemaVersion: 1,
    database: {
      databaseId: "orders",
      engine: "postgresql",
      logicalEnvironment: "production",
      classification: "confidential",
      approvedSchemas: ["sales", "public"],
      schemaSourceRefs: ["repo:db/migrations"],
      allowedPurposes: ["schema-discovery"],
      logicalCredentialName: "orders-reader",
      production: true
    },
    policy: {
      allowedObjects: ["public.orders"],
      allowedFunctions: ["count"],
      deniedFunctions: [],
      allowCatalogAccess: false,
      maxTimeoutMs: 5_000,
      maxRows: 100,
      maxBytes: 1_048_576,
      maxConcurrency: 2
    }
  };
}

test("a definition path is read relative to the control root", async () => {
  const root = await mkdtemp(join(tmpdir(), "vdd-"));
  roots.push(root);
  await writeFile(join(root, "orders.json"), JSON.stringify(definition()));
  const read = await readDefinition(root, "orders.json");
  assert.deepEqual(read, { database: definition().database, policy: definition().policy });
  assert.ok(Object.isFrozen(read));
  await assert.rejects(readDefinition(root, "missing.json"), (error) => {
    assert.equal(error.envelope.code, "VES_CLI_ARGUMENT_INVALID");
    assert.deepEqual(error.envelope.safeDetails, { argument: "--definition" });
    return true;
  });
});

test("a registration document carries the Workspace id and its own policy reference", () => {
  const document = registrationDocument(definition(), WORKSPACE_ID, "2026-10-29T10:00:00.000Z");
  assert.equal(document.registration.workspaceId, WORKSPACE_ID);
  assert.equal(document.registration.policyRef, "orders");
  assert.deepEqual(document.registration.approvedSchemas, ["public", "sales"]);
  assert.equal(document.policy.policyRef, "orders");
  assert.equal(document.registeredAt, "2026-10-29T10:00:00.000Z");
  assert.ok(Object.isFrozen(document));
  const underscored = definition();
  underscored.database.logicalCredentialName = "orders_reader";
  assert.throws(() => registrationDocument(underscored, WORKSPACE_ID, "2026-10-29T10:00:00.000Z"), {
    code: "VES_DATABASE_REGISTRATION_INVALID"
  });
});
