import assert from "node:assert/strict";
import { test } from "node:test";

import { runCrossBackendJourney } from "../helpers/cross-backend-journey-fixture.mjs";

test("Jira create acknowledgement loss reconciles to one issue", async () => {
  const result = await runCrossBackendJourney({ jiraCreateAckLoss: true });
  assert.equal(result.jira.reconciliation.state, "applied");
  assert.equal(result.jira.transport.createCalls, 1);
  assert.equal(result.jira.transport.issues.size, 1);
  assert.equal(result.jira.receipt.outcome, "already-applied");
});

test("Confluence create acknowledgement loss reconciles to one owned section", async () => {
  const result = await runCrossBackendJourney({ confluenceCreateAckLoss: true });
  assert.equal(result.confluence.reconciliation.state, "applied");
  assert.equal(result.confluence.transport.createCalls, 1);
  assert.equal(result.confluence.transport.pages.size, 1);
  assert.equal(result.confluence.receipt.outcome, "already-applied");
});

test("task resume checkpoint reaches one gate commit without duplicate Tool effect", async () => {
  const result = await runCrossBackendJourney({ resumeTask: true });
  assert.equal(result.executionState.loadedCheckpoint.taskId, "T58.1");
  assert.equal(result.executionState.toolRequests.length, 1);
  assert.equal(result.gateState.commits.length, 1);
  assert.equal(result.gate.commitId, "b".repeat(40));
});
