// invariant: door 2 of .specs/features/sqlite-probe-worker/plan.md, in process
// and on every platform. The first-party SQLite worker's configuration and its
// `verchestra-probe/1` loop, driven frame by frame over a real SQLite file the
// way the framed host drives it: the handshake names the configured id and the
// running file's digest, identity and session are SQLite's read-only ones, and
// rows are read only under the plan the session was opened with. The bundled
// process itself runs in tests/integration/sqlite-probe-worker.test.mjs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner,
  normalizeDatabaseRegistration
} from "../../packages/data-probe/src/index.ts";
import { ProbeFrameDecoder, encodeProbeFrame } from "../../packages/extension-host/src/index.ts";
import { sqliteStatement } from "../../apps/vestra-cli/src/probe/probe-statement.ts";
import {
  CONFIGURATION_REFUSED,
  PROTOCOL_REFUSED,
  runSqliteProbeWorker,
  serveSqliteProbe,
  sqliteWorkerConfiguration
} from "../../apps/vestra-cli/src/probe/sqlite-probe-worker.ts";
import { policy, registration, workspaceId } from "../helpers/database-probe-fixture.mjs";
import { ordersDatabase } from "../helpers/probe-run-fixture.mjs";
import { removeTemporaryDirectory } from "../helpers/temporary-directory.mjs";

const COMPONENT = "plugin:acme-orders-sqlite";
const SQL = "SELECT id, status FROM main.orders WHERE id = ?";
const SELF = fileURLToPath(import.meta.url);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

test("the worker is configured by its two approved variables and the host's Workspace id", () => {
  const absolute = join(fileURLToPath(new URL(".", import.meta.url)), "orders.sqlite");
  const configured = {
    PROBE_SQLITE_PATH: absolute,
    PROBE_COMPONENT_ID: COMPONENT,
    VERCHESTRA_PROBE_WORKSPACE_ID: workspaceId
  };
  assert.deepEqual(sqliteWorkerConfiguration(configured), {
    databasePath: absolute,
    componentId: COMPONENT,
    workspaceId
  });
  for (const [label, environment] of [
    ["nothing", {}],
    ["no path", { ...configured, PROBE_SQLITE_PATH: undefined }],
    ["an empty path", { ...configured, PROBE_SQLITE_PATH: "" }],
    ["a relative path", { ...configured, PROBE_SQLITE_PATH: "orders.sqlite" }],
    ["no component id", { ...configured, PROBE_COMPONENT_ID: undefined }],
    ["an empty component id", { ...configured, PROBE_COMPONENT_ID: "" }],
    ["no Workspace id", { ...configured, VERCHESTRA_PROBE_WORKSPACE_ID: undefined }]
  ])
    assert.equal(sqliteWorkerConfiguration(environment), undefined, label);
});

// why: a process as the worker sees it: stdin it is fed, stdout it writes
// frames to, and the exit it asks for.
function workerProcess(env) {
  const stdin = new EventEmitter();
  const frames = [];
  const exits = [];
  return {
    env,
    argv: [process.execPath, SELF],
    stdin,
    stdout: { write: (frame) => frames.push(Buffer.from(frame)) },
    exit: (status) => exits.push(status),
    frames,
    exits
  };
}

test("an unconfigured worker exits before it writes anything", () => {
  const worker = workerProcess({ VERCHESTRA_PROBE_WORKSPACE_ID: workspaceId, PROBE_COMPONENT_ID: COMPONENT });
  runSqliteProbeWorker(worker);
  assert.deepEqual(worker.exits, [CONFIGURATION_REFUSED]);
  assert.equal(worker.frames.length, 0);
  assert.equal(worker.stdin.listenerCount("data"), 0, "an unconfigured worker reads nothing");
});

async function ordersPlan() {
  const sqlite = registration({
    engine: "sqlite",
    databaseId: "orders",
    approvedSchemas: ["main"],
    policyRef: "orders"
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(sqlite);
  const statement = sqliteStatement({ sql: SQL, parameters: [1] }, normalizeDatabaseRegistration(sqlite));
  const plan = await new ProbePlanner({ registry, adapters: [statement.adapter] }).plan(
    {
      schemaVersion: 1,
      workspaceId,
      requestId: "probe-request-001",
      databaseId: "orders",
      purpose: "schema-discovery",
      operation: statement.operation,
      bounds: { timeoutMs: 2_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
      grantRef: "capability-grant-001"
    },
    policy({ policyRef: "orders", allowedObjects: ["main.orders"] })
  );
  return { plan, statement };
}

// why: the host side of the channel, framed as FramedProbeWorker frames it.
function host(worker) {
  const decoder = new ProbeFrameDecoder({ workspaceId, maximumHeaderBytes: 64, maximumMessageBytes: 1_048_576 });
  let sequence = 0;
  let read = 0;
  return {
    send(name, payload) {
      worker.stdin.emit(
        "data",
        encodeProbeFrame({
          protocol: "verchestra-probe/1",
          messageId: `controller:${sequence}`,
          correlationId: "probe-channel:test",
          workspaceId,
          sequence,
          payloadSchema: { name, version: 1 },
          payload
        })
      );
      sequence += 1;
    },
    // why: every frame the worker has written since the last read, decoded.
    async received() {
      await new Promise((resolve) => setImmediate(resolve));
      const fresh = worker.frames.slice(read);
      read = worker.frames.length;
      return fresh.flatMap((frame) => decoder.push(frame));
    }
  };
}

// why: the fixture's SQLite file in a directory of its own. The channel's end
// closes the worker's read connection before the directory is removed, since
// Windows cannot remove a file that is still open.
async function ordersFile(t, input) {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-sqlite-worker-unit-"));
  t.after(async () => {
    input.emit("end");
    await removeTemporaryDirectory(directory);
  });
  const database = join(directory, "orders.sqlite");
  ordersDatabase(database);
  return database;
}

async function servingWorker(t) {
  const worker = workerProcess({
    PROBE_COMPONENT_ID: COMPONENT,
    VERCHESTRA_PROBE_WORKSPACE_ID: workspaceId
  });
  const database = await ordersFile(t, worker.stdin);
  worker.env.PROBE_SQLITE_PATH = database;
  runSqliteProbeWorker(worker);
  return { worker, database, channel: host(worker) };
}

test("the worker answers the protocol over a real SQLite file", async (t) => {
  const { worker, database, channel } = await servingWorker(t);
  const before = sha256(readFileSync(database));
  const { plan, statement } = await ordersPlan();
  channel.send("probe.hello", { maximumMessageBytes: 65_536 });
  const [handshake] = await channel.received();
  assert.equal(handshake.payloadSchema.name, "probe.handshake");
  assert.equal(handshake.sequence, 0);
  assert.deepEqual(handshake.payload, {
    protocol: "verchestra-probe/1",
    supportedSchemas: ["probe.plan/1", "probe.result/1"],
    component: { id: COMPONENT, digest: sha256(readFileSync(SELF)) },
    capabilities: ["database-read"],
    maximumMessageBytes: 65_536
  });
  channel.send("probe.identity.request", { plan });
  const [identity] = await channel.received();
  assert.equal(identity.payloadSchema.name, "probe.identity");
  assert.equal(identity.payload.evidence.databaseId, "orders");
  assert.equal(identity.payload.evidence.principalReadOnly, true);
  channel.send("probe.session.request", { plan });
  const [session] = await channel.received();
  assert.deepEqual(session.payload, { planDigest: plan.planDigest, sessionReadOnly: true, transactionReadOnly: true });
  channel.send("probe.execute", {
    planDigest: plan.planDigest,
    parameters: Buffer.from(statement.protectedRequest).toString("base64")
  });
  const results = await channel.received();
  assert.deepEqual(
    results.map((envelope) => [envelope.payloadSchema.name, envelope.payload]),
    [
      ["probe.result.chunk", { rows: [{ id: 1, status: "paid" }] }],
      ["probe.result.end", { chunkCount: 1 }]
    ]
  );
  assert.deepEqual(
    results.map((envelope) => envelope.sequence),
    [3, 4]
  );
  assert.deepEqual(worker.exits, [], "the worker waits for the host after its stream");
  channel.send("probe.cancel", {});
  await channel.received();
  assert.deepEqual(worker.exits, [0]);
  assert.equal(sha256(readFileSync(database)), before, "the SQLite file's bytes are unchanged");
});

test("the worker reads rows only under the plan its session opened", async (t) => {
  const { worker, channel } = await servingWorker(t);
  const { plan, statement } = await ordersPlan();
  const parameters = Buffer.from(statement.protectedRequest).toString("base64");
  channel.send("probe.execute", { planDigest: plan.planDigest, parameters });
  const [early] = await channel.received();
  assert.deepEqual(early.payload, { code: "SQLITE_WORKER_FAILED", message: "The SQLite worker failed" });
  channel.send("probe.identity.request", { plan });
  await channel.received();
  channel.send("probe.execute", { planDigest: `sha256:${"0".repeat(64)}`, parameters });
  const [other] = await channel.received();
  assert.equal(other.payloadSchema.name, "probe.error");
  assert.equal(JSON.stringify(other.payload).includes("orders"), false, "a failure names nothing of the database");
  assert.deepEqual(worker.exits, []);
});

test("a message the worker does not answer, or a frame it cannot read, ends it", async (t) => {
  const unknown = await servingWorker(t);
  unknown.channel.send("probe.unknown", {});
  await unknown.channel.received();
  assert.deepEqual(unknown.worker.exits, [PROTOCOL_REFUSED]);
  const garbled = await servingWorker(t);
  garbled.worker.stdin.emit("data", Buffer.from("Content-Length: 2\r\n\r\n{]"));
  assert.deepEqual(garbled.worker.exits, [PROTOCOL_REFUSED]);
  assert.equal(garbled.worker.frames.length, 0);
  const ended = await servingWorker(t);
  ended.worker.stdin.emit("end");
  assert.deepEqual(ended.worker.exits, [0]);
});

test("the served channel answers in the order frames arrive", async (t) => {
  const stdin = new EventEmitter();
  const database = await ordersFile(t, stdin);
  const frames = [];
  const exits = [];
  serveSqliteProbe(
    { databasePath: database, componentId: COMPONENT, workspaceId },
    { id: COMPONENT, digest: `sha256:${"1".repeat(64)}` },
    { input: stdin, write: (frame) => frames.push(Buffer.from(frame)), exit: (status) => exits.push(status) }
  );
  const { plan } = await ordersPlan();
  const channel = host({ stdin, frames });
  // why: two frames in one chunk, as a pipe may deliver them.
  const first = encodeProbeFrame({
    protocol: "verchestra-probe/1",
    messageId: "controller:0",
    correlationId: "probe-channel:test",
    workspaceId,
    sequence: 0,
    payloadSchema: { name: "probe.hello", version: 1 },
    payload: {}
  });
  const second = encodeProbeFrame({
    protocol: "verchestra-probe/1",
    messageId: "controller:1",
    correlationId: "probe-channel:test",
    workspaceId,
    sequence: 1,
    payloadSchema: { name: "probe.identity.request", version: 1 },
    payload: { plan }
  });
  stdin.emit("data", Buffer.concat([first, second]));
  const answers = await channel.received();
  assert.deepEqual(
    answers.map((envelope) => [envelope.payloadSchema.name, envelope.sequence]),
    [
      ["probe.handshake", 0],
      ["probe.identity", 1]
    ]
  );
  assert.equal(answers[0].payload.component.digest, `sha256:${"1".repeat(64)}`);
});
