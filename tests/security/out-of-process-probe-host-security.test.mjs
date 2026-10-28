import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { workspaceId } from "../helpers/database-probe-fixture.mjs";
import {
  ObservingResultSink,
  WIN32_HOST,
  eventuallyDead,
  fileDigest,
  launchApproved,
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

// why: a launch that should be refused but starts is ended here, so a wrong
// pass leaves no worker holding this test process open.
async function assertLaunchRefused(options, code) {
  let fixture;
  try {
    fixture = await spawnedProbe(options);
  } catch (error) {
    assert.equal(error.code, code);
    return;
  }
  await fixture.framed.terminate();
  assert.fail(`the launch started instead of failing with ${code}`);
}

for (const [label, mode, code] of [
  ["an oversize frame", "oversize-frame", "VES_PROBE_FRAME_MESSAGE_LIMIT"],
  ["a frame without Content-Length", "malformed-header", "VES_PROBE_FRAME_LENGTH_REQUIRED"],
  ["a frame body that is not JSON", "malformed-json", "VES_PROBE_FRAME_JSON_INVALID"],
  ["a payload digest mismatch", "digest-mismatch", "VES_PROBE_ENVELOPE_DIGEST"],
  ["an envelope bound to another Workspace", "foreign-workspace", "VES_PROBE_ENVELOPE_WORKSPACE"],
  ["a byte-identical frame replay", "replay", "VES_PROBE_SEQUENCE_REPLAY"],
  ["a replayed sequence number under a new message id", "stale-sequence", "VES_PROBE_SEQUENCE_GAP"],
  [
    "a self-reported component digest that differs from the approved one",
    "lie-digest",
    "VES_PROBE_HANDSHAKE_COMPONENT"
  ],
  ["a frame under an unknown payload schema version", "future-schema", "VES_PROBE_PAYLOAD_SCHEMA_UNSUPPORTED"]
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
    // Node's own spawn writes NODE_V8_COVERAGE into any explicit env whenever
    // the parent carries it, so a coverage run sees it; it is never host-supplied
    // and is still refused whenever this process is not itself measured.
    const runtimeAdded = new Set(["__CF_USER_TEXT_ENCODING"]);
    if (process.env.NODE_V8_COVERAGE !== undefined) runtimeAdded.add("NODE_V8_COVERAGE");
    const hostSupplied = report.environmentKeys.filter((key) => !runtimeAdded.has(key));
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

// invariant: T6 (#570). The worker runs the private copy of its entry, readable
// and executable by this user only, inside a directory only this user may enter.
test("the worker runs a 0500 copy of its entry inside a 0700 directory", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  const fixture = await spawnedProbe({ mode: "report-environment", results });
  assert.equal((await fixture.supervisor.execute()).status, "complete");
  const [report] = results.observed;
  assert.equal(report.cwdMode.toString(8), "700", "the private directory");
  assert.equal(report.entryMode.toString(8), "500", "the private copy of the entry");
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
    await assertLaunchRefused({ environment: { [name]: "value" } }, "VES_PROBE_HOST_ENVIRONMENT_DENIED");
  });
}

// invariant: #569, PHC-02. Each name makes a loader, runtime or shell read more
// code than the approved entry. The approval and the grant name the launch
// with it, and the host still refuses it.
for (const name of [
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PERL5OPT",
  "PERLLIB",
  "RUBYOPT",
  "RUBYLIB",
  "BASH_ENV",
  "ENV",
  "JAVA_TOOL_OPTIONS",
  "JDK_JAVA_OPTIONS",
  "GLIBC_TUNABLES",
  "GCONV_PATH"
]) {
  test(`the host refuses the loader variable ${name} even when the approval names it`, async (t) => {
    if (WIN32_HOST) return probeHostRefusedOnWin32(t);
    await assertLaunchRefused({ environment: { [name]: "value" } }, "VES_PROBE_HOST_ENVIRONMENT_DENIED");
  });
}

async function injectedModule(t) {
  const directory = await mkdtemp(join(tmpdir(), "verchestra-probe-injected-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "ran");
  const module = join(directory, "injected.cjs");
  await writeFile(module, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`);
  return { module, marker };
}

test("NODE_OPTIONS=--require never runs the module it names", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const { module, marker } = await injectedModule(t);
  await assertLaunchRefused(
    { environment: { NODE_OPTIONS: `--require ${module}` } },
    "VES_PROBE_HOST_ENVIRONMENT_DENIED"
  );
  assert.equal(existsSync(marker), false, "the injected module did not run");
});

// invariant: #569, PHC-01. The approval names one launch; the host is asked to
// start another. Nothing starts, so the extra code never runs.
const APPROVED_ENVIRONMENT = Object.freeze({
  PROBE_FIXTURE_MODE: "reference",
  PROBE_FIXTURE_COMPONENT: "plugin:acme-orders-probe"
});

test("a launch with an argument the approval does not name is refused before it starts", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const { module, marker } = await injectedModule(t);
  await assertLaunchRefused(
    { args: ["--require", module], approvedLaunch: { args: [] } },
    "VES_PROBE_HOST_LAUNCH_DIGEST"
  );
  assert.equal(existsSync(marker), false, "the module the argument names did not run");
});

test("a launch with an environment extra the approval does not name is refused", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  await assertLaunchRefused(
    {
      environment: { PROBE_FIXTURE_EXTRA: "unapproved" },
      approvedLaunch: { environment: APPROVED_ENVIRONMENT }
    },
    "VES_PROBE_HOST_LAUNCH_DIGEST"
  );
});

test("a launch through an executable the approval does not name is refused", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  await assertLaunchRefused({ approvedLaunch: { executable: "/bin/sh" } }, "VES_PROBE_HOST_LAUNCH_DIGEST");
});

test("the launch digest the host measures is the one the approval and the trust carry", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe();
  assert.match(fixture.transport.launchDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(fixture.transport.launchDigest, fixture.trust.launchDigest);
  assert.equal(fixture.framed.launchDigest, fixture.trust.launchDigest);
  await fixture.framed.terminate();
});

test("a bearer credential on stderr is redacted whatever its letter case", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const token = "AbCdEfGh0123XyZ";
  const directory = await mkdtemp(join(tmpdir(), "verchestra-probe-bearer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const worker = join(directory, "worker.mjs");
  await writeFile(worker, `process.stderr.write("Authorization: BEARER ${token}\\n");\n`);
  const transport = await launchApproved({
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
