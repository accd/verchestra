import assert from "node:assert/strict";
import { test } from "node:test";

import { TaskScheduleCoordinator } from "../../packages/application/src/index.ts";
import {
  MockConfluenceDeliveryTransport,
  deliverOnce,
  deliveryInput
} from "../helpers/confluence-delivery-fixture.mjs";
import { flush, scheduleInput, scheduleTask, schedulerPorts } from "../helpers/task-scheduler-fixture.mjs";

// SonarCloud S3358 (T8): two more nested conditionals became flat code. These
// pin every outcome they choose between.

const humanPage = (body) => {
  const transport = new MockConfluenceDeliveryTransport();
  const input = deliveryInput({ lastReconciledVersion: 1 });
  transport.pages.set(`${input.spaceKey}:${input.pageId}`, {
    spaceKey: input.spaceKey,
    pageId: input.pageId,
    version: 1,
    title: input.title,
    body
  });
  return transport;
};

for (const [label, body, prefix] of [
  ["an empty page", "", ""],
  ["a page ending in a newline", "Human notes.\n", "Human notes.\n"],
  ["a page with no final newline", "Human notes.", "Human notes.\n"]
]) {
  test(`the owned section is appended to ${label} on a line of its own`, async () => {
    const delivered = await deliverOnce(deliveryInput({ lastReconciledVersion: 1 }), { transport: humanPage(body) });
    const page = delivered.transport.pages.get(`${delivered.plan.spaceKey}:${delivered.plan.pageId}`);
    assert.equal(page.body, `${prefix}${delivered.plan.ownedSection}`);
  });
}

const schedule = async (settle, options = {}) => {
  const { ports, release } = schedulerPorts();
  const pending = new TaskScheduleCoordinator(ports).execute(scheduleInput([scheduleTask("T1")]), options);
  await flush();
  settle(release);
  return pending;
};

test("a schedule whose tasks all complete reports completed", async () => {
  assert.equal((await schedule((release) => release("T1"))).status, "completed");
});

test("a schedule with a failed task reports failed", async () => {
  assert.equal((await schedule((release) => release("T1", { status: "failed" }))).status, "failed");
});

test("a schedule aborted while a task runs reports cancelled, not failed", async () => {
  const controller = new AbortController();
  const report = await schedule(
    (release) => {
      controller.abort();
      release("T1", { status: "failed" });
    },
    { signal: controller.signal }
  );
  assert.equal(report.status, "cancelled");
});
