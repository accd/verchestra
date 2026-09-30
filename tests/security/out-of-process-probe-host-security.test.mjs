import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SpawnedProbeWorker } from "../../packages/platform-node/src/index.ts";
import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import {
  ObservingResultSink,
  WIN32_HOST,
  eventuallyDead,
  fileDigest,
  probeHostRefusedOnWin32,
  spawnedProbe
} from "../helpers/spawned-probe-worker-fixture.mjs";

const SECRET = "sensitive-probe-parameter";

// why: every hostile worker below is a real child process speaking real stdio bytes.
// Each case proves the violation is named, the grant is revoked, the process
// tree is gone, its private directory is removed, and nothing was committed.
async function assertContained(fixture, code) {
  await assert.rejects(fixture.supervisor.execute(), (error) => {
    assert.equal(error.code, code);
    assert.equal(error.revokeGrant, true);
    return true;
  });
  assert.equal(fixture.results.commits, 0);
  assert.equal(await eventuallyDead(fixture.transport.pid), true, "the worker process is gone");
  assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
}

for (const [label, mode, code] of [
  ["an oversize frame", "oversize-frame", "VES_PROBE_FRAME_MESSAGE_LIMIT"],
  ["a frame without Content-Length", "malformed-header", "VES_PROBE_FRAME_LENGTH_REQUIRED"],
  ["a frame body that is not JSON", "malformed-json", "VES_PROBE_FRAME_JSON_INVALID"],
  ["a payload digest mismatch", "digest-mismatch", "VES_PROBE_ENVELOPE_DIGEST"],
  ["an envelope bound to another Workspace", "foreign-workspace", "VES_PROBE_ENVELOPE_WORKSPACE"],
  ["a byte-identical frame replay", "replay", "VES_PROBE_SEQUENCE_REPLAY"],
  ["a replayed sequence number under a new message id", "stale-sequence", "VES_PROBE_SEQUENCE_GAP"],
  ["a self-reported component digest that differs from the approved one", "lie-digest", "VES_PROBE_HANDSHAKE_COMPONENT"]
]) {
  test(`a spawned worker sending ${label} is terminated`, async (t) => {
    if (WIN32_HOST) return probeHostRefusedOnWin32(t);
    await assertContained(await spawnedProbe({ mode }), code);
  });
}

test("a workspace worker without workspace admission cannot pass the product handshake pin", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({
    productComponent: { id: "probe-worker:postgresql", digest: `sha256:${"1".repeat(64)}` }
  });
  await assertContained(fixture, "VES_PROBE_HANDSHAKE_COMPONENT");
});

test("a secret echoed in a result is detected, never committed, and zeroized on every host copy", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({ mode: "leak", parameter: SECRET });
  await assert.rejects(fixture.supervisor.execute(), (error) => {
    assert.equal(error.code, "VES_PROBE_SECRET_LEAK");
    assert.equal(JSON.stringify(error).includes(SECRET), false);
    assert.equal(error.message.includes(SECRET), false);
    return true;
  });
  assert.equal(fixture.results.commits, 0);
  assert.equal(fixture.results.rollbacks, 1);
  assert.equal(
    fixture.parameters.lastDelivered.every((byte) => byte === 0),
    true,
    "the delivered parameter bytes are zeroized"
  );
  assert.equal(fixture.framed.parameterFrameZeroized, true, "the outbound parameter frame is zeroized");
  const diagnostics = fixture.transport.diagnostics();
  assert.ok(diagnostics.stderrBytes > 0, "the worker did write the secret to stderr");
  assert.equal(diagnostics.stderrExcerpt.includes(SECRET), false, "the retained stderr excerpt is scrubbed");
  assert.equal(await eventuallyDead(fixture.transport.pid), true);
});

test("a worker error message carrying protected material is sanitized", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({ mode: "error", parameter: SECRET });
  await assert.rejects(fixture.supervisor.execute(), (error) => {
    assert.equal(error.code, "VES_PROBE_WORKER_FAILURE");
    assert.equal(error.message, "Probe worker failed");
    assert.equal(JSON.stringify(error).includes(SECRET), false);
    return true;
  });
  assert.equal(fixture.results.commits, 0);
});

test("a stderr flood is bounded, terminates the tree, and keeps only a bounded excerpt", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({
    mode: "stderr-flood",
    limits: { stderrBytes: 64 * 1024, stderrExcerptBytes: 512 }
  });
  await assertContained(fixture, "VES_PROBE_HOST_STDERR_LIMIT");
  const diagnostics = fixture.transport.diagnostics();
  assert.ok(diagnostics.stderrBytes > 64 * 1024);
  assert.ok(diagnostics.stderrExcerpt.length <= 512);
  assert.equal(diagnostics.stderrTruncated, true);
  assert.match(diagnostics.stderrDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("a worker whose stdout exceeds the host output bound is terminated", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  await assertContained(await spawnedProbe({ limits: { stdoutBytes: 256 } }), "VES_PROBE_HOST_STDOUT_LIMIT");
});

test("the worker environment is built from nothing and inherits no ambient secret", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const ambient = "VERCHESTRA_TEST_AMBIENT_SECRET";
  process.env[ambient] = SECRET;
  try {
    const results = new ObservingResultSink();
    const fixture = await spawnedProbe({ mode: "report-environment", results });
    const envelope = await fixture.supervisor.execute();
    assert.equal(envelope.status, "complete");
    const [report] = results.observed;
    assert.equal(report.environmentKeys.includes(ambient), false);
    // why: macOS libSystem adds its text-encoding hint to every new process; it
    // is set by the OS at exec, carries no secret, and is not host-supplied.
    const hostSupplied = report.environmentKeys.filter((key) => key !== "__CF_USER_TEXT_ENCODING");
    assert.deepEqual(hostSupplied, [
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
      "PROBE_FIXTURE_COMPONENT",
      "PROBE_FIXTURE_MODE",
      "TMPDIR",
      "VERCHESTRA_PROBE_PROTOCOL",
      "VERCHESTRA_PROBE_WORKSPACE_ID"
    ]);
    assert.equal(report.cwd.includes("verchestra-probe-"), true, "the cwd is the private temp directory");
    assert.equal(existsSync(report.cwd), false, "the private directory is removed after the probe");
  } finally {
    delete process.env[ambient];
  }
});

for (const name of [
  "DATABASE_PASSWORD",
  "GITHUB_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "PATH",
  "VERCHESTRA_PROBE_WORKSPACE_ID"
]) {
  test(`the host refuses to pass ${name} into a worker environment`, async (t) => {
    if (WIN32_HOST) return probeHostRefusedOnWin32(t);
    await assert.rejects(spawnedProbe({ environment: { [name]: "value" } }), {
      code: "VES_PROBE_HOST_ENVIRONMENT_DENIED"
    });
  });
}

test("a bearer credential on stderr is redacted whatever its letter case", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const token = "AbCdEfGh0123XyZ";
  const directory = await mkdtemp(join(tmpdir(), "verchestra-probe-bearer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = join(directory, "worker.mjs");
  await writeFile(worker, `process.stderr.write("Authorization: BEARER ${token}\\n");\n`);
  const transport = await SpawnedProbeWorker.launch({
    executable: process.execPath,
    entry: { path: worker, digest: fileDigest(worker) },
    workspaceId
  });
  await new Promise((resolve) => transport.attach({ data() {}, fault() {}, exit: resolve }));
  const diagnostics = transport.diagnostics();
  await transport.terminate();
  assert.ok(diagnostics.stderrBytes > 0, "the worker did write the credential to stderr");
  assert.equal(diagnostics.stderrExcerpt.includes(token), false, "the retained stderr excerpt is scrubbed");
  assert.equal(diagnostics.stderrExcerpt.includes("[redacted]"), true);
  assert.equal(diagnostics.stderrRedactions, 1);
});
