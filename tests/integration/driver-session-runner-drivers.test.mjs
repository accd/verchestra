import assert from "node:assert/strict";
import { test } from "node:test";

import { runDriverSession } from "../../packages/agent-runtime/src/execution/driver-session-runner.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import { PiDriver } from "../../packages/drivers/src/pi-driver.ts";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";
import { piAbortableFixture, piFixture } from "../helpers/pi-driver-fixture.mjs";

// why: tests/contract/driver-session-runner.test.mjs asserts the runner's
// contract against a scripted stand-in. This suite runs the same contract
// against the four drivers, so the structural port the runner declares is
// proven to be the one the drivers implement, and the end of a cancelled run
// is classified from what a real driver emits.
//
// Every case is hermetic: Claude Code and Codex run against labeled fake
// executables, OpenCode against a fake SDK client, Pi against its faux provider.

function childProcessRow(driverId, Driver, fixtureOf, hangMode) {
  return {
    driverId,
    complete: () => {
      const fixture = fixtureOf();
      return { fixture, driver: new Driver(fixture.dependencies()) };
    },
    hanging: () => {
      const fixture = fixtureOf({ environment: hangMode });
      return {
        driver: new Driver(fixture.dependencies()),
        request: fixture.request(),
        running: Promise.resolve(),
        stops: () => fixture.calls.terminate
      };
    },
    untouched: (fixture) => assert.deepEqual(fixture.calls, { resolve: 0, spawn: 0, terminate: 0 })
  };
}

const ROWS = [
  childProcessRow("claude-code", ClaudeCodeDriver, claudeFixture, { FAKE_CLAUDE_MODE: "hang" }),
  childProcessRow("codex", CodexDriver, codexFixture, { FAKE_CODEX_MODE: "hang" }),
  {
    driverId: "pi",
    complete: () => {
      const fixture = piFixture();
      return { fixture, driver: new PiDriver(fixture.dependencies()) };
    },
    hanging: () => {
      const fixture = piAbortableFixture();
      return {
        driver: new PiDriver(fixture.dependencies()),
        request: fixture.request(),
        running: fixture.running,
        stops: () => fixture.observed.aborts
      };
    },
    untouched: (fixture) => assert.equal(fixture.calls.resolve, 0)
  }
].concat(openCodeRow());

function terminalEvents(events) {
  return events.filter((event) => event.type === "session.closed");
}

// invariant: resolves with the announced session once the provider is running,
// and with nothing when the run ended first, so a broken fixture fails the case
// instead of hanging it.
function runningSession(row, extra = {}) {
  const { driver, request, running, stops } = row.hanging();
  const events = [];
  let announce;
  const announced = new Promise((resolve) => (announce = resolve));
  const run = runDriverSession({
    driver,
    startRequest: request,
    observe: (event) => {
      events.push(event);
      if (event.type === "session.started") announce(event.sessionId);
    },
    ...extra
  });
  const ready = Promise.race([
    announced.then(async (sessionId) => (await running, sessionId)),
    run.then(() => undefined)
  ]);
  return { driver, events, run, ready, stops };
}

for (const row of ROWS) {
  test(`${row.driverId}: a session that ends by itself is completed and closed with one terminal event`, async () => {
    const { fixture, driver } = row.complete();
    const events = [];
    const finished = await runDriverSession({
      driver,
      startRequest: fixture.request(),
      observe: (event) => events.push(event)
    });
    assert.deepEqual(finished, { outcome: "completed", errorCodes: [] });
    assert.equal(events[0].type, "session.started");
    assert.deepEqual(terminalEvents(events), [
      { type: "session.closed", outcome: "completed", sequence: events.length - 1 }
    ]);
    // invariant: the runner closed the session, so the driver no longer knows it.
    assert.deepEqual(await driver.close({ sessionId: events[0].sessionId }), {
      sessionId: events[0].sessionId,
      closed: true,
      alreadyClosed: true
    });
  });

  test(`${row.driverId}: an already aborted caller starts nothing`, async () => {
    const { fixture, driver } = row.complete();
    const controller = new AbortController();
    controller.abort();
    const finished = await runDriverSession({
      driver,
      startRequest: fixture.request(),
      signal: controller.signal,
      observe: () => assert.fail("nothing is observed")
    });
    assert.deepEqual(finished, { outcome: "cancelled", errorCodes: [] });
    row.untouched(fixture);
  });

  test(
    `${row.driverId}: stopping a running session stops its provider and ends cancelled, with one terminal event`,
    { timeout: 30_000 },
    async (t) => {
      const controller = new AbortController();
      // hazard: a case that fails before it stops the session would leave the
      // run, and a child process, alive.
      t.after(() => controller.abort());
      const { events, run, ready, stops } = runningSession(row, { signal: controller.signal });
      assert.equal(typeof (await ready), "string", "the run ended before it announced a session");
      assert.equal(stops(), 0, "nothing may stop the provider before the stop");
      controller.abort();
      const finished = await run;
      assert.equal(finished.outcome, "cancelled");
      assert.ok(stops() >= 1, "the provider was stopped");
      assert.deepEqual(
        terminalEvents(events).map(({ outcome, reason }) => ({ outcome, reason })),
        [{ outcome: "cancelled", reason: "stopped by Verchestra" }]
      );
    }
  );

  // invariant: a session cancelled through `cancel()` alone, behind the
  // runner's back. Its run reports that it was aborted, and its terminal event
  // and its close say `cancelled`. The runner reads that end as `cancelled`.
  test(
    `${row.driverId}: a running session cancelled behind the runner's back is cancelled, not failed`,
    { timeout: 30_000 },
    async (t) => {
      const safetyNet = new AbortController();
      t.after(() => safetyNet.abort());
      const { driver, events, run, ready } = runningSession(row, { signal: safetyNet.signal });
      const sessionId = await ready;
      assert.equal(typeof sessionId, "string", "the run ended before it announced a session");
      await driver.cancel({ sessionId }, "user-request");
      const finished = await run;
      assert.equal(finished.outcome, "cancelled");
      assert.equal(safetyNet.signal.aborted, false, "the runner's own stop was never used");
      const [terminal, ...repeated] = terminalEvents(events);
      assert.deepEqual(repeated, []);
      assert.deepEqual(
        { outcome: terminal.outcome, reason: terminal.reason },
        { outcome: "cancelled", reason: "user-request" }
      );
    }
  );
}

// invariant: the driver-level order of a stopped run, pinned so that a change
// to it is a decision and not an accident. The run reports that it was
// aborted, the terminal event follows, and nothing follows that event. The
// runner's answer carries the code of that one report.
const ABORTED_CODES = {
  "claude-code": "VES_CLAUDE_ABORTED",
  codex: "VES_CODEX_ABORTED",
  opencode: "VES_OPENCODE_ABORTED",
  pi: "VES_PI_ABORTED"
};

for (const row of ROWS) {
  test(
    `${row.driverId}: the run a cancel interrupts reports that it was aborted before the terminal event, and nothing after it`,
    { timeout: 30_000 },
    async (t) => {
      const safetyNet = new AbortController();
      t.after(() => safetyNet.abort());
      const { driver, events, run, ready } = runningSession(row, { signal: safetyNet.signal });
      const sessionId = await ready;
      assert.equal(typeof sessionId, "string");
      await driver.cancel({ sessionId }, "user-request");
      const finished = await run;
      assert.deepEqual(
        events.slice(-2).map((event) => event.type),
        ["error", "session.closed"]
      );
      assert.deepEqual(finished, { outcome: "cancelled", errorCodes: [ABORTED_CODES[row.driverId]] });
    }
  );
}

// why: the OpenCode row and what it imports are declared after the cases, so
// that the lines of those cases, which the validation evidence cites, stay
// where they are.
import { OpenCodeDriver } from "../../packages/drivers/src/opencode-driver.ts";
import { openCodeFixture } from "../helpers/opencode-driver-fixture.mjs";

function openCodeRow() {
  return {
    driverId: "opencode",
    complete: () => {
      const fixture = openCodeFixture();
      return { fixture, driver: new OpenCodeDriver(fixture.dependencies()) };
    },
    hanging: () => {
      const fixture = openCodeFixture({}, "hang");
      return {
        driver: new OpenCodeDriver(fixture.dependencies()),
        request: fixture.request(),
        running: fixture.running,
        stops: fixture.aborts
      };
    },
    untouched: (fixture) => assert.deepEqual([fixture.counters.resolve, fixture.calls], [0, []])
  };
}
