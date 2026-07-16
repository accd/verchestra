import assert from "node:assert/strict";
import { test } from "node:test";

import { runCrossBackendJourney } from "../helpers/cross-backend-journey-fixture.mjs";

test("Claude package reaches completed Human Review under OpenCode Qwen", async () => {
  const result = await runCrossBackendJourney();
  assert.equal(result.sourceBootstrap.status, "ready");
  assert.equal(result.receiverBootstrap.profile.drivers[0].passport.modelId, "qwen3-coder");
  assert.equal(result.packageVerification.ok, true);
  assert.equal(result.continued.status, "EXECUTION_AUTHORIZED");
  assert.equal(result.execution.status, "AWAITING_GATE");
  assert.equal(result.gate.status, "COMMITTED");
  assert.equal(result.verification.nextState, "HUMAN_REVIEW");
  assert.equal(result.review.status, "COMPLETED");
});

test("Grill and TLC evidence are sealed while the source machine uses Claude", async () => {
  const result = await runCrossBackendJourney();
  assert.equal(
    result.sourceBootstrap.profile.drivers.some((driver) => driver.driverId === "claude-code"),
    true
  );
  assert.deepEqual(
    result.sealedPackage.payload.discoveryEvidence.map((entry) => entry.artifactId),
    ["skill:grill-with-docs", "skill:tlc-spec-driven"]
  );
});

test("semantic obligations and first pending task survive backend change", async () => {
  const result = await runCrossBackendJourney();
  assert.equal(result.accepted.semanticObligationsDigest, result.semanticObligationsDigest);
  assert.deepEqual(result.accepted.pendingTaskIds, ["T58.1", "T59.1"]);
  assert.equal(result.continued.firstPendingTaskId, "T58.1");
});

test("Jira and Confluence point to the exact package and Handoff", async () => {
  const result = await runCrossBackendJourney();
  const issue = result.jira.transport.issues.values().next().value;
  const page = result.confluence.transport.pages.values().next().value;
  assert.equal(issue.managed.package.packageDigest, result.packageDigest);
  assert.equal(page.body.includes(result.packageDigest), true);
  assert.equal(page.body.includes(result.prepared.handoffDigest), true);
});

test("repeating every stable operation creates no duplicate logical effect", async () => {
  const result = await runCrossBackendJourney({ repeatStableOperations: true });
  assert.equal(result.handoffState.artifacts.size, 1);
  assert.equal(result.handoffState.finals.size, 1);
  assert.equal(result.handoffState.acceptances.size, 1);
  assert.equal(result.handoffState.continuations.size, 1);
  assert.equal(result.handoffState.capsules, 1);
  assert.equal(result.jira.transport.createCalls, 1);
  assert.equal(result.confluence.transport.createCalls, 1);
  assert.equal(result.gateState.commits.length, 1);
});

test("source and receiver bootstrap repeat without changing canonical package bytes", async () => {
  const result = await runCrossBackendJourney({ repeatBootstrap: true });
  assert.equal(result.sourceBootstrapRepeat.profileChanged, false);
  assert.equal(result.receiverBootstrapRepeat.profileChanged, false);
  assert.equal(result.sourceBootstrap.profileDigest, result.sourceBootstrapRepeat.profileDigest);
  assert.equal(result.receiverBootstrap.profileDigest, result.receiverBootstrapRepeat.profileDigest);
  assert.equal(result.packageDigestBeforeLocalRepeat, result.packageDigest);
});

test("receiver gets a fresh execution Approval and never inherits the source Approval", async () => {
  const result = await runCrossBackendJourney();
  assert.equal(result.accepted.successor.approval, undefined);
  assert.equal(result.prepared.source.approval, undefined);
  assert.equal(result.continued.successor.approval.bindingDigest, result.accepted.localBindingDigest);
  assert.notEqual(result.continued.successor.approval.bindingDigest, result.sourceApprovalBindingDigest);
});

test("Handoff publication, claim, Capsule, verification report, and review stay singular", async () => {
  const result = await runCrossBackendJourney({ repeatStableOperations: true });
  assert.equal(result.handoffState.effects, 1);
  assert.equal(result.handoffState.claimsDisposed, 1);
  assert.equal(result.handoffState.claimsAcquired, 1);
  assert.equal(result.verificationState.reports.length, 1);
  assert.equal(result.verificationState.reviews.length, 1);
});
