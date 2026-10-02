import assert from "node:assert/strict";
import { test } from "node:test";

import { DriverSessionLedger } from "../../packages/drivers/src/driver-session-ledger.ts";
import { DriverProtocolError } from "../../packages/drivers/src/index.ts";

// why: the session ledger's contract is asserted here, at its own interface,
// once for every driver. tests/contract/driver-lifecycle-matrix.test.mjs proves
// that each driver answers the same contract at runtime.

const REFERENCE = Object.freeze({ sessionId: "fixture-session:1" });

function opened(options = {}, resources = undefined) {
  const events = [];
  const ledger = new DriverSessionLedger({ noun: "Fixture", ...options });
  const session = ledger.open(REFERENCE.sessionId, (event) => events.push(event), resources);
  return { ledger, session, events };
}

function terminalEvents(events) {
  return events.filter((event) => event.type === "session.closed");
}

function refusal(code, message) {
  return (error) => {
    assert.ok(error instanceof DriverProtocolError);
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.deepEqual(
      { terminateHost: error.terminateHost, revokeGrants: error.revokeGrants, cancel: error.cancellationRequired },
      { terminateHost: false, revokeGrants: false, cancel: false }
    );
    return true;
  };
}

test("an emitted event is frozen, keeps its fields, and is numbered from zero without a gap", () => {
  const { session, events } = opened();
  session.emit({ type: "session.started", sessionId: REFERENCE.sessionId });
  session.emit({ type: "content.delta", text: "a" });
  session.emit({ type: "usage.updated", inputTokens: 3, outputTokens: 1 });
  assert.deepEqual(events, [
    { type: "session.started", sessionId: REFERENCE.sessionId, sequence: 0 },
    { type: "content.delta", text: "a", sequence: 1 },
    { type: "usage.updated", inputTokens: 3, outputTokens: 1, sequence: 2 }
  ]);
  assert.equal(events.every(Object.isFrozen), true);
});

test("an event cannot choose its own sequence number", () => {
  const { session, events } = opened();
  session.emit({ type: "content.delta", text: "a", sequence: 41 });
  assert.equal(events[0].sequence, 0);
});

test("the sink sees an event before its sequence number is spent", () => {
  const delivered = [];
  let refuse = true;
  const ledger = new DriverSessionLedger({ noun: "Fixture" });
  const session = ledger.open(
    REFERENCE.sessionId,
    (event) => {
      if (refuse) throw new Error("sink refused");
      delivered.push(event);
    },
    undefined
  );
  assert.throws(() => session.emit({ type: "content.delta", text: "lost" }), /sink refused/u);
  refuse = false;
  session.emit({ type: "content.delta", text: "kept" });
  assert.deepEqual(delivered, [{ type: "content.delta", text: "kept", sequence: 0 }]);
  assert.equal(ledger.close(REFERENCE).finalSequence, 2);
});

test("a terminal event the sink refuses is not counted as emitted", () => {
  const delivered = [];
  let refuse = true;
  const ledger = new DriverSessionLedger({ noun: "Fixture" });
  ledger.open(
    REFERENCE.sessionId,
    (event) => {
      if (refuse) throw new Error("sink refused");
      delivered.push(event);
    },
    undefined
  );
  assert.throws(() => ledger.close(REFERENCE), /sink refused/u);
  refuse = false;
  assert.deepEqual(ledger.close(REFERENCE), {
    sessionId: REFERENCE.sessionId,
    closed: true,
    outcome: "completed",
    finalSequence: 1
  });
  assert.deepEqual(delivered, [{ type: "session.closed", outcome: "completed", sequence: 0 }]);
});

test("close emits one terminal event with the outcome and no reason, and reports the final sequence", () => {
  const { ledger, session, events } = opened();
  session.emit({ type: "session.started", sessionId: REFERENCE.sessionId });
  const closed = ledger.close(REFERENCE);
  assert.deepEqual(events.at(-1), { type: "session.closed", outcome: "completed", sequence: 1 });
  assert.equal(Object.hasOwn(events.at(-1), "reason"), false);
  assert.deepEqual(closed, { sessionId: REFERENCE.sessionId, closed: true, outcome: "completed", finalSequence: 2 });
  assert.equal(Object.isFrozen(closed), true);
});

for (const outcome of ["failed", "cancelled"]) {
  test(`close reports the ${outcome} outcome the driver recorded`, () => {
    const { ledger, session, events } = opened();
    session.outcome = outcome;
    assert.equal(ledger.close(REFERENCE).outcome, outcome);
    assert.deepEqual(events, [{ type: "session.closed", outcome, sequence: 0 }]);
  });
}

test("a repeated close answers already closed and emits nothing", () => {
  const { ledger, events } = opened();
  ledger.close(REFERENCE);
  const repeated = ledger.close(REFERENCE);
  assert.deepEqual(repeated, { sessionId: REFERENCE.sessionId, closed: true, alreadyClosed: true });
  assert.equal(Object.isFrozen(repeated), true);
  assert.equal(terminalEvents(events).length, 1);
  assert.equal(events.length, 1);
});

test("cancel emits one terminal event with the cancelled outcome and the reason", async () => {
  const { ledger, session, events } = opened();
  session.emit({ type: "session.started", sessionId: REFERENCE.sessionId });
  await ledger.cancel(REFERENCE, "user-request");
  assert.deepEqual(events.at(-1), {
    type: "session.closed",
    outcome: "cancelled",
    reason: "user-request",
    sequence: 1
  });
  assert.equal(session.outcome, "cancelled");
});

test("a repeated cancel emits nothing and stops nothing", async () => {
  let stopped = 0;
  const { ledger, events } = opened({
    stop: () => {
      stopped += 1;
      return undefined;
    }
  });
  await ledger.cancel(REFERENCE, "user-request");
  await ledger.cancel(REFERENCE, "second-request");
  assert.equal(stopped, 1);
  assert.deepEqual(events, [{ type: "session.closed", outcome: "cancelled", reason: "user-request", sequence: 0 }]);
});

test("close after cancel emits nothing more and reports the cancelled session", async () => {
  const { ledger, events } = opened();
  await ledger.cancel(REFERENCE, "user-request");
  assert.deepEqual(ledger.close(REFERENCE), {
    sessionId: REFERENCE.sessionId,
    closed: true,
    outcome: "cancelled",
    finalSequence: 1
  });
  assert.equal(terminalEvents(events).length, 1);
});

test("cancel after close is accepted, emits nothing, and stops nothing", async () => {
  let stopped = 0;
  const { ledger, events } = opened({
    stop: () => {
      stopped += 1;
      return undefined;
    }
  });
  ledger.close(REFERENCE);
  await ledger.cancel(REFERENCE, "late");
  assert.equal(stopped, 0);
  assert.deepEqual(events, [{ type: "session.closed", outcome: "completed", sequence: 0 }]);
});

test("an event emitted after the terminal event is still delivered and numbered", async () => {
  // hazard: a provider run that is cancelled through the driver reports how it
  // ended after the terminal event; that report must not be dropped.
  const { ledger, session, events } = opened();
  await ledger.cancel(REFERENCE, "user-request");
  session.emit({ type: "error", code: "VES_FIXTURE_ABORTED", message: "Fixture was aborted", retryable: true });
  assert.equal(events.at(-1).sequence, 1);
  assert.equal(ledger.close(REFERENCE).finalSequence, 2);
  session.emit({ type: "warning", code: "VES_FIXTURE_LATE", message: "late" });
  assert.equal(events.at(-1).sequence, 2);
  assert.equal(terminalEvents(events).length, 1);
});

for (const noun of ["Claude Code", "Pi Driver"]) {
  test(`an unknown reference is refused under the shared code and the ${noun} noun`, async () => {
    const ledger = new DriverSessionLedger({ noun });
    const unknown = { sessionId: "fixture-session:never-opened" };
    const expected = refusal("VES_DRIVER_SESSION_UNKNOWN", `${noun} session is unknown`);
    assert.throws(() => ledger.close(unknown), expected);
    assert.throws(() => ledger.active(unknown), expected);
    await assert.rejects(ledger.cancel(unknown, "user-request"), expected);
  });
}

test("active returns the open session, refuses a cancelled one as closed and a closed one as unknown", async () => {
  const { ledger, session } = opened({ noun: "Pi Driver" });
  assert.equal(ledger.active(REFERENCE), session);
  await ledger.cancel(REFERENCE, "user-request");
  assert.throws(() => ledger.active(REFERENCE), refusal("VES_DRIVER_SESSION_CLOSED", "Pi Driver session is closed"));
  ledger.close(REFERENCE);
  assert.throws(() => ledger.active(REFERENCE), refusal("VES_DRIVER_SESSION_UNKNOWN", "Pi Driver session is unknown"));
});

test("a session reference is valid only in the ledger that opened it", async () => {
  const { ledger: owner, events } = opened();
  const other = new DriverSessionLedger({ noun: "Fixture" });
  assert.throws(() => other.close(REFERENCE), refusal("VES_DRIVER_SESSION_UNKNOWN", "Fixture session is unknown"));
  await assert.rejects(other.cancel(REFERENCE, "user-request"), { code: "VES_DRIVER_SESSION_UNKNOWN" });
  assert.equal(events.length, 0);
  assert.equal(owner.close(REFERENCE).outcome, "completed");
});

test("sessions of one ledger are numbered and closed independently", () => {
  const first = [];
  const second = [];
  const ledger = new DriverSessionLedger({ noun: "Fixture" });
  const one = ledger.open("fixture-session:1", (event) => first.push(event), undefined);
  const two = ledger.open("fixture-session:2", (event) => second.push(event), undefined);
  one.emit({ type: "content.delta", text: "a" });
  one.emit({ type: "content.delta", text: "b" });
  two.emit({ type: "content.delta", text: "c" });
  assert.equal(ledger.close({ sessionId: "fixture-session:1" }).finalSequence, 3);
  assert.deepEqual(
    second.map((event) => event.sequence),
    [0]
  );
  assert.equal(ledger.active({ sessionId: "fixture-session:2" }), two);
});

test("the session carries the resources the driver opened it with", () => {
  const resources = { child: undefined };
  const { session } = opened({}, resources);
  assert.equal(session.resources, resources);
});

test("the stop hook receives the session and finishes before the terminal event", async () => {
  const order = [];
  let finish;
  const stopped = new Promise((resolve) => (finish = resolve));
  const { ledger, session, events } = opened({
    stop: (stopping) => {
      order.push(["stop", stopping === session, events.length]);
      return stopped.then(() => {
        order.push(["stopped", events.length]);
      });
    }
  });
  const cancelling = ledger.cancel(REFERENCE, "user-request");
  assert.equal(events.length, 0);
  finish();
  await cancelling;
  assert.deepEqual(order, [
    ["stop", true, 0],
    ["stopped", 0]
  ]);
  assert.equal(terminalEvents(events).length, 1);
});

test("a cancel with nothing to wait for emits the terminal event in the caller's own turn", () => {
  const { ledger, events } = opened({ stop: () => undefined });
  const cancelling = ledger.cancel(REFERENCE, "user-request");
  assert.equal(terminalEvents(events).length, 1);
  return cancelling;
});

test("a stop hook that fails leaves the session open, uncancelled, and cancellable", async () => {
  let fail = true;
  const { ledger, session, events } = opened({
    stop: async () => {
      if (fail) throw new Error("terminator failed");
    }
  });
  await assert.rejects(ledger.cancel(REFERENCE, "user-request"), /terminator failed/u);
  assert.equal(events.length, 0);
  assert.equal(session.outcome, "completed");
  assert.equal(ledger.active(REFERENCE), session);
  fail = false;
  await ledger.cancel(REFERENCE, "user-request");
  assert.equal(events.at(-1).outcome, "cancelled");
});

test("the release hook runs after the terminal event, on cancel and again on the first close", async () => {
  const released = [];
  const { ledger, session, events } = opened({
    release: (releasing) => released.push([releasing === session, terminalEvents(events).length])
  });
  await ledger.cancel(REFERENCE, "user-request");
  assert.deepEqual(released, [[true, 1]]);
  await ledger.cancel(REFERENCE, "user-request");
  assert.equal(released.length, 1);
  ledger.close(REFERENCE);
  assert.deepEqual(released, [
    [true, 1],
    [true, 1]
  ]);
  ledger.close(REFERENCE);
  assert.equal(released.length, 2);
});

test("the release hook runs on a close that was not cancelled", () => {
  const released = [];
  const { ledger, events } = opened({ release: () => released.push(terminalEvents(events).length) });
  ledger.close(REFERENCE);
  assert.deepEqual(released, [1]);
});

test("a release hook that throws on close leaves the session known, so the close can be repeated", () => {
  let fail = true;
  const { ledger, events } = opened({
    release: () => {
      if (fail) throw new Error("release failed");
    }
  });
  assert.throws(() => ledger.close(REFERENCE), /release failed/u);
  fail = false;
  assert.deepEqual(ledger.close(REFERENCE), {
    sessionId: REFERENCE.sessionId,
    closed: true,
    outcome: "completed",
    finalSequence: 1
  });
  assert.equal(terminalEvents(events).length, 1);
});
