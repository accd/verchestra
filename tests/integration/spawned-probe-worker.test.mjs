import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { FramedProbeWorker, encodeProbeFrame } from "../../packages/extension-host/src/index.ts";
import { SpawnedProbeWorker } from "../../packages/platform-node/src/index.ts";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import {
  NODE_WORKER,
  POSIX_ONLY,
  PYTHON_WORKER,
  eventuallyDead,
  fileDigest,
  findPython,
  spawnedProbe
} from "../helpers/spawned-probe-worker-fixture.mjs";

test("a plain Node reference worker completes a probe over stdio frames", { skip: POSIX_ONLY }, async () => {
  const fixture = await spawnedProbe();
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
  assert.equal(result.rowCount, 2);
  assert.equal(result.planDigest, fixture.plan.planDigest);
  assert.equal(fixture.results.commits, 1);
  const diagnostics = fixture.transport.diagnostics();
  assert.equal(diagnostics.terminated, true, "the worker never outlives its stream");
  assert.equal(diagnostics.workDirectoryRemoved, true);
  assert.equal(await eventuallyDead(fixture.transport.pid), true);
});

const python = findPython();
const pythonSkip =
  POSIX_ONLY ||
  (python === undefined
    ? "python3 is not on this runner's PATH, so second-language neutrality is unproven on this host"
    : false);

test("a Python worker speaking only the published frames completes the same probe", { skip: pythonSkip }, async () => {
  const fixture = await spawnedProbe({ worker: PYTHON_WORKER, executable: python, args: ["-I", "-B"] });
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
  assert.equal(result.rowCount, 1);
  assert.equal(fixture.trust.componentDigest, fileDigest(PYTHON_WORKER));
  assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
  assert.equal(await eventuallyDead(fixture.transport.pid), true);
});

// why: U+1F600 is a surrogate pair (0xD83D 0xDE00), so it sorts below U+E000 by
// UTF-16 code unit but above it by code point. A worker that orders keys by code
// point derives a different payload digest for this payload than the host does.
const MIXED_PLANE_PAYLOAD = Object.freeze({ "\uE000": 0, "\u{1F600}": 0 });

function sha256(text) {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

function controllerFrame(name, payload) {
  return encodeProbeFrame({
    protocol: "verchestra-probe/1",
    messageId: "controller:0",
    correlationId: "probe-channel:ordering",
    workspaceId,
    sequence: 0,
    payloadSchema: { name, version: 1 },
    payload
  });
}

// invariant: a reference worker verifies every inbound payload digest and exits 3
// on a mismatch; `probe.cancel` makes a worker that agrees exit 0.
async function exitCodeAfterCancel(worker, executable, args) {
  const transport = await SpawnedProbeWorker.launch({
    executable,
    args,
    entry: { path: worker, digest: fileDigest(worker) },
    workspaceId
  });
  try {
    const exited = new Promise((resolve) => transport.attach({ data() {}, fault() {}, exit: resolve }));
    await transport.send(controllerFrame("probe.cancel", MIXED_PLANE_PAYLOAD));
    await exited;
    return transport.diagnostics().exitCode;
  } finally {
    await transport.terminate();
  }
}

test("the host orders payload keys by UTF-16 code unit, as RFC 8785 specifies", () => {
  const frame = controllerFrame("probe.cancel", MIXED_PLANE_PAYLOAD);
  const envelope = JSON.parse(frame.subarray(frame.indexOf("\r\n\r\n") + 4).toString("utf8"));
  assert.equal(envelope.payloadDigest, sha256('{"\u{1F600}":0,"\uE000":0}'));
  assert.notEqual(envelope.payloadDigest, sha256('{"\uE000":0,"\u{1F600}":0}'), "code-point order is not the protocol");
});

test("the Node reference worker derives the host's digest for keys above the BMP", { skip: POSIX_ONLY }, async () => {
  assert.equal(await exitCodeAfterCancel(NODE_WORKER, process.execPath, []), 0);
});

test("the Python reference worker derives the host's digest for keys above the BMP", { skip: pythonSkip }, async () => {
  assert.equal(await exitCodeAfterCancel(PYTHON_WORKER, python, ["-I", "-B"]), 0);
});

test(
  "the host refuses to spawn an entry whose bytes differ from the approved digest",
  { skip: POSIX_ONLY },
  async () => {
    await assert.rejects(
      SpawnedProbeWorker.launch({
        executable: process.execPath,
        entry: { path: NODE_WORKER, digest: `sha256:${"0".repeat(64)}` },
        workspaceId
      }),
      { code: "VES_PROBE_HOST_ENTRY_DIGEST" }
    );
  }
);

test(
  "the executed file is a private copy, so a later change to the source cannot swap the code",
  {
    skip: POSIX_ONLY
  },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "verchestra-probe-source-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const source = join(directory, "worker.mjs");
    await copyFile(NODE_WORKER, source);
    const transport = await SpawnedProbeWorker.launch({
      executable: process.execPath,
      entry: { path: source, digest: fileDigest(NODE_WORKER) },
      workspaceId
    });
    await writeFile(source, "process.exit(99);\n");
    const framed = new FramedProbeWorker({ transport, workspaceId, maximumMessageBytes: 65_536 });
    const handshake = await framed.handshake();
    assert.equal(handshake.component.digest, fileDigest(NODE_WORKER), "the running code is the approved bytes");
    assert.equal(transport.launchedComponentDigest, fileDigest(NODE_WORKER));
    await framed.terminate();
    assert.notEqual(transport.diagnostics().exitCode, 99);
  }
);

test("the probe host refuses a win32 host rather than claim an unqualified platform", async () => {
  await assert.rejects(
    SpawnedProbeWorker.launch({
      executable: process.execPath,
      entry: { path: NODE_WORKER, digest: fileDigest(NODE_WORKER) },
      workspaceId,
      platform: "win32"
    }),
    { code: "VES_PROBE_HOST_PLATFORM_UNSUPPORTED" }
  );
});

for (const [label, options] of [
  ["a relative executable", { executable: "node" }],
  ["an argument with a null byte", { args: ["--x\0y"] }],
  ["a malformed Workspace", { workspaceId: "../escape" }],
  ["a zero limit", { limits: { stderrBytes: 0 } }]
]) {
  test(`the probe host refuses ${label}`, { skip: POSIX_ONLY }, async () => {
    await assert.rejects(
      SpawnedProbeWorker.launch({
        executable: process.execPath,
        entry: { path: NODE_WORKER, digest: fileDigest(NODE_WORKER) },
        workspaceId,
        ...options
      }),
      { code: "VES_PROBE_HOST_INPUT_INVALID" }
    );
  });
}

test("termination is idempotent and closes the channel", { skip: POSIX_ONLY }, async () => {
  const transport = await SpawnedProbeWorker.launch({
    executable: process.execPath,
    entry: { path: NODE_WORKER, digest: fileDigest(NODE_WORKER) },
    workspaceId
  });
  await Promise.all([transport.terminate(), transport.terminate()]);
  await transport.terminate();
  await assert.rejects(transport.send(Buffer.from("x")), { code: "VES_PROBE_HOST_CHANNEL_CLOSED" });
  assert.equal(await eventuallyDead(transport.pid), true);
});
