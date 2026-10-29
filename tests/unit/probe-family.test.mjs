// invariant: the pieces of `vestra probe run` (.specs/features/probe-run/plan.md)
// that hold on every platform, below the command: the SQLite statement and its
// engine adapter, the review, the guard on the plan a worker runs, and the
// public error of every refusal. The command's own cases run in
// tests/contract/probe-run-command.test.mjs.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DatabaseProbeError,
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner,
  normalizeDatabaseRegistration
} from "../../packages/data-probe/src/index.ts";
import { PublicErrorException } from "../../packages/domain/src/index.ts";
import {
  PROBE_PUBLIC_ERROR_DEFINITIONS,
  ProbeRefusal,
  probeError,
  probePublicError,
  probePublicErrorRegistry
} from "../../apps/vestra-cli/src/probe/probe-errors.ts";
import { renderProbeReview } from "../../apps/vestra-cli/src/probe/probe-review.ts";
import { assertPlanApproved } from "../../apps/vestra-cli/src/probe/probe-run.ts";
import { sqliteEngineAdapter, sqliteStatement } from "../../apps/vestra-cli/src/probe/probe-statement.ts";
import { taskError } from "../../apps/vestra-cli/src/task/task-errors.ts";
import { policy, registration } from "../helpers/database-probe-fixture.mjs";

const SQL = "SELECT id, status FROM main.orders WHERE id = ?";
const sqlite = normalizeDatabaseRegistration(
  registration({ engine: "sqlite", databaseId: "orders", approvedSchemas: ["main"], policyRef: "orders" })
);

const request = (overrides = {}) => ({
  purpose: "schema-discovery",
  sql: SQL,
  parameters: [1],
  bounds: {},
  ...overrides
});

test("a statement is read as one SQLite select whose parameters are classified as the database is", () => {
  const sql = "SELECT id FROM main.orders WHERE status = ? OR id = ? OR id = ? OR status = ?";
  const statement = sqliteStatement(request({ sql, parameters: ["paid", 7, true, null] }), sqlite);
  assert.equal(statement.operation.kind, "select");
  assert.match(statement.operation.protectedRequestRef, /^protected-request:[a-f0-9-]{36}$/u);
  assert.deepEqual(statement.operation.objects, [{ schema: "main", name: "orders", type: "table" }]);
  assert.deepEqual(statement.operation.parameterClassifications, Array(4).fill("confidential"));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(statement.protectedRequest)), {
    schemaVersion: 1,
    sql,
    parameters: ["paid", 7, true, null]
  });
  assert.notEqual(
    sqliteStatement(request(), sqlite).operation.protectedRequestRef,
    statement.operation.protectedRequestRef,
    "each request is protected under a reference of its own"
  );
  for (const [label, parameters] of [
    ["no list", "paid"],
    ["more than 64", Array(65).fill(1)],
    ["an object", [{ id: 1 }]],
    ["a list", [[1]]]
  ])
    assert.throws(
      () => sqliteStatement(request({ parameters }), sqlite),
      { code: "VES_SQLITE_PARAMETERS_INVALID" },
      label
    );
  assert.throws(() => sqliteStatement(request({ sql: "DELETE FROM orders", parameters: [] }), sqlite), {
    code: "VES_SQLITE_WRITE_DENIED"
  });
});

test("the SQLite engine adapter admits only the statement's own operation in main", async () => {
  const options = {
    kind: "select",
    protectedRequestRef: "protected-request:0123456789abcdef",
    parameterClassifications: ["confidential"]
  };
  const adapter = sqliteEngineAdapter(SQL, options);
  assert.equal(adapter.engine, "sqlite");
  const own = sqliteStatement(request(), sqlite).operation;
  const operation = { ...own, protectedRequestRef: options.protectedRequestRef };
  assert.deepEqual(adapter.validateNormalizedOperation(operation, sqlite), []);
  const codes = (value, registered = sqlite) =>
    adapter.validateNormalizedOperation(value, registered).map((violation) => violation.code);
  assert.deepEqual(codes(operation, { ...sqlite, engine: "postgresql" }), ["VES_PROBE_ENGINE_UNAVAILABLE"]);
  assert.deepEqual(codes({ ...operation, objects: [{ schema: "temp", name: "orders", type: "table" }] }), [
    "VES_SQLITE_DATABASE_CONTROL_DENIED",
    "VES_SQLITE_PLAN_MISMATCH"
  ]);
  assert.deepEqual(codes({ ...operation, protectedRequestRef: "protected-request:fedcba9876543210" }), [
    "VES_SQLITE_PLAN_MISMATCH"
  ]);

  // why: a worker re-reads the statement with the plan's classifications, so
  // the plan keeps one per bind; two binds of one class plan, and the engine
  // adapter admits them (.specs/features/probe-multi-parameter/checks.md).
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(
    registration({ engine: "sqlite", databaseId: "orders", approvedSchemas: ["main"], policyRef: "orders" })
  );
  const plan = (sql, parameters) => {
    const statement = sqliteStatement(request({ sql, parameters }), sqlite);
    return new ProbePlanner({ registry, adapters: [statement.adapter] }).plan(
      {
        schemaVersion: 1,
        workspaceId: sqlite.workspaceId,
        requestId: "probe-request-001",
        databaseId: "orders",
        purpose: "schema-discovery",
        operation: statement.operation,
        bounds: { timeoutMs: 2_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
        grantRef: "pending-grant"
      },
      policy({ policyRef: "orders", allowedObjects: ["main.orders"] })
    );
  };
  assert.equal((await plan(SQL, [1])).engine, "sqlite");
  const twoBinds = await plan("SELECT id FROM main.orders WHERE id = ? OR id = ?", [1, 2]);
  assert.deepEqual(twoBinds.operation.parameterClassifications, [sqlite.classification, sqlite.classification]);
});

test("the review names the run and never the statement or its parameters", () => {
  const plan = {
    databaseId: "orders",
    engine: "sqlite",
    logicalEnvironment: "staging",
    classification: "confidential",
    production: false,
    purpose: "diagnostics",
    statementFingerprint: `sha256:${"5".repeat(64)}`,
    operation: { objects: [{ schema: "main", name: "orders", type: "table" }] },
    bounds: { timeoutMs: 2_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 }
  };
  const review = renderProbeReview({
    runId: "run_018f0b6d-7b1a-7abc-8def-0123456789ab",
    plan,
    extensionId: "plugin:acme-orders-sqlite",
    launchDigest: `sha256:${"6".repeat(64)}`,
    bindingDigest: `sha256:${"7".repeat(64)}`
  });
  assert.equal(
    review,
    [
      "Approve probe run run_018f0b6d-7b1a-7abc-8def-0123456789ab:",
      "  database:              orders",
      "  engine:                sqlite",
      "  logical environment:   staging",
      "  classification:        confidential",
      "  production:            false",
      "  purpose:               diagnostics",
      `  statement fingerprint: sha256:${"5".repeat(64)}`,
      "  objects read:          main.orders",
      "  bounds:                rows 100, bytes 100000, timeout-ms 2000, concurrency 1",
      "  worker:                plugin:acme-orders-sqlite",
      `  launch digest:         sha256:${"6".repeat(64)}`,
      `  binding digest:        sha256:${"7".repeat(64)}`,
      ""
    ].join("\n")
  );
});

test("the plan a worker runs is the approved one but for its grant", () => {
  const approved = { databaseId: "orders", bounds: { rowLimit: 100 }, grantRef: "pending-grant", planDigest: "a" };
  assert.doesNotThrow(() => assertPlanApproved({ ...approved, grantRef: "grant_1", planDigest: "b" }, approved));
  assert.throws(
    () =>
      assertPlanApproved({ ...approved, bounds: { rowLimit: 101 }, grantRef: "grant_1", planDigest: "b" }, approved),
    (error) => error instanceof PublicErrorException && error.envelope.code === "VES_PROBE_PLAN_CHANGED"
  );
});

test("a probe refusal leaves as one public envelope", () => {
  assert.ok(Object.isFrozen(PROBE_PUBLIC_ERROR_DEFINITIONS));
  assert.equal(probePublicErrorRegistry.codes.length, PROBE_PUBLIC_ERROR_DEFINITIONS.length);
  for (const definition of PROBE_PUBLIC_ERROR_DEFINITIONS) {
    assert.equal(definition.component, "probe", definition.code);
    assert.equal(definition.documentationVersion, "1", definition.code);
    assert.ok(definition.recovery.length > 0, definition.code);
  }
  // A public refusal stays as it is.
  const refusal = taskError("VES_TASK_CONFIRMATION_REQUIRED", {}, "not typed back");
  assert.equal(probePublicError(refusal), refusal);
  // A parser, planner, supervisor or host code becomes its own envelope.
  for (const code of [
    "VES_SQLITE_WRITE_DENIED",
    "VES_PROBE_OBJECT_DENIED",
    "VES_PROBE_SECRET_LEAK",
    "VES_PROBE_WORKSPACE_TRUST_APPROVAL",
    "VES_PROBE_HOST_LAUNCH_DIGEST",
    "VES_PROBE_HOST_TERMINATION_INCOMPLETE"
  ]) {
    const cause = new ProbeRefusal(code, "internal detail that never reaches an envelope");
    const mapped = probePublicError(cause);
    assert.equal(mapped.envelope.code, code);
    assert.equal(mapped.envelope.component, "probe");
    assert.deepEqual(mapped.envelope.safeDetails, {});
    assert.equal(mapped.cause, cause);
  }
  // A code the database or extension family owns keeps that family's envelope.
  assert.equal(
    probePublicError(new DatabaseProbeError("VES_DATABASE_NOT_FOUND", "absent")).envelope.component,
    "database"
  );
  const entry = probePublicError(new ProbeRefusal("VES_PROBE_HOST_ENTRY_DIGEST", "edited")).envelope;
  assert.deepEqual([entry.code, entry.component], ["VES_PROBE_HOST_ENTRY_DIGEST", "extension"]);
  const lock = probePublicError(new ProbeRefusal("VES_SKILL_LOCK_INVALID", "lock")).envelope;
  assert.deepEqual([lock.code, lock.safeDetails], ["VES_EXTENSION_LOCK_REFUSED", { reason: "VES_SKILL_LOCK_INVALID" }]);
  // Anything else is VES_PROBE_FAILED with its stable code as the reason.
  const other = probePublicError(new ProbeRefusal("VES_CAPABILITY_POLICY_DENIED", "denied")).envelope;
  assert.deepEqual([other.code, other.safeDetails], ["VES_PROBE_FAILED", { reason: "VES_CAPABILITY_POLICY_DENIED" }]);
  assert.equal(probeError("VES_PROBE_FAILED", { reason: "VES_X" }, "failed").envelope.category, "external");
});
