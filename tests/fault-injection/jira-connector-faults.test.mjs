import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJiraProjectionPlan, createJiraProjectionIntent } from "../../packages/connectors/src/index.ts";
import {
  MockJiraTransport,
  claimConnector,
  projectOnce,
  projectionFixture,
  projectionInput,
  readConnector,
  workspaceId
} from "../helpers/jira-fixture.mjs";

test("create acknowledgement loss reconciles by marker without second create", async () => {
  const transport = new MockJiraTransport();
  transport.failAfterCreate = true;
  const fixture = projectionFixture({ transport });
  const plan = buildJiraProjectionPlan(projectionInput());
  fixture.adapter.register(plan);
  const intent = createJiraProjectionIntent(plan, {
    effectId: "effect:jira:001",
    grantRef: "grant:jira:001",
    createdAt: "2026-07-15T10:00:00.000Z"
  });
  await fixture.broker.plan(intent);
  await assert.rejects(fixture.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_RECONCILIATION_REQUIRED" });
  const prior = await fixture.broker.reconcile(intent.idempotencyKey);
  assert.equal(prior.state, "applied");
  const receipt = await fixture.broker.execute(intent.idempotencyKey);
  assert.equal(receipt.outcome, "already-applied");
  assert.equal(transport.createCalls, 1);
});

test("update acknowledgement loss reconciles exact changed projection", async () => {
  const first = await projectOnce();
  first.transport.failAfterUpdate = true;
  const plan = buildJiraProjectionPlan(projectionInput({ state: "IMPLEMENTING", lastReconciledVersion: 1 }));
  first.adapter.register(plan);
  const intent = createJiraProjectionIntent(plan, {
    effectId: "effect:jira:002",
    grantRef: "grant:jira:001",
    createdAt: "2026-07-15T10:01:00.000Z"
  });
  await first.broker.plan(intent);
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_RECONCILIATION_REQUIRED" });
  assert.equal((await first.broker.reconcile(intent.idempotencyKey)).state, "applied");
  assert.equal(first.transport.updateCalls, 1);
});

test("stale expected Jira version is definite conflict and preserves issue", async () => {
  const first = await projectOnce();
  const plan = buildJiraProjectionPlan(projectionInput({ state: "IMPLEMENTING", lastReconciledVersion: 9 }));
  first.adapter.register(plan);
  const intent = createJiraProjectionIntent(plan, {
    effectId: "effect:jira:002",
    grantRef: "grant:jira:001",
    createdAt: "2026-07-15T10:01:00.000Z"
  });
  await first.broker.plan(intent);
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(first.transport.issues.values().next().value.version, 1);
});

test("nonzero canonical version cannot create a missing Jira issue", async () => {
  const transport = new MockJiraTransport();
  await assert.rejects(projectOnce(projectionInput({ lastReconciledVersion: 4 }), { transport }), {
    code: "VES_EFFECT_APPLY_FAILED"
  });
  assert.equal(transport.createCalls, 0);
});

for (const remaining of [0, -1]) {
  test(`rate exhaustion remaining=${remaining} fails before write`, async () => {
    const transport = new MockJiraTransport();
    transport.rate = { remaining, retryAfterMs: 1000 };
    await assert.rejects(projectOnce(projectionInput(), { transport }), { code: "VES_EFFECT_APPLY_FAILED" });
    assert.equal(transport.createCalls, 0);
  });
}

test("pagination cursor cycle fails closed", async () => {
  const transport = new MockJiraTransport();
  transport.listManaged = async () => ({ issues: [], nextCursor: "same", rate: transport.rate });
  await assert.rejects(
    readConnector(transport).list({
      schemaVersion: 1,
      workspaceId,
      projectKey: "VES",
      pageSize: 2,
      maximumPages: 3
    }),
    { code: "VES_JIRA_PAGINATION_INVALID" }
  );
});

test("pagination maximum is enforced without an unbounded fourth request", async () => {
  const transport = new MockJiraTransport();
  transport.listManaged = async ({ cursor }) => ({ issues: [], nextCursor: `${cursor ?? ""}x`, rate: transport.rate });
  await assert.rejects(
    readConnector(transport).list({
      schemaVersion: 1,
      workspaceId,
      projectKey: "VES",
      pageSize: 2,
      maximumPages: 3
    }),
    { code: "VES_JIRA_PAGINATION_LIMIT" }
  );
});

test("malformed remote issue cannot become trusted projection", async () => {
  const transport = new MockJiraTransport();
  transport.issues.set("VES:feature:bad", { issueId: "bad", projectKey: "VES" });
  await assert.rejects(
    readConnector(transport).list({
      schemaVersion: 1,
      workspaceId,
      projectKey: "VES",
      pageSize: 2,
      maximumPages: 3
    }),
    { code: "VES_JIRA_REMOTE_INVALID" }
  );
});

test("read page crossing a Jira project boundary fails closed", async () => {
  const transport = new MockJiraTransport();
  const projected = await projectOnce(projectionInput(), { transport });
  const issue = transport.issues.values().next().value;
  transport.listManaged = async () => ({ issues: [{ ...issue, projectKey: "OTHER" }], rate: transport.rate });
  await assert.rejects(
    readConnector(transport).list({
      schemaVersion: 1,
      workspaceId,
      projectKey: "VES",
      pageSize: 2,
      maximumPages: 3
    }),
    { code: "VES_JIRA_REMOTE_INVALID" }
  );
  assert.equal(projected.receipt.outcome, "applied");
});

test("claim compare-and-swap race returns the winning lease without overwrite", async () => {
  const transport = new MockJiraTransport();
  const original = transport.compareAndSwapClaim.bind(transport);
  transport.compareAndSwapClaim = async (request) => {
    if (!transport.claims.has(request.correlationId)) {
      await original({
        ...request,
        claim: {
          ...request.claim,
          claimId: "jira-claim:winner",
          owner: { runId: "run:winner", actorId: "actor:winner" }
        }
      });
    }
    return {
      status: "conflict",
      claim: transport.claims.get(request.correlationId),
      rate: transport.rate
    };
  };
  const result = await claimConnector(transport).acquire({
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:race",
    owner: { runId: "run:loser", actorId: "actor:loser" },
    now: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z"
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.claim.owner.runId, "run:winner");
  assert.equal(transport.claims.get("feature:race").owner.runId, "run:winner");
});
