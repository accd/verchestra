import assert from "node:assert/strict";
import { test } from "node:test";

import { buildJiraProjectionPlan, createJiraProjectionIntent } from "../../packages/connectors/src/index.ts";
import {
  MockJiraTransport,
  claimConnector,
  projectOnce,
  projectionInput,
  readConnector,
  sha,
  workspaceId
} from "../helpers/jira-fixture.mjs";

test("new projection creates one Jira issue with only managed fields", async () => {
  const { transport, plan, receipt } = await projectOnce();
  assert.equal(transport.createCalls, 1);
  assert.equal(receipt.outcome, "applied");
  assert.deepEqual(transport.issues.values().next().value.managed, plan.managed);
});

test("repeated projection returns one observable issue", async () => {
  const result = await projectOnce();
  const second = await result.broker.execute(result.intent.idempotencyKey);
  assert.deepEqual(second, result.receipt);
  assert.equal(result.transport.createCalls, 1);
});

test("changed canonical projection updates with optimistic version", async () => {
  const first = await projectOnce();
  const nextPlan = buildJiraProjectionPlan(
    projectionInput({ state: "IMPLEMENTING", lastReconciledVersion: 1, currentTaskIds: ["T62"] })
  );
  first.adapter.register(nextPlan);
  const intent = createJiraProjectionIntent(nextPlan, {
    effectId: "effect:jira:projection:002",
    grantRef: "grant:jira:managed:001",
    createdAt: "2026-07-15T10:01:00.000Z"
  });
  await first.broker.plan(intent);
  await first.broker.execute(intent.idempotencyKey);
  assert.equal(first.transport.updateCalls, 1);
  assert.equal(first.transport.issues.values().next().value.version, 2);
});

test("human edit to managed fields reports drift and preserves remote content", async () => {
  const first = await projectOnce();
  const issue = first.transport.issues.values().next().value;
  issue.managed = { ...issue.managed, state: "BLOCKED" };
  issue.managedDigest = sha("human-edit");
  const nextPlan = buildJiraProjectionPlan(projectionInput({ state: "IMPLEMENTING", lastReconciledVersion: 1 }));
  first.adapter.register(nextPlan);
  const intent = createJiraProjectionIntent(nextPlan, {
    effectId: "effect:jira:projection:002",
    grantRef: "grant:jira:managed:001",
    createdAt: "2026-07-15T10:01:00.000Z"
  });
  await first.broker.plan(intent);
  await assert.rejects(first.broker.execute(intent.idempotencyKey), { code: "VES_EFFECT_APPLY_FAILED" });
  assert.equal(issue.managed.state, "BLOCKED");
});

test("read connector returns bounded provenance over every page", async () => {
  const transport = new MockJiraTransport();
  for (let index = 0; index < 5; index += 1) {
    await projectOnce(projectionInput({ correlationId: `feature:${index}` }), { transport });
  }
  const result = await readConnector(transport).list({
    schemaVersion: 1,
    workspaceId,
    projectKey: "VES",
    pageSize: 2,
    maximumPages: 3
  });
  assert.equal(result.items.length, 5);
  assert.ok(result.items.every((item) => item.provenance === "jira-managed-projection"));
});

test("claim acquire creates fencing token one", async () => {
  const transport = new MockJiraTransport();
  const result = await claimConnector(transport).acquire({
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:claim",
    owner: { runId: "run:receiver", actorId: "actor:receiver" },
    now: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z"
  });
  assert.equal(result.status, "acquired");
  assert.equal(result.claim.fencingToken, 1);
});

test("same active claim owner reuses the lease without a second CAS", async () => {
  const transport = new MockJiraTransport();
  const connector = claimConnector(transport);
  const input = {
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:claim",
    owner: { runId: "run:receiver", actorId: "actor:receiver" },
    now: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z"
  };
  const first = await connector.acquire(input);
  const second = await connector.acquire({ ...input, now: "2026-07-15T10:01:00.000Z" });
  assert.equal(second.status, "acquired");
  assert.equal(second.claim.claimId, first.claim.claimId);
  assert.equal(transport.calls.filter((call) => call === "claim:cas").length, 1);
});

test("active claim race returns conflict without overwrite", async () => {
  const transport = new MockJiraTransport();
  const connector = claimConnector(transport);
  const base = {
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:claim",
    now: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z"
  };
  await connector.acquire({ ...base, owner: { runId: "run:one", actorId: "actor:one" } });
  const conflict = await connector.acquire({ ...base, owner: { runId: "run:two", actorId: "actor:two" } });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.claim.owner.runId, "run:one");
});

test("expired claim takeover increments fencing token", async () => {
  const transport = new MockJiraTransport();
  const connector = claimConnector(transport);
  await connector.acquire({
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:claim",
    owner: { runId: "run:one", actorId: "actor:one" },
    now: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T10:10:00.000Z"
  });
  const next = await connector.acquire({
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:claim",
    owner: { runId: "run:two", actorId: "actor:two" },
    now: "2026-07-15T10:20:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z"
  });
  assert.equal(next.status, "acquired");
  assert.equal(next.claim.fencingToken, 2);
});

test("claim heartbeat and release require exact fencing reference", async () => {
  const transport = new MockJiraTransport();
  const connector = claimConnector(transport);
  const acquired = await connector.acquire({
    schemaVersion: 1,
    workspaceId,
    correlationId: "feature:claim",
    owner: { runId: "run:one", actorId: "actor:one" },
    now: "2026-07-15T10:00:00.000Z",
    expiresAt: "2026-07-15T11:00:00.000Z"
  });
  assert.equal(
    await connector.heartbeat({ ...acquired.claim, fencingToken: 99, expiresAt: "2026-07-15T12:00:00.000Z" }),
    false
  );
  assert.equal(await connector.release({ ...acquired.claim, fencingToken: 99 }, "handoff"), false);
  assert.equal(await connector.release(acquired.claim, "handoff"), true);
});
