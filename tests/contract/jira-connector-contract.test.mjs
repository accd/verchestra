import assert from "node:assert/strict";
import { test } from "node:test";

import {
  JiraClaimConnector,
  JiraConnectorError,
  buildJiraProjectionPlan,
  createJiraProjectionIntent
} from "../../packages/connectors/src/index.ts";
import { MockJiraTransport, projectionInput, sha, workspaceId } from "../helpers/jira-fixture.mjs";

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

// Issue #58 (T4k): the projection digest, the idempotency key derived from it,
// and the claim identity are Verchestra identities persisted in the Jira
// marker and claim record. Before the canonical JSON V2 migration their bytes
// came from a private recursive serializer that ordered object members with
// String.prototype.localeCompare, so two machines with different ambient
// locales could publish different digests for the same projection. Mocking
// localeCompare with a comparator that reverses code-unit order simulates a
// divergent locale without depending on any particular installed ICU locale
// disagreeing today.
async function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}

// Mixed-case, punctuation-bearing identifiers: by code unit "-" < "1" < "B" <
// "a" < "b", an order a language-sensitive collation does not reproduce.
const collationSensitiveInput = () =>
  projectionInput({
    package: { packageRef: "execution-package:Alpha", packageDigest: sha("package") },
    owner: { ownerRef: "owner:Team-AI", ownerDigest: sha("owner") },
    currentTaskIds: ["T-1", "T-a"],
    pendingTaskIds: ["T-B", "T-b"]
  });

test("projection digest and idempotency key are byte-identical under a hostile ambient collation", async () => {
  const baseline = buildJiraProjectionPlan(collationSensitiveInput());
  const hostile = await withHostileLocaleCompare(() => buildJiraProjectionPlan(collationSensitiveInput()));
  assert.equal(hostile.projectionDigest, baseline.projectionDigest);
  assert.equal(hostile.idempotencyKey, baseline.idempotencyKey);
  assert.equal(hostile.marker.projectionDigest, baseline.projectionDigest);
  assert.deepEqual(hostile.managed.currentTaskIds, ["T-1", "T-a"]);
  assert.deepEqual(hostile.managed.pendingTaskIds, ["T-B", "T-b"]);
});

test("Jira claim identity is byte-identical under a hostile ambient collation", async () => {
  const acquire = () =>
    new JiraClaimConnector({ transport: new MockJiraTransport() }).acquire({
      schemaVersion: 1,
      workspaceId,
      correlationId: "feature:Verchestra-1.0",
      owner: { runId: "run:Alpha", actorId: "actor:_beta" },
      now: "2026-07-15T10:00:00.000Z",
      expiresAt: "2026-07-15T10:05:00.000Z"
    });
  const baseline = await acquire();
  const hostile = await withHostileLocaleCompare(acquire);
  assert.equal(baseline.status, "acquired");
  assert.equal(hostile.status, "acquired");
  assert.equal(hostile.claim.claimId, baseline.claim.claimId);
});
