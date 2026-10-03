import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { OWN_PROCESS_GROUP } from "../../packages/drivers/src/driver-process-tree.ts";
import { DriverSessionLedger } from "../../packages/drivers/src/driver-session-ledger.ts";
import { runProviderChild } from "../../packages/drivers/src/provider-child-run.ts";
import { processGroupOf, reap, WIN32_HOST } from "../helpers/process-tree-fixture.mjs";

// invariant: the provider child run at its own interface (ADR2-3): one
// provider child spawned in a process group of its own, held to its output
// limit, read one JSON object per line, stopped through one termination of
// its tree, and reported by one end-of-run rule. Each case runs the labeled
// DETERMINISTIC FAKE tests/helpers/fake-provider-child.mjs, whose steps state
// exactly what the provider writes, reads and how it ends; every process it
// starts is killed by id when its case ends. The Claude Code and Codex wiring
// is asserted by the child run axis of tests/contract/driver-lifecycle-matrix.test.mjs.

const FAKE = fileURLToPath(new URL("../helpers/fake-provider-child.mjs", import.meta.url));
const EXITS_BY_ITSELF = Object.freeze({
  errorCodePrefix: "VES_FAKE",
  noun: "Fake",
  streamName: "stream",
  afterResult: "exits-by-itself"
});
const ENDED_BY_THE_DRIVER = Object.freeze({
  ...EXITS_BY_ITSELF,
  streamName: "protocol",
  afterResult: "ended-by-the-driver"
});
const OPTIONS = { timeout: 30_000 };
const RESULT = { json: { result: true } };
const READY = { json: { say: "ready" } };
const HANG = { hang: true };

const ABORTED = { code: "VES_FAKE_ABORTED", message: "Fake was aborted", retryable: true };
const streamFailure = (code, streamName = "stream") => ({
  code,
  message: `Fake ${streamName} failed`,
  retryable: false
});
const processFailure = (code) => ({ code, message: "Fake process failed", retryable: false });

function kill(pid) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// why: one provider child run against the fake, in a session of its own. The
// protocol reads a line with `say` as content, `result` as the result, and
// `fail` as a stream failure with that code; its conversation writes one frame
// and closes the input. `protocol(channel, run)` overrides any of that.
function start(
  t,
  { steps = [], profile = EXITS_BY_ITSELF, launch = {}, terminateTree, signal, protocol, onEvent } = {}
) {
  const run = { events: [], received: [], spawned: [], asked: [], sessionId: "fake-session" };
  run.ledger = new DriverSessionLedger({ noun: "Fake", stop: ({ resources }) => resources.stop?.() });
  run.session = run.ledger.open(
    run.sessionId,
    (event) => {
      run.events.push(event);
      onEvent?.(event, run);
    },
    {}
  );
  run.cancel = (reason = "user-request") => run.ledger.cancel({ sessionId: run.sessionId }, reason);
  run.close = () => run.ledger.close({ sessionId: run.sessionId });
  run.controller = new AbortController();
  run.ended = runProviderChild({
    profile,
    launch: {
      command: process.execPath,
      arguments: [FAKE],
      cwd: process.cwd(),
      environment: { ...process.env, FAKE_PROVIDER_STEPS: JSON.stringify(steps) },
      ...launch
    },
    session: run.session,
    signal: signal ?? run.controller.signal,
    terminateTree:
      terminateTree?.(run) ??
      (async (pid) => {
        run.asked.push(pid);
        kill(pid);
      }),
    onSpawn: (pid) => {
      run.spawned.push(pid);
      reap(t, () => [pid]);
    },
    protocol: (channel) => ({
      receive: (message) => {
        run.received.push(message);
        if (typeof message.say === "string") run.session.emit({ type: "content.delta", text: message.say });
        if (typeof message.fail === "string") channel.fail(message.fail);
        if (message.result === true) channel.result();
      },
      converse: async () => channel.end(JSON.stringify({ ask: "go" })),
      ...protocol?.(channel, run)
    })
  });
  return run;
}

const errors = (events) =>
  events
    .filter((event) => event.type === "error")
    .map(({ code, message, retryable }) => ({ code, message, retryable }));

async function ended(run) {
  await run.ended;
  return { errors: errors(run.events), outcome: run.close().outcome, terminations: run.asked.length };
}

const brief = (events) =>
  events.map(({ type, code, outcome, reason, text }) =>
    [type, code ?? outcome ?? text, reason].filter(Boolean).join(":")
  );

// The end-of-run rule

test(
  "a provider that exits by itself after its result ends the run with no error, and nothing ends it",
  OPTIONS,
  async (t) => {
    assert.deepEqual(await ended(start(t, { steps: [RESULT, { exit: 0 }] })), {
      errors: [],
      outcome: "completed",
      terminations: 0
    });
  }
);

test("the exit status of a provider that exits by itself is part of its result", OPTIONS, async (t) => {
  assert.deepEqual(await ended(start(t, { steps: [RESULT, { exit: 3 }] })), {
    errors: [processFailure("VES_FAKE_PROCESS_FAILED")],
    outcome: "failed",
    terminations: 0
  });
});

test(
  "a provider the driver ends is ended once its result arrived, and the status that follows is not read",
  OPTIONS,
  async (t) => {
    assert.deepEqual(await ended(start(t, { profile: ENDED_BY_THE_DRIVER, steps: [RESULT, HANG] })), {
      errors: [],
      outcome: "completed",
      terminations: 1
    });
  }
);

// why: whether the run still finds such a provider running when it settles is
// a race, so how often the terminator was asked is not asserted.
test("a provider the driver ends that exits with a failure after its result still completes", OPTIONS, async (t) => {
  const { errors: reported, outcome } = await ended(
    start(t, { profile: ENDED_BY_THE_DRIVER, steps: [RESULT, { exit: 1 }] })
  );
  assert.deepEqual({ reported, outcome }, { reported: [], outcome: "completed" });
});

for (const profile of [EXITS_BY_ITSELF, ENDED_BY_THE_DRIVER]) {
  for (const [how, steps, code] of [
    ["exited cleanly", [{ exit: 0 }], "VES_FAKE_STREAM_INCOMPLETE"],
    ["ended with a non-zero code", [{ exit: 3 }], "VES_FAKE_PROCESS_FAILED"],
    ["was killed", [READY, { kill: "SIGKILL" }], "VES_FAKE_PROCESS_FAILED"]
  ]) {
    test(
      `${profile.afterResult}: a run whose result never arrived and whose provider ${how} reports ${code}`,
      OPTIONS,
      async (t) => {
        const { errors: reported, outcome, terminations } = await ended(start(t, { profile, steps }));
        assert.deepEqual(
          { reported, outcome, terminations },
          { reported: [processFailure(code)], outcome: "failed", terminations: 0 }
        );
      }
    );
  }
}

// Line and JSON framing

test("a line that is not JSON fails the stream and ends the provider through one termination", OPTIONS, async (t) => {
  assert.deepEqual(await ended(start(t, { steps: [{ line: "{not-json}" }, HANG] })), {
    errors: [streamFailure("VES_FAKE_STREAM_INVALID")],
    outcome: "failed",
    terminations: 1
  });
});

for (const [label, text] of [
  ["null", "null"],
  ["a string", '"VES_FAKE_ABORTED"'],
  ["a number", "5"],
  ["a boolean", "true"],
  ["an array", '[{"result":true}]']
]) {
  test(`a line that parses to ${label} fails the stream and is never received`, OPTIONS, async (t) => {
    const run = start(t, { steps: [{ line: text }, HANG] });
    assert.deepEqual(await ended(run), {
      errors: [streamFailure("VES_FAKE_STREAM_INVALID")],
      outcome: "failed",
      terminations: 1
    });
    assert.deepEqual(run.received, []);
  });
}

test(
  "every line is received in order, a CRLF ends a line, and lines after a failure are still received",
  OPTIONS,
  async (t) => {
    const run = start(t, { steps: [{ raw: '{"say":"a"}\r\n{not-json}\n{"say":"b"}\n' }, HANG] });
    await run.ended;
    assert.deepEqual(run.received, [{ say: "a" }, { say: "b" }]);
    assert.deepEqual(brief(run.events), ["content.delta:a", "content.delta:b", "error:VES_FAKE_STREAM_INVALID"]);
    assert.equal(run.asked.length, 1);
  }
);

test("a last line without a line ending is still received", OPTIONS, async (t) => {
  const run = start(t, { steps: [{ raw: '{"say":"last"}' }, { exit: 0 }] });
  assert.deepEqual((await ended(run)).errors, [processFailure("VES_FAKE_STREAM_INCOMPLETE")]);
  assert.deepEqual(run.received, [{ say: "last" }]);
});

// The output limit

test(
  "a line past the output limit fails the run, is not received, and the provider is ended once",
  OPTIONS,
  async (t) => {
    const lines = `{"say":"12345"}\n{"say":"${"x".repeat(40)}"}\n{"say":"later"}\n`;
    const run = start(t, { launch: { maxOutputBytes: 40 }, steps: [{ raw: lines }, HANG] });
    assert.deepEqual(await ended(run), {
      errors: [streamFailure("VES_FAKE_OUTPUT_LIMIT")],
      outcome: "failed",
      terminations: 1
    });
    assert.deepEqual(run.received, [{ say: "12345" }]);
  }
);

test("the output and the error stream share one limit", OPTIONS, async (t) => {
  const run = start(t, {
    launch: { maxOutputBytes: 40 },
    steps: [{ json: { say: "12345" } }, { sleep: 200 }, { err: "e".repeat(30) }, HANG]
  });
  assert.deepEqual(await ended(run), {
    errors: [streamFailure("VES_FAKE_OUTPUT_LIMIT")],
    outcome: "failed",
    terminations: 1
  });
  assert.deepEqual(run.received, [{ say: "12345" }]);
});

test("without a stated limit a provider may write 1 MiB, the line ending of each line included", OPTIONS, async (t) => {
  const within = start(t, { steps: [{ sized: 1_048_575 }, { exit: 0 }] });
  assert.deepEqual((await ended(within)).errors, [processFailure("VES_FAKE_STREAM_INCOMPLETE")]);
  assert.equal(within.received.length, 1);
  const past = start(t, { steps: [{ sized: 1_048_576 }, HANG] });
  assert.deepEqual(await ended(past), {
    errors: [streamFailure("VES_FAKE_OUTPUT_LIMIT")],
    outcome: "failed",
    terminations: 1
  });
});

// The input

test("frames are written one per line, and the last one closes the input", OPTIONS, async (t) => {
  const run = start(t, {
    steps: [{ readAll: true }, RESULT, { exit: 0 }],
    protocol: (channel) => ({
      converse: async () => {
        channel.write('{"n":1}');
        channel.end('{"n":2}');
      }
    })
  });
  assert.deepEqual(await ended(run), { errors: [], outcome: "completed", terminations: 0 });
  assert.deepEqual(run.received[0], { readAll: '{"n":1}\n{"n":2}\n' });
});

// hazard: on win32 the fake cannot close its input, so the write of a frame
// larger than the pipe holds neither fails nor ends there (AD-054); the case
// asserts what holds there instead: nothing ends the run, and a stop does.
test(
  WIN32_HOST
    ? "a provider that does not read its input is not ended by the run, and a stop ends it"
    : "a provider that closes its input before reading it fails the run with an input failure, and is ended once",
  OPTIONS,
  async (t) => {
    const run = start(t, {
      steps: [READY, { closeInput: true }, HANG],
      protocol: (channel) => ({ converse: async () => channel.end("x".repeat(2 * 1024 * 1024)) })
    });
    if (!WIN32_HOST) {
      assert.deepEqual(await ended(run), {
        errors: [streamFailure("VES_FAKE_STDIN_FAILED")],
        outcome: "failed",
        terminations: 1
      });
      return;
    }
    t.diagnostic("win32: the fake cannot close its standard input; asserting that a stop ends the run instead");
    let settled = false;
    void run.ended.then(() => (settled = true));
    await delay(1_000);
    assert.equal(settled, false, "the run ended by itself: the write to the provider's input failed on this platform");
    await run.cancel();
    assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
  }
);

// The first end decides the report

test(
  "the first failure decides the report, and a stream that keeps failing asks for one termination",
  OPTIONS,
  async (t) => {
    const lines = `{not-json}\n{"say":"${"y".repeat(2048)}"}\n{again-not-json}\n`;
    assert.deepEqual(await ended(start(t, { launch: { maxOutputBytes: 1024 }, steps: [{ raw: lines }, HANG] })), {
      errors: [streamFailure("VES_FAKE_STREAM_INVALID")],
      outcome: "failed",
      terminations: 1
    });
  }
);

test("a failure that follows a stop leaves the stop's report", OPTIONS, async (t) => {
  let cancelling;
  const run = start(t, {
    steps: [READY, { sleep: 200 }, { line: "{not-json}" }, HANG],
    // why: the provider outlives the stop long enough to write its broken line.
    terminateTree: (handle) => async (pid) => {
      handle.asked.push(pid);
      await delay(600);
      kill(pid);
    },
    onEvent: (event, handle) => {
      if (event.text === "ready") cancelling = handle.cancel();
    }
  });
  await run.ended;
  await cancelling;
  assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
});

test("a stop that follows a failure keeps the failure's report", OPTIONS, async (t) => {
  let cancelling;
  const run = start(t, {
    steps: [{ raw: '{not-json}\n{"say":"after"}\n' }, HANG],
    onEvent: (event, handle) => {
      if (event.text === "after") cancelling = handle.cancel();
    }
  });
  await run.ended;
  await cancelling;
  assert.deepEqual(brief(run.events), [
    "content.delta:after",
    "error:VES_FAKE_STREAM_INVALID",
    "session.closed:failed:user-request"
  ]);
  assert.equal(run.asked.length, 1, "the stop shares the failure's termination");
});

test(
  "a conversation that rejects is a protocol failure, and a provider still running is ended once",
  OPTIONS,
  async (t) => {
    const run = start(t, {
      profile: ENDED_BY_THE_DRIVER,
      steps: [HANG],
      protocol: () => ({
        converse: async () => {
          throw new Error("no answer");
        }
      })
    });
    assert.deepEqual(await ended(run), {
      errors: [streamFailure("VES_FAKE_PROTOCOL_FAILED", "protocol")],
      outcome: "failed",
      terminations: 1
    });
  }
);

// why: a conversation waiting for an answer that the provider's end turns
// into a rejection, as a pending request is rejected when its provider is gone.
function answeredOnlyByTheEnd() {
  let reject;
  const unanswered = new Promise((_, rejecting) => (reject = rejecting));
  return () => ({ converse: () => unanswered, closed: () => reject(new Error("the provider ended")) });
}

test("a conversation that rejects after a stop leaves the stop's report", OPTIONS, async (t) => {
  let cancelling;
  const run = start(t, {
    profile: ENDED_BY_THE_DRIVER,
    steps: [READY, HANG],
    protocol: answeredOnlyByTheEnd(),
    onEvent: (event, handle) => {
      if (event.text === "ready") cancelling = handle.cancel();
    }
  });
  await run.ended;
  await cancelling;
  assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
});

test("a provider that exited before its conversation failed is not terminated", OPTIONS, async (t) => {
  const run = start(t, { profile: ENDED_BY_THE_DRIVER, steps: [{ exit: 4 }], protocol: answeredOnlyByTheEnd() });
  assert.deepEqual(await ended(run), {
    errors: [streamFailure("VES_FAKE_PROTOCOL_FAILED", "protocol")],
    outcome: "failed",
    terminations: 0
  });
});

// Stops

test(
  "a cancel stops the provider through one termination, and the run reports before the terminal event",
  OPTIONS,
  async (t) => {
    let cancelled;
    const run = start(t, {
      steps: [READY, HANG],
      onEvent: (event, handle) => {
        if (event.text === "ready") cancelled = handle.cancel().then(() => brief(handle.events));
      }
    });
    await run.ended;
    assert.deepEqual(await cancelled, [
      "content.delta:ready",
      "error:VES_FAKE_ABORTED",
      "session.closed:cancelled:user-request"
    ]);
    assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
  }
);

function interruptible(interrupts, onInterrupt = () => undefined) {
  return (channel) => ({
    interrupt: () => {
      interrupts.push(channel.stopped());
      onInterrupt(channel);
    }
  });
}

test("without a grace period the start signal stops the provider at once and asks no interrupt", OPTIONS, async (t) => {
  const interrupts = [];
  const run = start(t, {
    steps: [READY, HANG],
    protocol: interruptible(interrupts),
    onEvent: (event, handle) => {
      if (event.text === "ready") handle.controller.abort();
    }
  });
  assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
  assert.deepEqual(interrupts, []);
});

test(
  "with a grace period the start signal asks for an interrupt and ends a provider still running after it",
  OPTIONS,
  async (t) => {
    const interrupts = [];
    const run = start(t, {
      launch: { abortGraceMs: 50 },
      steps: [READY, HANG],
      protocol: interruptible(interrupts),
      onEvent: (event, handle) => {
        if (event.text === "ready") handle.controller.abort();
      }
    });
    assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
    assert.deepEqual(interrupts, [true], "the interrupt is asked once, after the stop was recorded");
  }
);

test("a provider that stops within the grace period is not terminated", OPTIONS, async (t) => {
  const interrupts = [];
  const run = start(t, {
    launch: { abortGraceMs: 10_000 },
    steps: [{ readLine: true }, READY, { readLine: true }, { exit: 0 }],
    protocol: (channel) => ({
      converse: async () => channel.write('{"ask":"go"}'),
      ...interruptible(interrupts, () => channel.write('{"stop":true}'))(channel)
    }),
    onEvent: (event, handle) => {
      if (event.text === "ready") handle.controller.abort();
    }
  });
  assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 0 });
  assert.deepEqual(interrupts, [true]);
});

test("a stop asks for one termination whoever asks: the start signal and a cancel in one turn", OPTIONS, async (t) => {
  let cancelling;
  const run = start(t, {
    steps: [READY, HANG],
    terminateTree: (handle) => async (pid) => {
      handle.asked.push(pid);
      await delay(100);
      kill(pid);
    },
    onEvent: (event, handle) => {
      if (event.text !== "ready") return;
      handle.controller.abort();
      cancelling = handle.cancel();
    }
  });
  await run.ended;
  await cancelling;
  assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 1 });
});

test(
  "a cancel whose termination fails rejects and leaves the session open, and a later cancel tries again",
  OPTIONS,
  async (t) => {
    let ready;
    const announced = new Promise((resolve) => (ready = resolve));
    const run = start(t, {
      steps: [READY, HANG],
      terminateTree: (handle) => async (pid) => {
        handle.asked.push(pid);
        if (handle.asked.length === 1) throw new Error("the provider could not be stopped");
        kill(pid);
      },
      onEvent: (event) => {
        if (event.text === "ready") ready();
      }
    });
    await announced;
    await assert.rejects(run.cancel(), /could not be stopped/u);
    assert.equal(brief(run.events).at(-1), "content.delta:ready", "a failed cancel ends nothing");
    await run.cancel();
    assert.deepEqual(await ended(run), { errors: [ABORTED], outcome: "cancelled", terminations: 2 });
  }
);

// invariant: an end no caller awaits contains a termination that fails, so no
// rejection is left unhandled; the run then waits for the provider's own end.
for (const [label, launch, steps, stop, error] of [
  ["the start signal's stop", {}, [READY, HANG], (run) => run.controller.abort(), ABORTED],
  [
    "the start signal's stop after its grace period",
    { abortGraceMs: 10 },
    [READY, HANG],
    (run) => run.controller.abort(),
    ABORTED
  ],
  [
    "a stream failure",
    {},
    [READY, { line: "{not-json}" }, HANG],
    () => undefined,
    streamFailure("VES_FAKE_STREAM_INVALID")
  ]
]) {
  test(
    `${label} contains a termination that fails, and the run waits for the provider's own end`,
    OPTIONS,
    async (t) => {
      const unhandled = [];
      const record = (reason) => unhandled.push(reason);
      process.on("unhandledRejection", record);
      t.after(() => process.off("unhandledRejection", record));
      const run = start(t, {
        launch,
        steps,
        terminateTree: (handle) => async (pid) => {
          handle.asked.push(pid);
          throw new Error("the provider could not be stopped");
        },
        onEvent: (event, handle) => {
          if (event.text === "ready") stop(handle);
        }
      });
      let settled = false;
      void run.ended.then(() => (settled = true));
      await delay(300);
      assert.equal(settled, false, "the run ended without its provider ending");
      assert.ok(run.asked.length >= 1, "the termination was never asked for");
      assert.deepEqual(unhandled, []);
      kill(run.spawned[0]);
      await run.ended;
      assert.deepEqual(errors(run.events), [error]);
    }
  );
}

// The spawn

test("the provider leads a process group of its own everywhere but on Windows", OPTIONS, async (t) => {
  let group;
  const run = start(t, {
    steps: [READY, HANG],
    onEvent: (event, handle) => {
      if (event.text !== "ready") return;
      const [pid] = handle.spawned;
      group = WIN32_HOST ? undefined : { own: processGroupOf(pid), pid, caller: processGroupOf(process.pid) };
      void handle.cancel();
    }
  });
  await run.ended;
  if (WIN32_HOST) {
    t.diagnostic("win32: no process groups; asserting that the provider is spawned without one");
    assert.equal(OWN_PROCESS_GROUP, false);
    return;
  }
  assert.equal(group.own, group.pid, "the provider does not lead a process group of its own");
  assert.notEqual(group.own, group.caller, "the provider shares the caller's group");
});

test("the provider gets the launch's arguments, working directory and environment", OPTIONS, async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "verchestra-provider-child-")));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const steps = [{ facts: true }, RESULT, { exit: 0 }];
  const run = start(t, {
    steps,
    launch: {
      arguments: [FAKE, "--flag", ""],
      cwd: directory,
      environment: { ...process.env, FAKE_PROVIDER_STEPS: JSON.stringify(steps), FAKE_PROVIDER_MARKER: "marker" }
    }
  });
  assert.deepEqual(await ended(run), { errors: [], outcome: "completed", terminations: 0 });
  assert.deepEqual(run.received[0], { argv: ["--flag", ""], cwd: directory, marker: "marker" });
});

test(
  "the spawn observer learns the provider, and once the run has reported a cancel stops nothing",
  OPTIONS,
  async (t) => {
    const run = start(t, { steps: [RESULT, { exit: 0 }] });
    await run.ended;
    assert.equal(run.spawned.length, 1);
    assert.equal(run.session.resources.stop, undefined, "the stop outlived the run");
    await run.cancel("late");
    assert.deepEqual(brief(run.events), ["session.closed:cancelled:late"]);
    assert.equal(run.asked.length, 0);
  }
);
