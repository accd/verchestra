import assert from "node:assert/strict";
import { test } from "node:test";

import { runDriverSession } from "../../packages/agent-runtime/src/execution/driver-session-runner.ts";

// why: the session runner's contract is asserted here, at its own interface,
// against a scripted stand-in for the Driver protocol. That every consumer
// reaches a driver only through it is proven where each consumer is tested;
// tests/integration/driver-session-runner-drivers.test.mjs runs the same
// contract against the Claude Code, Codex and Pi drivers.

const SESSION = "fixture-session:private";
const REQUEST = Object.freeze({ fixture: true });
const STARTED = Object.freeze({ type: "session.started", sessionId: SESSION });

// DETERMINISTIC FAKE driver: the script plays the provider's part. It receives
// `emit`, the signal the runner handed to `start`, and the fake itself, and the
// run ends when it returns. `closed` is what `close` answers.
class ScriptedDriver {
  constructor(script, closed = { outcome: "completed" }) {
    this.script = script;
    this.closed = closed;
    this.calls = [];
    this.cancelled = [];
    this.closes = [];
    this.requests = [];
  }

  async start(request, sink, signal) {
    this.calls.push("start");
    this.requests.push(request);
    this.signal = signal;
    let sequence = 0;
    const emit = (event) => sink(Object.freeze({ ...event, sequence: sequence++ }));
    await this.script({ emit, signal, driver: this });
    return { sessionId: SESSION };
  }

  async cancel(session, reason) {
    this.calls.push("cancel");
    this.cancelled.push({ session, reason });
    await this.onCancel?.();
  }

  async close(session) {
    this.calls.push("close");
    this.closes.push(session);
    return typeof this.closed === "function" ? this.closed() : this.closed;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => (resolve = settle));
  return { promise, resolve };
}

function observed(driver, extra = {}) {
  const events = [];
  return {
    events,
    run: runDriverSession({ driver, startRequest: REQUEST, observe: (event) => events.push(event), ...extra })
  };
}

test("a session that ends by itself is started, observed in order, closed once, and completed", async () => {
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    emit({ type: "content.delta", text: "a" });
    emit({ type: "usage.updated", inputTokens: 3, outputTokens: 1 });
  });
  const { events, run } = observed(driver);
  const finished = await run;
  assert.deepEqual(finished, { outcome: "completed", errorCodes: [] });
  assert.ok(Object.isFrozen(finished) && Object.isFrozen(finished.errorCodes));
  assert.deepEqual(driver.calls, ["start", "close"]);
  assert.deepEqual(driver.requests, [REQUEST]);
  assert.deepEqual(driver.closes, [{ sessionId: SESSION }]);
  assert.deepEqual(
    events.map((event) => [event.type, event.sequence]),
    [
      ["session.started", 0],
      ["content.delta", 1],
      ["usage.updated", 2]
    ]
  );
});

test("a session with no signal and no observer still runs, and its driver gets a signal that is not aborted", async () => {
  const driver = new ScriptedDriver(async ({ emit }) => emit(STARTED));
  assert.deepEqual(await runDriverSession({ driver, startRequest: REQUEST }), { outcome: "completed", errorCodes: [] });
  assert.ok(driver.signal instanceof AbortSignal);
  assert.equal(driver.signal.aborted, false);
});

test("an already aborted caller never starts the driver and is reported cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  const driver = new ScriptedDriver(async () => assert.fail("the driver never starts"));
  const { events, run } = observed(driver, { signal: controller.signal });
  const finished = await run;
  assert.deepEqual(finished, { outcome: "cancelled", errorCodes: [] });
  assert.ok(Object.isFrozen(finished));
  assert.deepEqual(driver.calls, []);
  assert.deepEqual(events, []);
});

test("an abort during the run cancels the announced session once, with the runner's reason, and ends cancelled", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(
    async ({ emit, signal }) => {
      emit(STARTED);
      assert.equal(signal.aborted, false);
      controller.abort();
      controller.abort();
      assert.equal(signal.aborted, true, "the driver's own signal is aborted with the caller's");
    },
    { outcome: "cancelled" }
  );
  const finished = await observed(driver, { signal: controller.signal }).run;
  assert.equal(finished.outcome, "cancelled");
  assert.deepEqual(driver.cancelled, [{ session: { sessionId: SESSION }, reason: "stopped by Verchestra" }]);
  assert.deepEqual(driver.calls, ["start", "cancel", "close"]);
});

test("the cancel finishes before the session is closed", async () => {
  const controller = new AbortController();
  const gate = deferred();
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    controller.abort();
  });
  driver.onCancel = async () => {
    await gate.promise;
    driver.calls.push("cancel:finished");
  };
  const { run } = observed(driver, { signal: controller.signal });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(driver.calls, ["start", "cancel"], "close waits for the cancel in flight");
  gate.resolve();
  assert.equal((await run).outcome, "cancelled");
  assert.deepEqual(driver.calls, ["start", "cancel", "cancel:finished", "close"]);
});

// invariant: the end ADP-3 recorded, which the four drivers no longer produce:
// `session.closed` with `cancelled`, then an error event, and a close that
// answers `failed`. A driver that keeps no session ledger may still end so. At
// the runner's interface that end is `cancelled`, and the late event is observed.
test("a cancel-initiated end is cancelled even when an error follows the terminal event and close reports failed", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(
    async ({ emit }) => {
      emit(STARTED);
      controller.abort();
      emit({ type: "session.closed", outcome: "cancelled", reason: "stopped by Verchestra" });
      emit({ type: "error", code: "VES_CLAUDE_STREAM_INCOMPLETE", message: "process failed", retryable: false });
    },
    { outcome: "failed" }
  );
  const { events, run } = observed(driver, { signal: controller.signal });
  assert.deepEqual(await run, { outcome: "cancelled", errorCodes: ["VES_CLAUDE_STREAM_INCOMPLETE"] });
  assert.deepEqual(
    events.map((event) => event.type),
    ["session.started", "session.closed", "error"]
  );
});

test("a session someone else cancelled is cancelled, although the runner never stopped it", async () => {
  const driver = new ScriptedDriver(
    async ({ emit }) => {
      emit(STARTED);
      emit({ type: "session.closed", outcome: "cancelled", reason: "user-request" });
      emit({ type: "error", code: "VES_CLAUDE_STREAM_INCOMPLETE", message: "process failed", retryable: false });
    },
    { outcome: "failed" }
  );
  const finished = await observed(driver).run;
  assert.equal(finished.outcome, "cancelled");
  assert.deepEqual(driver.cancelled, []);
});

test("a close that reports cancelled is cancelled", async () => {
  const driver = new ScriptedDriver(async ({ emit }) => emit(STARTED), { outcome: "cancelled" });
  assert.equal((await observed(driver).run).outcome, "cancelled");
});

test("a failure that preceded the stop does not turn the stop into a failure", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(
    async ({ emit }) => {
      emit(STARTED);
      emit({ type: "error", code: "VES_CODEX_EXECUTION_FAILED", message: "failed", retryable: true });
      controller.abort();
    },
    { outcome: "failed" }
  );
  assert.deepEqual(await observed(driver, { signal: controller.signal }).run, {
    outcome: "cancelled",
    errorCodes: ["VES_CODEX_EXECUTION_FAILED"]
  });
});

test("a stop that arrives before the session is announced cancels it as soon as it is known", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(async ({ emit, driver: fake }) => {
    controller.abort();
    assert.deepEqual(fake.cancelled, [], "nothing can be cancelled before the session is announced");
    emit(STARTED);
    assert.equal(fake.cancelled.length, 1);
    emit({ type: "content.delta", text: "late" });
  });
  const finished = await observed(driver, { signal: controller.signal }).run;
  assert.equal(finished.outcome, "cancelled");
  assert.deepEqual(driver.cancelled, [{ session: { sessionId: SESSION }, reason: "stopped by Verchestra" }]);
});

test("the first announced session is the one that is cancelled, whatever is announced later", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    emit({ type: "session.started", sessionId: "fixture-session:other" });
    controller.abort();
  });
  assert.equal((await observed(driver, { signal: controller.signal }).run).outcome, "cancelled");
  assert.deepEqual(
    driver.cancelled.map((entry) => entry.session.sessionId),
    [SESSION]
  );
});

test("a stopped session that never announced itself is cancelled without a cancel call", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(async () => controller.abort());
  const finished = await observed(driver, { signal: controller.signal }).run;
  assert.equal(finished.outcome, "cancelled");
  assert.deepEqual(driver.calls, ["start", "close"]);
});

test("a cancel that fails changes nothing: the session is closed and the end is cancelled", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    controller.abort();
  });
  driver.onCancel = async () => {
    throw new Error("the provider could not be stopped");
  };
  assert.equal((await observed(driver, { signal: controller.signal }).run).outcome, "cancelled");
  assert.deepEqual(driver.calls, ["start", "cancel", "close"]);
});

test("an abort after the session ended reaches nothing", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(async ({ emit }) => emit(STARTED));
  assert.equal((await observed(driver, { signal: controller.signal }).run).outcome, "completed");
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(driver.calls, ["start", "close"]);
});

test("an error event fails the session with its stable code, and an unsafe code is replaced", async () => {
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    emit({ type: "error", code: "VES_CLAUDE_EXECUTION_FAILED", message: "provider /private/path failed" });
    emit({ type: "error", code: "/private/path", message: "x" });
    emit({ type: "error", message: "no code" });
  });
  assert.deepEqual(await observed(driver).run, {
    outcome: "failed",
    errorCodes: ["VES_CLAUDE_EXECUTION_FAILED", "VES_DRIVER_ERROR", "VES_DRIVER_ERROR"]
  });
});

for (const [label, closed] of [
  ["reports failed", { outcome: "failed" }],
  ["reports no outcome", { closed: true }],
  ["reports an unknown outcome", { outcome: "done" }],
  ["answers that the session was already closed", { closed: true, alreadyClosed: true }]
]) {
  test(`a session whose close ${label} is failed, never completed`, async () => {
    const driver = new ScriptedDriver(async ({ emit }) => emit(STARTED), closed);
    assert.deepEqual(await observed(driver).run, { outcome: "failed", errorCodes: [] });
  });
}

test("an observer that throws ends the session: it is cancelled, closed, and the error is rethrown", async () => {
  const defect = new TypeError("the observer is broken");
  const seen = [];
  const driver = new ScriptedDriver(async ({ emit, signal }) => {
    emit(STARTED);
    emit({ type: "usage.updated", inputTokens: 1, outputTokens: 1 });
    assert.equal(signal.aborted, true, "the driver is told to stop");
    emit({ type: "content.delta", text: "after the failure" });
  });
  await assert.rejects(
    runDriverSession({
      driver,
      startRequest: REQUEST,
      observe: (event) => {
        seen.push(event.type);
        if (event.type === "usage.updated") throw defect;
      }
    }),
    (error) => error === defect
  );
  assert.deepEqual(seen, ["session.started", "usage.updated"], "a failed observer is not called again");
  assert.deepEqual(driver.calls, ["start", "cancel", "close"]);
});

test("an observer that throws on the first event still has its session cancelled and closed", async () => {
  const defect = new Error("refused");
  const driver = new ScriptedDriver(async ({ emit }) => emit(STARTED));
  await assert.rejects(
    runDriverSession({
      driver,
      startRequest: REQUEST,
      observe: () => {
        throw defect;
      }
    }),
    (error) => error === defect
  );
  assert.deepEqual(driver.calls, ["start", "cancel", "close"]);
});

test("a start that fails before any session is announced is rethrown and nothing is closed", async () => {
  const refusal = Object.assign(new Error("unsupported"), { code: "VES_CODEX_VERSION_UNSUPPORTED" });
  const driver = new ScriptedDriver(async () => {
    throw refusal;
  });
  await assert.rejects(observed(driver).run, (error) => error === refusal);
  assert.deepEqual(driver.calls, ["start"]);
});

test("a start that fails after it announced a session has that session closed, and its failure is rethrown", async () => {
  const refusal = Object.assign(new Error("the launch directory could not be removed"), { code: "EBUSY" });
  const driver = new ScriptedDriver(
    async ({ emit }) => {
      emit(STARTED);
      throw refusal;
    },
    () => {
      throw new Error("close failed as well");
    }
  );
  await assert.rejects(observed(driver).run, (error) => error === refusal);
  assert.deepEqual(driver.calls, ["start", "close"]);
  assert.deepEqual(driver.closes, [{ sessionId: SESSION }]);
});

test("a start that fails after the stop is the cancel the caller asked for", async () => {
  const controller = new AbortController();
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    emit({ type: "error", code: "VES_OPENCODE_ABORTED", message: "aborted" });
    controller.abort();
    throw Object.assign(new Error("start was cancelled"), { code: "VES_DRIVER_CANCELLED" });
  });
  assert.deepEqual(await observed(driver, { signal: controller.signal }).run, {
    outcome: "cancelled",
    errorCodes: ["VES_OPENCODE_ABORTED"]
  });
  assert.deepEqual(driver.calls, ["start", "cancel", "close"]);
});

test("the observer's own failure outranks a start that failed because of it", async () => {
  const defect = new Error("observer");
  const driver = new ScriptedDriver(async ({ emit }) => {
    emit(STARTED);
    throw new Error("the stream handler gave up");
  });
  await assert.rejects(
    runDriverSession({
      driver,
      startRequest: REQUEST,
      observe: () => {
        throw defect;
      }
    }),
    (error) => error === defect
  );
});
