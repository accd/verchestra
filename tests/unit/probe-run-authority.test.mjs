// invariant: doors 2 and 3 of .specs/features/probe-run/plan.md (AD-086), at
// their own layer: the probe approval's binding and review lists, the grant the
// broker issues under the built-in probe policy view and its mapping to the
// probe host's admission grant, and that a probe approval satisfies no task
// check. The authority store is a real runtime store holding a probe run.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";

import { ApprovalRequester, ApprovalVerifier, CapabilityBroker } from "../../packages/application/src/index.ts";
import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner
} from "../../packages/data-probe/src/index.ts";
import { FixedClock, IsoInstant, canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { NodeContentDigest, RuntimeAuthorityStore } from "../../packages/platform-node/src/index.ts";
import {
  DATABASE_READ,
  EMPTY_CONTEXT_DIGEST,
  PROBE_GRANT_LIFETIME_MS,
  PROBE_POLICY,
  ProbeAuthority,
  loadProbePolicy,
  probeApprovalIntent,
  probeGrantRequest
} from "../../apps/vestra-cli/src/probe/probe-authority.ts";
import { admissionGrant } from "../../apps/vestra-cli/src/probe/probe-run.ts";
import { sqliteStatement } from "../../apps/vestra-cli/src/probe/probe-statement.ts";
import { approvalVerification } from "../../apps/vestra-cli/src/task/task-authority.ts";
import { policy, registration, workspaceId } from "../helpers/database-probe-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

const EXTENSION_ID = "plugin:acme-orders-sqlite";
const LAUNCH_DIGEST = `sha256:${"4".repeat(64)}`;
const APPROVER = "human:local-operator";
const digest = new NodeContentDigest();
const NOT_APPLICABLE = ["not-applicable"];

// why: the plan of the checks' fixture: `orders`, a SQLite registration whose
// policy admits `main.orders`, read by its id under purpose `diagnostics`.
async function fixturePlan(grantRef = "pending-grant") {
  const registered = registration({
    engine: "sqlite",
    databaseId: "orders",
    approvedSchemas: ["main"],
    allowedPurposes: ["diagnostics"],
    policyRef: "orders"
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  const { registration: normalized } = await registry.register(registered);
  const statement = sqliteStatement(
    {
      purpose: "diagnostics",
      sql: "SELECT id, status FROM main.orders WHERE id = ?",
      parameters: [1],
      bounds: {}
    },
    normalized
  );
  const planner = new ProbePlanner({ registry, adapters: [statement.adapter] });
  return planner.plan(
    {
      schemaVersion: 1,
      workspaceId,
      requestId: "probe-request-001",
      databaseId: "orders",
      purpose: "diagnostics",
      operation: statement.operation,
      bounds: { timeoutMs: 2_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
      grantRef
    },
    policy({ policyRef: "orders", allowedObjects: ["main.orders"] })
  );
}

function subject(plan, runId = `run_${randomUUID()}`) {
  return { workspaceId, runId, plan, extensionId: EXTENSION_ID, launchDigest: LAUNCH_DIGEST };
}

// why: a probe run in a real runtime store, and the authority over it, with a
// Workspace evidence key of the test's own.
async function authority() {
  const { store } = await opened({ now: () => new Date().toISOString() });
  const runId = `run_${randomUUID()}`;
  store.createRun({
    runId,
    runKind: "probe",
    state: "EXECUTION_READY",
    version: 0,
    repairCycles: 0,
    approval: undefined,
    terminalCapsuleRequired: false
  });
  const signer = NodeEd25519Signer.generate({ keyId: "workspace-task-evidence", purposes: ["approval"] });
  const trust = createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [signer.publicKeyRef] });
  const probePolicy = await loadProbePolicy();
  return {
    store,
    runId,
    signer,
    trust,
    probePolicy,
    authority: new ProbeAuthority({ runtime: store, trust, policy: probePolicy })
  };
}

test("the probe approval binds the run as door 2 writes it", async () => {
  const plan = await fixturePlan();
  const probePolicy = await loadProbePolicy();
  const expiresAt = new Date(Date.now() + PROBE_GRANT_LIFETIME_MS).toISOString();
  const runSubject = subject(plan);
  const request = new ApprovalRequester({
    digest,
    clock: new FixedClock(IsoInstant.fromDate(new Date())),
    uuid: randomUUID
  }).request(probeApprovalIntent({ ...runSubject, expiresAt }, probePolicy.digest));
  const { binding, review } = request;
  assert.equal(binding.action, "probe-execution");
  assert.equal(binding.runId, runSubject.runId);
  assert.equal(binding.packageDigest, plan.statementFingerprint);
  assert.equal(binding.sourceStateDigest, plan.registrationDigest);
  assert.equal(binding.policyDigest, probePolicy.digest);
  const empty = `sha256:${createHash("sha256").update("{}").digest("hex")}`;
  assert.equal(EMPTY_CONTEXT_DIGEST, empty);
  for (const field of ["contextRecipeDigest", "semanticObligationsDigest", "contextManifestDigest"])
    assert.equal(binding[field], empty, field);
  assert.deepEqual(review.capabilities, ["database-read"]);
  assert.deepEqual(review.scope, ["database:orders"]);
  assert.deepEqual(review.dataAccess, ["main.orders"]);
  assert.deepEqual(review.selectedPassports, [EXTENSION_ID]);
  assert.deepEqual(review.budgets, ["rows:100", "bytes:100000", "timeout-ms:2000", "concurrency:1"]);
  assert.deepEqual(review.evidenceRefs, [`registration:${plan.registrationDigest}`, `launch:${LAUNCH_DIGEST}`]);
  for (const list of [
    "protectedPaths",
    "tasks",
    "destinations",
    "claims",
    "gates",
    "risks",
    "assumptions",
    "completionCriteria"
  ])
    assert.deepEqual(review[list], NOT_APPLICABLE, list);
  assert.equal(request.bindingDigest, digest.sha256(canonicalizeJsonV2(binding)));
});

test("the probe grant and its admission grant are shaped as door 3 writes them", async () => {
  const { store, runId, signer, probePolicy, authority: probeAuthority } = await authority();
  assert.equal(
    PROBE_POLICY,
    `permit(principal, action == Vestra::Action::"database-read", resource) when { context.approved };`
  );
  assert.deepEqual(probePolicy.view.layers, { builtIn: { databaseRead: PROBE_POLICY } });
  const plan = await fixturePlan();
  const runSubject = subject(plan, runId);
  const expiresAt = new Date(Date.now() + PROBE_GRANT_LIFETIME_MS).toISOString();
  const approval = await probeAuthority.record(probeAuthority.request({ ...runSubject, expiresAt }), signer);
  const issuedAt = IsoInstant.parse("2026-10-29T12:00:00.000Z");
  const decision = probePolicy.authorize({
    principal: { type: "Vestra::Actor", id: APPROVER },
    action: { type: "Vestra::Action", id: DATABASE_READ },
    resource: { type: "Vestra::Database", id: "orders" },
    context: { approved: true }
  });
  assert.equal(decision.decision, "allow");
  const request = probeGrantRequest({ approval, subject: runSubject, decision, issuedAt });
  assert.deepEqual(request.principal, { type: "Vestra::Actor", id: APPROVER });
  assert.deepEqual(request.action, { type: "Vestra::Action", id: "database-read" });
  assert.deepEqual(request.resource, { type: "Vestra::Database", id: "orders" });
  assert.equal(request.capability, "database-read");
  assert.deepEqual(request.constraints, [
    "databaseId:orders",
    `registrationDigest:${plan.registrationDigest}`,
    `statementFingerprint:${plan.statementFingerprint}`,
    `extensionId:${EXTENSION_ID}`,
    `launchDigest:${LAUNCH_DIGEST}`
  ]);
  assert.equal(request.expiresAt, "2026-10-29T12:10:00.000Z");
  assert.equal(request.policyDecision.policyViewDigest, probePolicy.digest);
  assert.deepEqual(request.approvalRef, { approvalId: approval.approvalId, bindingDigest: approval.bindingDigest });

  const grant = await probeAuthority.grant(approval, runSubject);
  assert.equal(grant.runId, runId);
  assert.equal(grant.capability, "database-read");
  assert.deepEqual(grant.constraints, request.constraints);
  assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.issuedAt), PROBE_GRANT_LIFETIME_MS);
  const extension = {
    lockDigest: `sha256:${"1".repeat(64)}`,
    skillId: "acme-orders-sqlite",
    extensionRef: { kind: "plugin", id: EXTENSION_ID, approvalRef: "orders-sqlite" },
    entry: { path: "probe/sqlite-worker.mjs", digest: `sha256:${"2".repeat(64)}` }
  };
  assert.deepEqual(admissionGrant(grant, { extension, approval: { launchDigest: LAUNCH_DIGEST } }), {
    grantRef: grant.grantId,
    workspaceId,
    lockDigest: extension.lockDigest,
    extensionId: EXTENSION_ID,
    approvalRef: "orders-sqlite",
    componentDigest: extension.entry.digest,
    launchDigest: LAUNCH_DIGEST,
    capabilities: ["database-read"],
    isolationProfile: "process-contained",
    risk: "approved-workspace-executable"
  });
  assert.equal(await probeAuthority.revoke(grant.grantId, "probe-run-ended"), true);
  assert.ok(Number.isFinite(Date.parse((await new RuntimeAuthorityStore(store).loadGrant(grant.grantId)).revokedAt)));
});

test("a probe approval satisfies no task check", async () => {
  const { store, runId, signer, trust, probePolicy, authority: probeAuthority } = await authority();
  const plan = await fixturePlan();
  const expiresAt = new Date(Date.now() + PROBE_GRANT_LIFETIME_MS).toISOString();
  const approval = await probeAuthority.record(probeAuthority.request({ ...subject(plan, runId), expiresAt }), signer);
  const authorityStore = new RuntimeAuthorityStore(store);
  const clock = new FixedClock(IsoInstant.fromDate(new Date()));
  const verifier = new ApprovalVerifier({
    store: authorityStore,
    digest,
    clock,
    artifacts: approvalVerification(trust)
  });
  assert.equal((await verifier.verify(approval.approvalId, approval.binding)).valid, true);
  const asExecution = { ...approval.binding, action: "execution" };
  assert.deepEqual(await verifier.verify(approval.approvalId, asExecution), {
    valid: false,
    code: "VES_APPROVAL_STALE"
  });
  const broker = new CapabilityBroker({
    store: authorityStore,
    digest,
    clock,
    uuid: randomUUID,
    approvals: verifier,
    policy: { authorize: async () => ({ decision: "allow", policyViewDigest: probePolicy.digest }) }
  });
  // why: the task writer grant `task start` requests, shaped as TaskAuthority
  // shapes it, offered the probe approval.
  const taskGrant = (currentApprovalBinding) => ({
    principal: { type: "Vestra::Actor", id: "task-implementer" },
    action: { type: "Vestra::Action", id: "tool-effect" },
    resource: { type: "Vestra::Task", id: "T1" },
    workspaceId,
    runId,
    constraints: ["scope:src"],
    capability: "worktree-write",
    expiresAt,
    approvalRef: { approvalId: approval.approvalId, bindingDigest: approval.bindingDigest },
    currentApprovalBinding,
    policyDecision: { decision: "allow", policyViewDigest: probePolicy.digest, evidenceDigest: EMPTY_CONTEXT_DIGEST },
    policyRequest: {}
  });
  for (const [label, binding] of [
    ["the binding of a task's execution approval", asExecution],
    ["the probe approval's own binding", approval.binding]
  ])
    await assert.rejects(broker.grant(taskGrant(binding)), { code: "VES_CAPABILITY_APPROVAL_INVALID" }, label);
});
