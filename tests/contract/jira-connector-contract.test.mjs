import assert from "node:assert/strict";
import { test } from "node:test";

import {
  JiraConnectorError,
  buildJiraProjectionPlan,
  createJiraProjectionIntent
} from "../../packages/connectors/src/index.ts";
import { projectionInput, sha } from "../helpers/jira-fixture.mjs";

test("projection plan contains every required managed Jira field", () => {
  const plan = buildJiraProjectionPlan(projectionInput());
  assert.deepEqual(Object.keys(plan.managed).sort(), [
    "approvalStatus",
    "canonicalRevisionDigest",
    "currentTaskIds",
    "lastReconciledVersion",
    "owner",
    "package",
    "pendingTaskIds",
    "state",
    "workClaim"
  ]);
});

test("stable marker binds correlation package and projection digest", () => {
  const plan = buildJiraProjectionPlan(projectionInput());
  assert.deepEqual(plan.marker, {
    schemaVersion: 1,
    product: "verchestra",
    correlationId: "feature:verchestra-1.0",
    packageDigest: sha("package"),
    projectionDigest: plan.projectionDigest
  });
});

test("canonical projection identity ignores input collection order", () => {
  const left = buildJiraProjectionPlan(projectionInput());
  const right = buildJiraProjectionPlan(projectionInput({ currentTaskIds: ["T61"], pendingTaskIds: ["T63", "T62"] }));
  assert.equal(left.projectionDigest, right.projectionDigest);
  assert.equal(left.idempotencyKey, right.idempotencyKey);
});

for (const [field, value] of [
  ["package", { packageRef: "execution-package:001", packageDigest: "bad" }],
  ["state", "UNKNOWN"],
  ["approvalStatus", "maybe"],
  ["lastReconciledVersion", -1],
  ["currentTaskIds", []],
  ["pendingTaskIds", ["T62", "T62"]]
]) {
  test(`projection rejects invalid ${field}`, () => {
    assert.throws(() => buildJiraProjectionPlan(projectionInput({ [field]: value })), JiraConnectorError);
  });
}

test("projection rejects unknown fields before effect planning", () => {
  assert.throws(
    () => buildJiraProjectionPlan({ ...projectionInput(), jiraPayload: { fields: { summary: "override" } } }),
    {
      code: "VES_JIRA_PROJECTION_INVALID"
    }
  );
});

test("effect intent exactly binds plan identity and high-risk authority", () => {
  const plan = buildJiraProjectionPlan(projectionInput());
  const intent = createJiraProjectionIntent(plan, {
    effectId: "effect:jira:001",
    grantRef: "grant:jira:001",
    createdAt: "2026-07-15T10:00:00.000Z"
  });
  assert.equal(intent.canonicalInputDigest, plan.projectionDigest);
  assert.equal(intent.semanticIdentity, plan.correlationId);
  assert.equal(intent.riskTier, "high");
});
