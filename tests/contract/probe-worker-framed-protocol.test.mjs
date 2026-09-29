import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FramedProbeWorker,
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeFrameDecoder,
  ProbeSequenceGuard,
  ProbeWorkerSupervisor,
  encodeProbeFrame
} from "../../packages/extension-host/src/index.ts";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import { probePlan } from "../helpers/probe-worker-fixture.mjs";

const COMPONENT = { id: "probe-worker:framed", digest: `sha256:${"1".repeat(64)}` };

// why: an in-memory worker that speaks only bytes: it decodes every controller frame
// with the published codec and answers with encoded frames. The FramedProbeWorker
// under test therefore sees exactly what it would see on a process's stdout.
class ScriptedTransport {
  launchedComponentDigest = COMPONENT.digest;
  sent = [];
  terminated = 0;
  #listener;
  #sequence = 0;
  #decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 64, maximumMessageBytes: 65_536 });

  constructor(script = {}) {
    this.script = script;
  }

  attach(listener) {
    this.#listener = listener;
  }

  async send(frame) {
    for (const envelope of this.#decoder.push(frame)) {
      this.sent.push(envelope);
      const reply = this.script[envelope.payloadSchema.name] ?? defaultReplies[envelope.payloadSchema.name];
      for (const bytes of reply?.(this, envelope) ?? []) queueMicrotask(() => this.#listener.data(bytes));
    }
  }

  frame(name, payload, overrides = {}) {
    const bytes = encodeProbeFrame({
      protocol: "verchestra-probe/1",
      messageId: `worker:${this.#sequence}`,
      correlationId: "probe-channel:scripted",
      workspaceId,
      sequence: this.#sequence,
      payloadSchema: { name, version: 1 },
      payload,
      ...overrides
    });
    this.#sequence += 1;
    return bytes;
  }

  withhold() {}

  async terminate() {
    this.terminated += 1;
  }
}

const defaultReplies = {
  "probe.hello": (t) => [
    t.frame("probe.handshake", {
      protocol: "verchestra-probe/1",
      supportedSchemas: ["probe.plan/1", "probe.result/1"],
      component: COMPONENT,
      capabilities: ["database-read"],
      maximumMessageBytes: 65_536
    })
  ],
  "probe.identity.request": (t, envelope) => [
    t.frame("probe.identity", {
      evidence: {
        databaseId: envelope.payload.plan.databaseId,
        principalReadOnly: true,
        principalFingerprint: `sha256:${"2".repeat(64)}`
      }
    })
  ],
  "probe.session.request": (t, envelope) => [
    t.frame("probe.session", {
      planDigest: envelope.payload.plan.planDigest,
      sessionReadOnly: true,
      transactionReadOnly: true
    })
  ],
  "probe.execute": (t) => [
    t.frame("probe.result.chunk", { rows: [{ id: 1 }] }),
    t.frame("probe.result.end", { chunkCount: 1 })
  ]
};

async function framedFixture(script) {
  const plan = await probePlan();
  const transport = new ScriptedTransport(script);
  const worker = new FramedProbeWorker({ transport, workspaceId, maximumMessageBytes: 65_536 });
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(plan.operation.protectedRequestRef, new TextEncoder().encode("framed-parameter"));
  const results = new MemoryProbeResultSink();
  const supervisor = new ProbeWorkerSupervisor({
    worker,
    parameters,
    results,
    plan,
    expectedComponent: COMPONENT,
    maximumMessageBytes: 65_536
  });
  return { plan, transport, worker, parameters, results, supervisor };
}

test("the supervisor drives a framed worker through the codec in the specified message order", async () => {
  const { supervisor, transport, results, plan } = await framedFixture();
  const result = await supervisor.execute();
  assert.equal(result.status, "complete");
  assert.equal(result.rowCount, 1);
  assert.equal(results.commits, 1);
  assert.deepEqual(
    transport.sent.map((envelope) => envelope.payloadSchema.name),
    ["probe.hello", "probe.identity.request", "probe.session.request", "probe.execute"]
  );
  assert.deepEqual(
    transport.sent.map((envelope) => envelope.sequence),
    [0, 1, 2, 3]
  );
  assert.ok(transport.sent.every((envelope) => envelope.workspaceId === plan.workspaceId));
  assert.equal(transport.sent[3].payload.planDigest, plan.planDigest);
});

test("the protected parameter frame and the delivered parameter bytes are zeroized after the stream", async () => {
  const { supervisor, worker, parameters } = await framedFixture();
  await supervisor.execute();
  assert.equal(worker.parameterFrameZeroized, true);
  assert.equal(
    parameters.lastDelivered.every((byte) => byte === 0),
    true
  );
});

test("a completed stream still tears the worker down exactly once", async () => {
  const { supervisor, transport, worker } = await framedFixture();
  await supervisor.execute();
  await worker.terminate();
  assert.equal(transport.terminated, 1);
  assert.equal(worker.cancelled, false);
});

for (const [label, script, code] of [
  [
    "a result stream whose end frame miscounts its chunks",
    { "probe.execute": (t) => [t.frame("probe.result.end", { chunkCount: 3 })] },
    "VES_PROBE_RESULT_INVALID"
  ],
  [
    "a handshake answered with the wrong message",
    { "probe.hello": (t) => [t.frame("probe.session", { planDigest: "x" })] },
    "VES_PROBE_MESSAGE_UNEXPECTED"
  ],
  [
    "a handshake with an extra key",
    {
      "probe.hello": (t) => [
        t.frame("probe.handshake", {
          protocol: "verchestra-probe/1",
          supportedSchemas: [],
          component: COMPONENT,
          capabilities: [],
          maximumMessageBytes: 1,
          grant: true
        })
      ]
    },
    "VES_PROBE_HANDSHAKE_INVALID"
  ],
  [
    "a result chunk whose rows are not an array",
    { "probe.execute": (t) => [t.frame("probe.result.chunk", { rows: { id: 1 } })] },
    "VES_PROBE_RESULT_INVALID"
  ],
  [
    "identity evidence with a smuggled field",
    {
      "probe.identity.request": (t) => [
        t.frame("probe.identity", {
          evidence: { databaseId: "orders-production", principalReadOnly: true, principalFingerprint: "x", admin: 1 }
        })
      ]
    },
    "VES_PROBE_IDENTITY_INVALID"
  ]
]) {
  test(`framed protocol fails closed on ${label}`, async () => {
    const { supervisor, transport, results } = await framedFixture(script);
    await assert.rejects(supervisor.execute(), { code });
    assert.ok(transport.terminated >= 1, "the worker is torn down");
    assert.equal(results.commits, 0);
  });
}

test("a worker-reported error crosses the boundary only as a fixed sanitized code", async () => {
  const { supervisor } = await framedFixture({
    "probe.execute": (t) => [t.frame("probe.error", { message: "password=framed-parameter at /private/path" })]
  });
  await assert.rejects(supervisor.execute(), (error) => {
    assert.equal(error.code, "VES_PROBE_WORKER_FAILURE");
    assert.equal(error.message, "Probe worker failed");
    assert.equal(JSON.stringify(error).includes("framed-parameter"), false);
    return true;
  });
});

test("a strict sequence guard rejects a byte-identical replay that the default guard tolerates", () => {
  const first = { messageId: "one", sequence: 0, payloadDigest: `sha256:${"1".repeat(64)}` };
  const tolerant = new ProbeSequenceGuard();
  tolerant.accept(first);
  assert.equal(tolerant.accept(first).duplicate, true);
  const strict = new ProbeSequenceGuard({ duplicates: "reject" });
  strict.accept(first);
  assert.throws(() => strict.accept(first), {
    code: "VES_PROBE_SEQUENCE_REPLAY",
    terminateWorker: true,
    revokeGrant: true
  });
});

test("the strict guard still reports an incompatible identity reuse as a conflict", () => {
  const strict = new ProbeSequenceGuard({ duplicates: "reject" });
  strict.accept({ messageId: "one", sequence: 0, payloadDigest: `sha256:${"1".repeat(64)}` });
  assert.throws(() => strict.accept({ messageId: "one", sequence: 0, payloadDigest: `sha256:${"2".repeat(64)}` }), {
    code: "VES_PROBE_MESSAGE_CONFLICT"
  });
});

test("a supervisor requires exactly one trust root", async () => {
  const { plan } = await framedFixture();
  const base = {
    worker: {},
    parameters: new MemoryProtectedParameterBroker(),
    results: new MemoryProbeResultSink(),
    plan,
    maximumMessageBytes: 65_536
  };
  assert.throws(() => new ProbeWorkerSupervisor(base), { code: "VES_PROBE_TRUST_INVALID" });
});
