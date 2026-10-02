import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { ClaudeCodeDriver } from "../../packages/drivers/src/claude-code-driver.ts";
import { CodexDriver } from "../../packages/drivers/src/codex-driver.ts";
import { OpenCodeDriver } from "../../packages/drivers/src/opencode-driver.ts";
import { PiDriver } from "../../packages/drivers/src/pi-driver.ts";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";
import { openCodeFixture } from "../helpers/opencode-driver-fixture.mjs";
import { piAbortableFixture, piFixture } from "../helpers/pi-driver-fixture.mjs";

// T75 Driver matrix: every declared Driver x the lifecycle contract it must
// satisfy.
//
// Before this file the four drivers were covered one file at a time, and
// nothing enumerated them together: conformance to `interface Driver`
// (packages/drivers/src/index.ts:366) was asserted only by the five
// `implements Driver` clauses, which is a compile-time claim, and each suite
// chose its own shape. A driver could therefore be added, or an existing one
// could lose a lifecycle method's runtime behaviour, without any single test
// noticing the matrix had a hole. tests/contract/conformance-kit-parity.test.mjs
// does exactly this job for the database engines; this is its Driver
// counterpart.
//
// Every case here is hermetic. The three CLI drivers run against the
// repository's own fake executables and Pi against an injected version
// resolver, so no vendor CLI is required and nothing in this file can pass
// merely because a provider happened to be installed on the runner. The live
// provider axis stays where it already is, in the `spikes/*` suites under
// test:qualification; it is recorded in the report as a separate axis, not
// duplicated here.

// The lifecycle contract, read from its canonical declaration so a method
// added to `interface Driver` cannot be left unexercised by this matrix.
const DRIVERS_INDEX = readFileSync(new URL("../../packages/drivers/src/index.ts", import.meta.url), "utf8");
const LIFECYCLE_METHODS = (() => {
  const opening = DRIVERS_INDEX.indexOf("export interface Driver {");
  assert.notEqual(opening, -1, "the Driver interface must be readable from packages/drivers/src/index.ts");
  const body = DRIVERS_INDEX.slice(opening, DRIVERS_INDEX.indexOf("\n}", opening));
  return [...body.matchAll(/^ {2}([a-z][A-Za-z]*)\(/gmu)].map((match) => match[1]);
})();

// The canonical closed driver set. `backend-serializers.ts` is the only closed
// four-way enumeration of Verchestra's drivers in the product; the matrix binds
// to it so a fifth driver added there fails this file rather than silently
// entering the product with no lifecycle evidence.
const SERIALIZERS = readFileSync(
  new URL("../../packages/agent-runtime/src/context/backend-serializers.ts", import.meta.url),
  "utf8"
);
const CANONICAL_DRIVER_IDS = (() => {
  const body = /const TARGETS = \[([^\]]+)\]/u.exec(SERIALIZERS)?.[1];
  assert.ok(body, "the driver target set must be readable from backend-serializers.ts");
  return [...body.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]);
})();

const ABSENT_PI_MANIFEST = join(tmpdir(), "verchestra-absent-pi-matrix", "package.json");

// One row per declared driver. `configured` builds the driver with its provider
// present, `notConfigured` with the provider absent, and `versionDrift` with a
// provider that answers with a version the driver does not qualify. The three
// shapes are the whole probe contract, and every driver must answer all three.
const MATRIX = [
  {
    driverId: "claude-code",
    notAvailableCode: "VES_CLAUDE_NOT_AVAILABLE",
    versionUnsupportedCode: "VES_CLAUDE_VERSION_UNSUPPORTED",
    configured: () => new ClaudeCodeDriver(claudeFixture().dependencies()),
    notConfigured: () => new ClaudeCodeDriver(claudeFixture().dependencies({ command: ["missing-verchestra-claude"] })),
    versionDrift: () =>
      new ClaudeCodeDriver(claudeFixture().dependencies({ probeEnvironment: { FAKE_CLAUDE_VERSION: "1.0.0" } }))
  },
  {
    driverId: "codex",
    notAvailableCode: "VES_CODEX_NOT_AVAILABLE",
    versionUnsupportedCode: "VES_CODEX_VERSION_UNSUPPORTED",
    configured: () => new CodexDriver(codexFixture().dependencies()),
    notConfigured: () => new CodexDriver(codexFixture().dependencies({ command: ["missing-verchestra-codex"] })),
    versionDrift: () =>
      new CodexDriver(codexFixture().dependencies({ probeEnvironment: { FAKE_CODEX_VERSION: "0.1.0" } }))
  },
  {
    driverId: "opencode",
    notAvailableCode: "VES_OPENCODE_NOT_AVAILABLE",
    versionUnsupportedCode: "VES_OPENCODE_VERSION_UNSUPPORTED",
    configured: () => new OpenCodeDriver(openCodeFixture().dependencies()),
    notConfigured: () =>
      new OpenCodeDriver(openCodeFixture().dependencies({ command: ["missing-verchestra-opencode"] })),
    versionDrift: () =>
      new OpenCodeDriver(openCodeFixture().dependencies({ probeEnvironment: { FAKE_OPENCODE_VERSION: "0.1.0" } }))
  },
  {
    driverId: "pi",
    notAvailableCode: "VES_PI_NOT_AVAILABLE",
    versionUnsupportedCode: "VES_PI_VERSION_UNSUPPORTED",
    // Pi is an embedded SDK rather than a CLI, so "configured" is the installed
    // package manifest and the two failure shapes are supplied through the
    // injectable version resolver. The contract it must answer is identical.
    configured: () => new PiDriver(piFixture().dependencies()),
    notConfigured: () => new PiDriver(piFixture().dependencies(), { versionResolver: () => ABSENT_PI_MANIFEST }),
    versionDrift: null
  }
];

test("the matrix covers exactly the canonical driver set", () => {
  // The binding that makes this a matrix rather than four tests that happen to
  // sit together.
  assert.deepEqual(MATRIX.map((row) => row.driverId).sort(), [...CANONICAL_DRIVER_IDS].sort());
  assert.equal(MATRIX.length, 4);
});

test("the Driver lifecycle contract is exactly probe, start, send, cancel, close", () => {
  // Pins the contract this matrix claims to cover. A method added to
  // `interface Driver` fails here, which is the signal to extend the matrix
  // rather than to let a lifecycle stage go unexercised.
  assert.deepEqual([...LIFECYCLE_METHODS].sort(), ["cancel", "close", "probe", "send", "start"]);
});

for (const row of MATRIX) {
  test(`${row.driverId} implements every lifecycle method at runtime`, () => {
    // `implements Driver` is erased at build time. This is the runtime check
    // that the shipped object actually carries the contract.
    const driver = row.configured();
    for (const method of LIFECYCLE_METHODS)
      assert.equal(typeof driver[method], "function", `${row.driverId} is missing ${method}()`);
  });

  test(`${row.driverId} probe reports its own identity and a boolean availability`, async () => {
    const probe = await row.configured().probe();
    assert.equal(probe.driverId, row.driverId, "a probe must identify the driver that answered it");
    assert.equal(typeof probe.available, "boolean");
    assert.equal(probe.available, true, `${row.driverId} did not resolve its configured provider`);
    assert.ok(
      Array.isArray(probe.capabilities) && probe.capabilities.length > 0,
      "an available driver declares capabilities"
    );
    assert.equal(probe.error, undefined, "an available driver reports no error");
  });

  test(`${row.driverId} reports not configured when its provider is absent, never a pass`, async () => {
    // The repository rule this matrix exists to enforce: "a missing provider is
    // `not configured`, never a pass". The probe must not throw either — a
    // throw is an outage the caller cannot classify, not a negative answer.
    const probe = await row.notConfigured().probe();
    assert.equal(probe.driverId, row.driverId);
    assert.equal(probe.available, false, `${row.driverId} reported an absent provider as available`);
    assert.equal(probe.error.code, row.notAvailableCode);
    assert.equal(probe.capabilities, undefined, "an unavailable driver must not advertise capabilities");
  });

  test(`${row.driverId} probe never throws, whatever the provider does`, async () => {
    // Every probe in the matrix answers with a value on every path, so a
    // composition can enumerate drivers without a try/catch per driver.
    for (const build of [row.configured, row.notConfigured, row.versionDrift].filter(Boolean)) {
      const probe = await build().probe();
      assert.equal(typeof probe, "object");
      assert.equal(Object.isFrozen(probe), true, "a probe result must be frozen before it leaves the driver");
    }
  });

  test(`${row.driverId} probe result carries no machine-local path`, async () => {
    // A probe is portable evidence: it is read on another machine. The absent
    // case is the risk, because the resolver failure carries the path it tried.
    const serialized = JSON.stringify(await row.notConfigured().probe());
    for (const fragment of [tmpdir(), process.cwd()])
      assert.equal(serialized.includes(fragment), false, `${row.driverId} leaked ${fragment}`);
  });
}

// The version axis. Pi is separated because its drift case needs a manifest on
// disk rather than an environment variable; it is covered by
// tests/contract/pi-driver.test.mjs and asserted here through the shared
// property below rather than skipped.
for (const row of MATRIX.filter((entry) => entry.versionDrift !== null)) {
  test(`${row.driverId} refuses a provider whose version it does not qualify`, async () => {
    const probe = await row.versionDrift().probe();
    assert.equal(probe.available, false, `${row.driverId} accepted an unqualified provider version`);
    assert.equal(probe.error.code, row.versionUnsupportedCode);
  });
}

test("every driver distinguishes an absent provider from an unqualified one", async () => {
  // Two different failures that must never collapse into one code: "install it"
  // and "you have the wrong version" are different operator actions, and a
  // driver that reported both the same way would hide a silent downgrade.
  const codes = new Set();
  for (const row of MATRIX) {
    const absent = await row.notConfigured().probe();
    codes.add(absent.error.code);
    assert.notEqual(
      row.notAvailableCode,
      row.versionUnsupportedCode,
      `${row.driverId} uses one code for both absence and version drift`
    );
  }
  assert.equal(codes.size, MATRIX.length, "every driver must report absence under its own distinct code");
});

// why: the session axis. Session bookkeeping has one contract, the session
// ledger's (packages/drivers/src/driver-session-ledger.ts), asserted at its
// interface by tests/contract/driver-session-ledger.test.mjs. What can still go
// wrong per driver is the wiring: a driver that numbers events differently,
// shares its sessions with another instance, spells another driver's name, or
// does not stop its provider before the terminal event. Each row therefore
// runs a real session against the same hermetic fixtures as the probe axis.
//
// invariant: `complete` builds drivers whose run ends by itself. `hanging`
// builds one whose run ends only when it is stopped, with `stops()` counting
// how often the provider was told to stop. Every driver has a provider that
// a cancel stops, so every row has both.
function completing(Driver, fixture) {
  return { request: fixture.request(), build: () => new Driver(fixture.dependencies()) };
}

// why: Claude Code and Codex are child processes stopped through the injected
// process-tree terminator, which their fixtures count.
function childProcessRow(driverId, noun, Driver, fixtureOf, hangMode) {
  return {
    driverId,
    noun,
    complete: () => completing(Driver, fixtureOf()),
    hanging: () => {
      const fixture = fixtureOf({ environment: hangMode });
      return { ...completing(Driver, fixture), running: Promise.resolve(), stops: () => fixture.calls.terminate };
    }
  };
}

const SESSION_MATRIX = [
  childProcessRow("claude-code", "Claude Code", ClaudeCodeDriver, claudeFixture, { FAKE_CLAUDE_MODE: "hang" }),
  childProcessRow("codex", "Codex", CodexDriver, codexFixture, { FAKE_CODEX_MODE: "hang" }),
  {
    driverId: "opencode",
    noun: "OpenCode",
    complete: () => completing(OpenCodeDriver, openCodeFixture()),
    // why: OpenCode is an SDK session on an isolated server; a stop aborts
    // that session, which the fixture's client records.
    hanging: openCodeHanging
  },
  {
    driverId: "pi",
    noun: "Pi Driver",
    complete: () => completing(PiDriver, piFixture()),
    hanging: () => {
      const fixture = piAbortableFixture();
      return { ...completing(PiDriver, fixture), running: fixture.running, stops: () => fixture.observed.aborts };
    }
  }
];

async function completedSession(row) {
  const events = [];
  const { request, build } = row.complete();
  const driver = build();
  const session = await driver.start(request, (event) => events.push(event), new AbortController().signal);
  return { driver, another: build(), session, events };
}

function terminalEvents(events) {
  return events.filter((event) => event.type === "session.closed");
}

test("the session axis covers exactly the drivers of the probe axis", () => {
  assert.deepEqual(
    SESSION_MATRIX.map((row) => row.driverId),
    MATRIX.map((row) => row.driverId)
  );
});

for (const row of SESSION_MATRIX) {
  test(`${row.driverId} numbers a session from zero without a gap and reports where it ended`, async () => {
    const { driver, session, events } = await completedSession(row);
    const closed = await driver.close(session);
    assert.deepEqual(
      events.map((event) => event.sequence),
      events.map((_, index) => index)
    );
    assert.equal(events.every(Object.isFrozen), true);
    assert.equal(events[0].type, "session.started");
    assert.equal(events[0].sessionId, session.sessionId);
    assert.deepEqual(events.at(-1), { type: "session.closed", outcome: "completed", sequence: events.length - 1 });
    assert.deepEqual(closed, {
      sessionId: session.sessionId,
      closed: true,
      outcome: "completed",
      finalSequence: events.length
    });
    assert.equal(Object.isFrozen(closed), true);
  });

  test(`${row.driverId} close is idempotent and emits one terminal event`, async () => {
    const { driver, session, events } = await completedSession(row);
    await driver.close(session);
    const repeated = await driver.close(session);
    assert.equal(terminalEvents(events).length, 1);
    assert.deepEqual(repeated, { sessionId: session.sessionId, closed: true, alreadyClosed: true });
  });

  test(`${row.driverId} session reference is local to one driver instance`, async () => {
    const { driver, another, session, events } = await completedSession(row);
    const unknown = { code: "VES_DRIVER_SESSION_UNKNOWN", message: `${row.noun} session is unknown` };
    await assert.rejects(another.close(session), unknown);
    await assert.rejects(another.cancel(session, "user-request"), unknown);
    assert.equal(terminalEvents(events).length, 0, "another instance must not end the owner's session");
    assert.equal((await driver.close(session)).outcome, "completed");
  });

  test(`${row.driverId} cancellation after execution is idempotent and closes once with its reason`, async () => {
    const { driver, session, events } = await completedSession(row);
    await driver.cancel(session, "user-request");
    await driver.cancel(session, "second-request");
    assert.equal(terminalEvents(events).length, 1);
    assert.deepEqual(events.at(-1), {
      type: "session.closed",
      outcome: "cancelled",
      reason: "user-request",
      sequence: events.length - 1
    });
    const closed = await driver.close(session);
    assert.equal(closed.outcome, "cancelled");
    assert.equal(closed.finalSequence, events.length);
    assert.equal(terminalEvents(events).length, 1);
  });

  test(`${row.driverId} accepts a cancel after close and emits nothing for it`, async () => {
    const { driver, session, events } = await completedSession(row);
    await driver.close(session);
    const emitted = events.length;
    await driver.cancel(session, "late");
    assert.equal(events.length, emitted);
  });
}

for (const row of SESSION_MATRIX) {
  test(
    `${row.driverId} cancel stops the running provider before it emits the terminal event`,
    { timeout: 30_000 },
    async (t) => {
      const { request, build, running, stops } = row.hanging();
      const events = [];
      const stopsAtTerminal = [];
      let announce;
      const announced = new Promise((resolve) => (announce = resolve));
      const driver = build();
      // hazard: a driver that does not stop its provider would leave the run,
      // and a child process, alive after this case fails; the start signal ends
      // both whatever the outcome.
      const safetyNet = new AbortController();
      t.after(() => safetyNet.abort());
      const run = driver.start(
        request,
        (event) => {
          events.push(event);
          if (event.type === "session.started") announce(event.sessionId);
          if (event.type === "session.closed") stopsAtTerminal.push(stops());
        },
        safetyNet.signal
      );
      const sessionId = await Promise.race([announced, run.then(() => undefined)]);
      assert.equal(typeof sessionId, "string", "the run ended before it announced a session");
      await running;
      assert.equal(stops(), 0, "nothing may stop the provider before the cancel");
      await driver.cancel({ sessionId }, "user-request");
      assert.deepEqual(stopsAtTerminal, [1], "the provider is stopped once, before the terminal event");
      const session = await run;
      assert.equal(session.sessionId, sessionId);
      const [terminal] = terminalEvents(events);
      assert.equal(terminal.outcome, "cancelled");
      assert.equal(terminal.reason, "user-request");
      await driver.close(session);
      assert.equal(terminalEvents(events).length, 1);
    }
  );
}

// why: the floor axis. Every fixture above states its floor, so the floor a
// driver applies when a composition states none was pinned nowhere. Changing
// one of these is a requalification, not a refactor. Pi qualifies one exact
// version instead, which tests/contract/pi-driver.test.mjs pins.
function floorRow(driverId, floor, below, Driver, fixtureOf, versionVariable) {
  const reporting = (version) =>
    new Driver(
      fixtureOf().dependencies({ minimumVersion: undefined, probeEnvironment: { [versionVariable]: version } })
    );
  return { driverId, floor, below, reporting };
}

const DEFAULT_FLOORS = [
  floorRow("claude-code", "2.1.168", "2.1.167", ClaudeCodeDriver, claudeFixture, "FAKE_CLAUDE_VERSION"),
  floorRow("codex", "0.115.0", "0.114.99", CodexDriver, codexFixture, "FAKE_CODEX_VERSION"),
  floorRow("opencode", "1.17.18", "1.17.17", OpenCodeDriver, openCodeFixture, "FAKE_OPENCODE_VERSION")
];

test("the floor axis covers every driver that qualifies a floor", () => {
  assert.deepEqual(
    DEFAULT_FLOORS.map((row) => row.driverId),
    MATRIX.filter((row) => row.versionDrift !== null).map((row) => row.driverId)
  );
});

for (const row of DEFAULT_FLOORS) {
  test(`${row.driverId} qualifies ${row.floor} by default and nothing below it`, async () => {
    const atFloor = await row.reporting(row.floor).probe();
    assert.equal(atFloor.available, true, `${row.driverId} refused its own default floor`);
    assert.equal(atFloor.version, row.floor);
    const below = await row.reporting(row.below).probe();
    assert.equal(below.available, false, `${row.driverId} accepted a version below its default floor`);
    assert.equal(below.version, row.below);
    assert.equal(below.error.code, MATRIX.find((entry) => entry.driverId === row.driverId).versionUnsupportedCode);
  });
}

// why: declared after the rows that name it, so that the lines of the axes
// above, which the validation evidence cites, stay where they are.
function openCodeHanging() {
  const fixture = openCodeFixture({}, "hang");
  return { ...completing(OpenCodeDriver, fixture), running: fixture.running, stops: fixture.aborts };
}
