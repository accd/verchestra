import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MockJiraTransport,
  projectOnce,
  projectionInput,
  readConnector,
  workspaceId
} from "../helpers/jira-fixture.mjs";

const readInput = (overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  projectKey: "VES",
  pageSize: 10,
  maximumPages: 5,
  ...overrides
});

async function transportWithTwoProjections() {
  const transport = new MockJiraTransport();
  await projectOnce(projectionInput(), { transport });
  await projectOnce(projectionInput({ correlationId: "feature:verchestra-1.1" }), { transport });
  return transport;
}

test("a managed read follows every page and marks each issue as a managed projection", async () => {
  const transport = await transportWithTwoProjections();
  transport.pageSize = 1;
  transport.calls.length = 0;
  const result = await readConnector(transport).list(readInput());
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.workspaceId, workspaceId);
  assert.deepEqual(
    result.items.map((item) => [item.correlationId, item.provenance]),
    [
      ["feature:verchestra-1.0", "jira-managed-projection"],
      ["feature:verchestra-1.1", "jira-managed-projection"]
    ]
  );
  assert.deepEqual(transport.calls, ["list:start", "list:1"]);
  assert.equal(Object.isFrozen(result.items), true);
});

for (const pageSize of [0, 101, 1.5, "10"]) {
  test(`a managed read refuses page size ${JSON.stringify(pageSize)}`, async () => {
    await assert.rejects(readConnector(new MockJiraTransport()).list(readInput({ pageSize })), {
      code: "VES_JIRA_READ_INVALID",
      message: "pageSize must be from 1 through 100"
    });
  });
}

for (const maximumPages of [0, 101, Number.NaN]) {
  test(`a managed read refuses a page bound of ${maximumPages}`, async () => {
    await assert.rejects(readConnector(new MockJiraTransport()).list(readInput({ maximumPages })), {
      code: "VES_JIRA_READ_INVALID",
      message: "maximumPages must be from 1 through 100"
    });
  });
}

test("the page size is checked before the page bound", async () => {
  await assert.rejects(readConnector(new MockJiraTransport()).list(readInput({ pageSize: 0, maximumPages: 0 })), {
    message: "pageSize must be from 1 through 100"
  });
});

test("a page whose issues are not a list is refused", async () => {
  const transport = new MockJiraTransport();
  transport.listManaged = async () => ({ issues: "none", rate: transport.rate });
  await assert.rejects(readConnector(transport).list(readInput()), {
    code: "VES_JIRA_REMOTE_INVALID",
    message: "Jira page issues are invalid"
  });
});

test("an issue from another project is refused", async () => {
  const transport = await transportWithTwoProjections();
  const issues = [...transport.issues.values()];
  transport.listManaged = async () => ({
    issues: [issues[0], { ...issues[1], projectKey: "OTHER" }],
    rate: transport.rate
  });
  await assert.rejects(readConnector(transport).list(readInput()), {
    code: "VES_JIRA_REMOTE_INVALID",
    message: "Jira page crossed project boundary"
  });
});

test("a repeated pagination cursor is refused", async () => {
  const transport = new MockJiraTransport();
  transport.listManaged = async () => ({ issues: [], nextCursor: "again", rate: transport.rate });
  await assert.rejects(readConnector(transport).list(readInput()), {
    code: "VES_JIRA_PAGINATION_INVALID",
    message: "Jira pagination cursor repeated"
  });
});

test("a read that needs more pages than its bound is refused", async () => {
  const transport = await transportWithTwoProjections();
  transport.pageSize = 1;
  await assert.rejects(readConnector(transport).list(readInput({ maximumPages: 1 })), {
    code: "VES_JIRA_PAGINATION_LIMIT",
    message: "Jira result exceeded the configured page bound"
  });
});
