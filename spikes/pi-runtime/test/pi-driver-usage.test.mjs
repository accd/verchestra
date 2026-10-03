// invariant: requalification of the Pi driver for the usage rule (ADR2-6).
// The production PiDriver reads the token counts its runtime relays through
// the one usage rule every driver uses, where it emitted them unchecked. The
// provider is Pi's own DETERMINISTIC faux machinery: a stream that ends with
// one message carrying the given usage and stop reason. No model is invoked.
import assert from "node:assert/strict";
import { test } from "node:test";

import { PiDriver } from "../../../packages/drivers/src/index.ts";
import { brief } from "../../../tests/helpers/driver-cancel-order-fixture.mjs";
import { piUsageFixture } from "../../../tests/helpers/pi-driver-fixture.mjs";

const STARTED = ["session.started", "model.resolved"];
const REFUSED = [...STARTED, "error:VES_PI_RUNTIME_FAILED", "session.closed:failed"];

// invariant: each case is pinned whole through the close: the event
// sequence, the counts of its usage event when it has one, and the outcome
// the close answers.
const CASES = [
  {
    name: "reports its counts as text",
    usage: { input: "12", output: "3" },
    sequence: [...STARTED, "usage.updated", "session.closed:completed"],
    counts: [12, 3],
    outcome: "completed"
  },
  {
    name: "leaves its input count out",
    usage: { output: 3 },
    sequence: [...STARTED, "usage.updated", "session.closed:completed"],
    counts: [0, 3],
    outcome: "completed"
  },
  {
    name: "reports its input count as null",
    usage: { input: null, output: 3 },
    sequence: [...STARTED, "usage.updated", "session.closed:completed"],
    counts: [0, 3],
    outcome: "completed"
  },
  {
    name: "reports its counts as a boolean and a one-element array",
    usage: { input: true, output: [3] },
    sequence: [...STARTED, "usage.updated", "session.closed:completed"],
    counts: [1, 3],
    outcome: "completed"
  },
  { name: "reports a negative count", usage: { input: -1, output: 3 }, sequence: REFUSED, outcome: "failed" },
  { name: "reports a fractional count", usage: { input: 1.5, output: 3 }, sequence: REFUSED, outcome: "failed" },
  {
    name: "reports a count past the safe integers",
    usage: { input: Number.MAX_SAFE_INTEGER + 1, output: 3 },
    sequence: REFUSED,
    outcome: "failed"
  },
  {
    name: "fails with a negative count",
    usage: { input: -1, output: 0 },
    stopReason: "error",
    sequence: REFUSED,
    outcome: "failed"
  },
  {
    name: "is aborted with a negative count",
    usage: { input: -1, output: 0 },
    stopReason: "aborted",
    sequence: [...STARTED, "error:VES_PI_ABORTED", "session.closed:cancelled"],
    outcome: "cancelled"
  }
];

for (const entry of CASES)
  test(`pi: a runtime that ${entry.name} is reported as pinned`, async () => {
    const fixture = piUsageFixture(entry.usage, entry.stopReason);
    const driver = new PiDriver(fixture.dependencies());
    const events = [];
    const reference = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
    const closed = await driver.close(reference);
    assert.deepEqual(brief(events), entry.sequence);
    const usage = events.find((event) => event.type === "usage.updated");
    if (entry.counts !== undefined) assert.deepEqual([usage.inputTokens, usage.outputTokens], entry.counts);
    assert.equal(closed.outcome, entry.outcome);
  });
