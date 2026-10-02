import assert from "node:assert/strict";
import { test } from "node:test";

import {
  coordinator,
  humanReviewCoordinator,
  humanReviewInput,
  humanReviewPorts,
  verificationInput,
  verificationPorts
} from "../helpers/verification-fixture.mjs";

const ordered = (values) => [...values].sort((left, right) => Number(left > right) - Number(left < right));

// why: a port the operation reads but the fixture does not supply surfaces as
// its bare name, so an undeclared read fails the equality instead of hiding.
function recording(ports) {
  const read = new Set();
  const operations = (port, target) =>
    new Proxy(target, {
      get(members, member) {
        read.add(`${port}.${String(member)}`);
        return members[member];
      }
    });
  const recorded = new Proxy(ports, {
    get(target, port) {
      if (!Object.hasOwn(target, port)) {
        read.add(String(port));
        return undefined;
      }
      return operations(port, target[port]);
    }
  });
  return { read, ports: recorded };
}

test("verification reads exactly the ports it declares", async () => {
  const input = verificationInput();
  input.evidenceClaims.pop();
  const { ports } = verificationPorts();
  const { read, ports: recorded } = recording(ports);
  const result = await coordinator(recorded).verify(input);
  assert.equal(result.verdict, "FAIL");
  assert.deepEqual(ordered(Object.keys(ports)), [
    "evidence",
    "expectations",
    "lessons",
    "reports",
    "sensor",
    "workflow"
  ]);
  assert.deepEqual(ordered(read), [
    "evidence.inspect",
    "expectations.derive",
    "lessons.record",
    "reports.save",
    "sensor.activeStateDigest",
    "sensor.run",
    "workflow.apply"
  ]);
});

test("Human Review reads exactly the ports it declares", async () => {
  const { ports } = humanReviewPorts();
  const { read, ports: recorded } = recording(ports);
  const result = await humanReviewCoordinator(recorded).review(humanReviewInput());
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(ordered(Object.keys(ports)), ["humanAuthority", "reports", "reviews", "workflow"]);
  assert.deepEqual(ordered(read), ["humanAuthority.verify", "reports.verify", "reviews.save", "workflow.apply"]);
});

test("neither coordinator carries the other operation", () => {
  assert.equal(coordinator(verificationPorts().ports).review, undefined);
  assert.equal(humanReviewCoordinator(humanReviewPorts().ports).verify, undefined);
});
