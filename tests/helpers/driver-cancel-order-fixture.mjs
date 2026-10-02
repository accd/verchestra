// why: the fixture of the cancel order suites. The four drivers are held to one
// contract for how a stopped session ends: the run reports how it ended, one
// terminal event follows, nothing follows that event, and `close` reports what
// it said. The rows are read by the lifecycle matrix, which asserts the
// contract, and `cancelOrderSuite` pins each driver's exact event sequence in
// its qualification suite.
// invariant: every provider here is a labeled fake. Claude Code and Codex run
// the repository's fake executables, OpenCode its fake SDK client, and Pi its
// faux provider. No model is invoked.
import assert from "node:assert/strict";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";

import { ClaudeCodeDriver, CodexDriver, OpenCodeDriver, PiDriver } from "../../packages/drivers/src/index.ts";
import { claudeFixture } from "./claude-driver-fixture.mjs";
import { codexFixture } from "./codex-driver-fixture.mjs";
import { openCodeFixture, openCodeLingeringFixture } from "./opencode-driver-fixture.mjs";
import { piAbortableFixture, piFixture } from "./pi-driver-fixture.mjs";

export const CANCEL_REASON = "user-request";
const RUNNER_REASON = "stopped by Verchestra";
const STARTED = Object.freeze(["session.started", "model.resolved"]);

// invariant: an event as its type and what identifies how a session ended: the
// code of an error, or the outcome and the reason of a terminal event.
export function brief(events) {
  return events.map(({ type, outcome, reason, code }) =>
    [type, ...[outcome, reason, type === "error" ? code : undefined].filter(Boolean)].join(":")
  );
}

// why: Claude Code and Codex are child processes. `stops()` counts how often
// the injected terminator was asked.
function childProcessRow(Driver, fixtureOf, modeVariable, sequences) {
  const build = (mode, dependencies = {}) => {
    const fixture = fixtureOf({ environment: { [modeVariable]: mode } });
    return {
      driver: new Driver(fixture.dependencies(dependencies)),
      request: fixture.request(),
      running: Promise.resolve(),
      stops: () => fixture.calls.terminate
    };
  };
  return {
    ...sequences,
    hanging: () => build("hang"),
    failing: () => build("error"),
    // why: no terminator is injected, so the stop is the driver's own
    // fallback, which resolves on every platform when the provider is already
    // gone. The stream failure and the cancel both ask for that stop.
    garbled: () => build("garbled", { terminateTree: undefined }),
    lingering: null
  };
}

function sdkRow(Driver, { hanging, failing, lingering, stops }, sequences) {
  const build = (fixture) => ({
    driver: new Driver(fixture.dependencies()),
    request: fixture.request(),
    running: fixture.running ?? Promise.resolve(),
    stops: () => stops(fixture),
    release: fixture.release
  });
  return {
    ...sequences,
    hanging: () => build(hanging()),
    failing: () => build(failing()),
    garbled: null,
    lingering: lingering === undefined ? null : () => build(lingering())
  };
}

// invariant: one row per driver. `aborted` is what a stopped run reports,
// `failed` what a failing run reports, and `broken` the report of a stream
// that failed before the stop; `garbled` is null where a driver reports every
// failure the moment it happens. `lingering` builds a run that can report only
// after `release()`; it is null where a stopped run always reports late, in the
// exit handler of its provider or after its agent is idle.
export const CANCEL_ORDER_ROWS = Object.freeze({
  "claude-code": childProcessRow(ClaudeCodeDriver, claudeFixture, "FAKE_CLAUDE_MODE", {
    aborted: ["error:VES_CLAUDE_ABORTED"],
    failed: ["usage.updated", "error:VES_CLAUDE_EXECUTION_FAILED"],
    broken: "error:VES_CLAUDE_STREAM_INVALID"
  }),
  codex: childProcessRow(CodexDriver, codexFixture, "FAKE_CODEX_MODE", {
    aborted: ["error:VES_CODEX_ABORTED"],
    failed: ["error:VES_CODEX_EXECUTION_FAILED", "usage.updated"],
    broken: "error:VES_CODEX_STREAM_INVALID"
  }),
  opencode: sdkRow(
    OpenCodeDriver,
    {
      hanging: () => openCodeFixture({}, "hang"),
      failing: () => openCodeFixture({}, "error"),
      lingering: () => openCodeLingeringFixture(),
      stops: (fixture) => fixture.aborts()
    },
    { aborted: ["error:VES_OPENCODE_ABORTED"], failed: ["error:VES_OPENCODE_EXECUTION_FAILED", "usage.updated"] }
  ),
  pi: sdkRow(
    PiDriver,
    {
      hanging: () => piAbortableFixture(),
      failing: () => piFixture([fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider failed" })]),
      stops: (fixture) => fixture.observed?.aborts ?? 0
    },
    {
      aborted: ["usage.updated", "error:VES_PI_ABORTED"],
      failed: ["content.delta", "usage.updated", "error:VES_PI_PROVIDER_ERROR"]
    }
  )
});

// invariant: `ready` resolves with the announced session once the provider is
// running, and with nothing when the run ended first, so a broken fixture
// fails the case instead of hanging it. The start signal is aborted when the
// case ends, whatever it proved, so no provider outlives it.
export function runningSession(t, { driver, request, running, stops, release }, observe = () => undefined) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const events = [];
  let announce;
  const announced = new Promise((resolve) => (announce = resolve));
  const run = driver.start(
    request,
    (event) => {
      events.push(event);
      if (event.type === "session.started") announce(event.sessionId);
      observe(event);
    },
    controller.signal
  );
  const ready = Promise.race([
    announced.then(async (sessionId) => (await running, sessionId)),
    run.then(() => undefined)
  ]);
  return { driver, controller, events, run, ready, stops, release };
}

// invariant: the terminal event is the last event of a session. A turn of the
// event loop after the close, nothing more has reached the sink, the sequence
// has no gap, and the close reports the outcome the terminal event carried.
export async function assertEndedOnce({ driver, events, run }, outcome) {
  const closed = await driver.close(await run);
  const emitted = events.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, emitted, "an event followed the terminal event");
  assert.deepEqual(
    events.map((event) => event.sequence),
    events.map((_, index) => index)
  );
  const terminal = events.filter((event) => event.type === "session.closed");
  assert.equal(terminal.length, 1);
  assert.equal(events.at(-1), terminal[0], "the terminal event is not the last event");
  assert.equal(terminal[0].outcome, outcome);
  assert.deepEqual(closed, { sessionId: closed.sessionId, closed: true, outcome, finalSequence: emitted });
}

const STOPS = [
  {
    name: "a cancel",
    reason: CANCEL_REASON,
    stop: ({ driver }, sessionId) => driver.cancel({ sessionId }, CANCEL_REASON)
  },
  {
    // why: the session runner aborts the start signal and then cancels the
    // announced session, in one turn.
    name: "the session runner's stop, the start signal and then a cancel,",
    reason: RUNNER_REASON,
    stop: ({ driver, controller }, sessionId) => {
      controller.abort();
      return driver.cancel({ sessionId }, RUNNER_REASON);
    }
  }
];

// why: the qualification contract. Each driver's suite runs these cases
// against the production driver and its labeled fake, and the sequences are
// pinned whole, so a change to what a stopped session emits is a decision.
export function cancelOrderSuite(test, label, row) {
  const options = { timeout: 30_000 };

  for (const { name, reason, stop } of STOPS) {
    test(`${label}: ${name} of a running session is reported by the run, then ends it once`, options, async (t) => {
      const session = runningSession(t, row.hanging());
      const sessionId = await session.ready;
      assert.equal(typeof sessionId, "string", "the run ended before it announced a session");
      assert.equal(session.stops(), 0, "nothing may stop the provider before the stop");
      await stop(session, sessionId);
      assert.deepEqual(brief(session.events), [...STARTED, ...row.aborted, `session.closed:cancelled:${reason}`]);
      assert.equal(session.stops(), 1, "the provider is stopped once");
      await assertEndedOnce(session, "cancelled");
    });
  }

  test(
    `${label}: an aborted start signal alone ends the run as aborted, and the close ends the session`,
    options,
    async (t) => {
      const session = runningSession(t, row.hanging());
      assert.equal(typeof (await session.ready), "string", "the run ended before it announced a session");
      session.controller.abort();
      await session.run;
      assert.deepEqual(brief(session.events), [...STARTED, ...row.aborted]);
      await assertEndedOnce(session, "cancelled");
      assert.equal(brief(session.events).at(-1), "session.closed:cancelled");
    }
  );

  test(`${label}: a session that failed before it was cancelled stays failed`, options, async (t) => {
    const session = runningSession(t, row.failing());
    const reference = await session.run;
    assert.deepEqual(brief(session.events), [...STARTED, ...row.failed]);
    await session.driver.cancel(reference, CANCEL_REASON);
    assert.equal(brief(session.events).at(-1), `session.closed:failed:${CANCEL_REASON}`);
    await assertEndedOnce(session, "failed");
  });

  if (row.lingering !== null)
    test(
      `${label}: a cancel waits for a run that reports late, and its terminal event still comes last`,
      options,
      async (t) => {
        const session = runningSession(t, row.lingering());
        const sessionId = await session.ready;
        assert.equal(typeof sessionId, "string", "the run ended before it announced a session");
        const cancelling = session.driver.cancel({ sessionId }, CANCEL_REASON);
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(brief(session.events), STARTED, "the terminal event did not wait for the run to report");
        session.release();
        await cancelling;
        assert.deepEqual(brief(session.events), [
          ...STARTED,
          ...row.aborted,
          `session.closed:cancelled:${CANCEL_REASON}`
        ]);
        await assertEndedOnce(session, "cancelled");
      }
    );

  if (row.garbled === null) return;
  for (const { name, reason, stop } of STOPS) {
    test(
      `${label}: a stream that failed before ${name} keeps its own report, and the session ends failed`,
      options,
      async (t) => {
        let stopping;
        // invariant: the provider says one more thing after its stream broke.
        // The stop is asked for when that arrives: after the failure, and before
        // the run has reported it.
        const session = runningSession(t, row.garbled(), (event) => {
          if (event.type === "content.delta") stopping ??= stop(session, session.events[0].sessionId);
        });
        await session.run;
        assert.notEqual(stopping, undefined, "the provider never spoke after its stream broke");
        await stopping;
        assert.deepEqual(brief(session.events), [
          ...STARTED,
          "content.delta",
          row.broken,
          `session.closed:failed:${reason}`
        ]);
        await assertEndedOnce(session, "failed");
      }
    );
  }
}
