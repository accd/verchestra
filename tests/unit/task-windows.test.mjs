// invariant: SSI-73 and SSI-74 on the task path. Before a Windows run's first
// transition, a missing PowerShell 7, enabled logging or transcription, an
// unprovable owner-only ACL, and a Claude Code managed policy are each
// `VES_TASK_NOT_CONFIGURED` with the prerequisite named. A DETERMINISTIC FAKE
// host stands in for the machine, so every case runs on every platform; the
// real host is exercised by tests/e2e/task-windows-e2e.test.mjs on the
// Windows runner.
import assert from "node:assert/strict";
import { mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { test } from "node:test";

import { nodeWindowsTaskHost, requireWindowsPrerequisites } from "../../apps/vestra-cli/src/task/task-windows.ts";
import { WindowsNamedPipeBridgeTransport } from "../../packages/platform-node/src/index.ts";
import { FakePipeHost } from "../helpers/pipe-bridge-fixture.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

// invariant: a DETERMINISTIC FAKE of the machine. It records what the check
// asked of it and answers from `answers`.
function fakeHost(answers = {}) {
  const seen = { listened: 0, closed: 0, refusedConnections: 0, proofs: [], policyReads: 0 };
  const host = {
    bridgeTransport: () => ({
      listen: (accept) => {
        seen.listened += 1;
        if (answers.listen !== undefined) return Promise.reject(answers.listen);
        accept({ destroy: () => (seen.refusedConnections += 1) });
        const close = () => {
          seen.closed += 1;
          return Promise.resolve();
        };
        return Promise.resolve({ endpoint: "\\\\.\\pipe\\verchestra-fake", close });
      }
    }),
    ownerOnly: async (directory) => {
      seen.proofs.push({ directory, entries: await readdir(directory) });
      if (answers.ownerOnly instanceof Error) throw answers.ownerOnly;
      return answers.ownerOnly ?? true;
    },
    managedPolicyPresent: () => {
      seen.policyReads += 1;
      return Promise.resolve(answers.policy ?? false);
    }
  };
  return { host, seen };
}

async function sessionsRoot(t) {
  return join(await temporaryDirectory(t, "verchestra-task-windows-"), "sessions");
}

function notConfigured(requirement) {
  return (error) => {
    assert.equal(error.code, "VES_TASK_NOT_CONFIGURED");
    assert.deepEqual(error.envelope.safeDetails, { requirement });
    return true;
  };
}

function refusal(code, requirement) {
  return Object.assign(new Error("refused"), { code, requirement });
}

test("off Windows, or without a Claude Code session, nothing is asked of the machine", async (t) => {
  const root = await sessionsRoot(t);
  for (const [platform, claude] of [
    ["darwin", "subscription"],
    ["linux", "api-key"],
    ["freebsd", "subscription"],
    ["win32", "none"]
  ]) {
    const { host, seen } = fakeHost({ policy: true, ownerOnly: false });
    await requireWindowsPrerequisites({ platform, sessionsRoot: root, claude, host });
    assert.deepEqual(seen, { listened: 0, closed: 0, refusedConnections: 0, proofs: [], policyReads: 0 }, platform);
  }
  await assert.rejects(readdir(root), { code: "ENOENT" }, "the sessions root is not created");
});

test("a Windows machine with every prerequisite passes, and the probe channel and directory are gone", async (t) => {
  const root = await sessionsRoot(t);
  const { host, seen } = fakeHost();
  await requireWindowsPrerequisites({ platform: "win32", sessionsRoot: root, claude: "subscription", host });
  assert.equal(seen.listened, 1);
  assert.equal(seen.closed, 1, "the probe channel is closed");
  assert.equal(seen.refusedConnections, 1, "a connection to the probe channel is refused");
  assert.equal(seen.proofs.length, 1);
  assert.equal(dirname(seen.proofs[0].directory), root);
  assert.match(basename(seen.proofs[0].directory), /^acl-probe-/u);
  assert.deepEqual(seen.proofs[0].entries, [], "the proof is taken on an empty directory");
  assert.equal(seen.policyReads, 1);
  assert.deepEqual(await readdir(root), [], "the probe directory is removed");
});

for (const requirement of ["powershell-7", "powershell-logging-off", "owner-only-acl"])
  test(`a transport that names ${requirement} makes the run not configured with that prerequisite`, async (t) => {
    const root = await sessionsRoot(t);
    const { host, seen } = fakeHost({ listen: refusal("VES_BRIDGE_NOT_CONFIGURED", requirement) });
    await assert.rejects(
      requireWindowsPrerequisites({ platform: "win32", sessionsRoot: root, claude: "api-key", host }),
      notConfigured(requirement)
    );
    assert.deepEqual(seen.proofs, [], "nothing after the refusal is asked");
    assert.equal(seen.policyReads, 0);
    await assert.rejects(readdir(root), { code: "ENOENT" });
  });

test("a transport refusal that names no prerequisite is reported as the transport's own", async (t) => {
  const root = await sessionsRoot(t);
  for (const error of [
    refusal("VES_BRIDGE_CHANNEL_INSECURE", undefined),
    refusal("VES_BRIDGE_CHANNEL_FAILED", "powershell-7"),
    refusal("VES_BRIDGE_NOT_CONFIGURED", "PowerShell 7\nmissing"),
    refusal("VES_BRIDGE_NOT_CONFIGURED", 7)
  ]) {
    const { host } = fakeHost({ listen: error });
    await assert.rejects(
      requireWindowsPrerequisites({ platform: "win32", sessionsRoot: root, claude: "api-key", host }),
      (thrown) => thrown === error
    );
  }
});

for (const [name, ownerOnly] of [
  ["cannot be proven", false],
  ["fails to run", new Error("icacls did not succeed")]
])
  test(`a sessions directory whose owner-only ACL ${name} makes the run not configured`, async (t) => {
    const root = await sessionsRoot(t);
    const { host, seen } = fakeHost({ ownerOnly });
    await assert.rejects(
      requireWindowsPrerequisites({ platform: "win32", sessionsRoot: root, claude: "subscription", host }),
      notConfigured("owner-only-acl")
    );
    assert.equal(seen.closed, 1, "the probe channel was closed first");
    assert.equal(seen.policyReads, 0);
    assert.deepEqual(await readdir(root), [], "the probe directory is removed");
  });

// invariant: SSI-73 is unconditional: a managed policy refuses either mediated
// profile, and a machine without one lets either through.
test("a managed Claude Code policy refuses the subscription and the API-key profile alike", async (t) => {
  const root = await sessionsRoot(t);
  for (const claude of ["subscription", "api-key"]) {
    const managed = fakeHost({ policy: true });
    await assert.rejects(
      requireWindowsPrerequisites({ platform: "win32", sessionsRoot: root, claude, host: managed.host }),
      notConfigured("claude-managed-policy"),
      claude
    );
    assert.equal(managed.seen.policyReads, 1, claude);
    const unmanaged = fakeHost({ policy: false });
    await requireWindowsPrerequisites({ platform: "win32", sessionsRoot: root, claude, host: unmanaged.host });
    assert.equal(unmanaged.seen.policyReads, 1, `${claude} never read the policy sources`);
  }
  assert.deepEqual(await readdir(root), [], "a probe directory was left");
});

// why: the named-pipe transport's own refusals, through the real transport over
// a fake helper host, reach the run as the prerequisite each names.
for (const [requirement, configure] of [
  ["powershell-7", (pipeHost) => (pipeHost.installed = false)],
  ["powershell-7", (pipeHost) => (pipeHost.behaviour = (helper) => helper.status("verchestra-pipe:error:version"))],
  [
    "powershell-logging-off",
    (pipeHost) => (pipeHost.behaviour = (helper) => helper.status("verchestra-credential:error:logging"))
  ],
  ["owner-only-acl", (pipeHost) => (pipeHost.proof = Object.freeze({ proven: false, step: "verify" }))]
])
  test(`the named-pipe transport's ${requirement} refusal reaches the run named, and its directory is gone`, async (t) => {
    const root = await temporaryDirectory(t, "verchestra-task-windows-pipe-");
    const channels = join(root, "channels");
    await mkdir(channels);
    const pipeHost = new FakePipeHost();
    configure(pipeHost);
    const { host, seen } = fakeHost();
    const windowsHost = {
      ...host,
      bridgeTransport: () => new WindowsNamedPipeBridgeTransport({ root: channels, host: pipeHost })
    };
    await assert.rejects(
      requireWindowsPrerequisites({
        platform: "win32",
        sessionsRoot: join(root, "sessions"),
        claude: "subscription",
        host: windowsHost
      }),
      notConfigured(requirement)
    );
    assert.deepEqual(await readdir(channels), [], "the per-run pipe directory is removed");
    assert.deepEqual(seen.proofs, []);
  });

test("the named-pipe transport's probe channel is opened and closed, ending its helper", async (t) => {
  const root = await temporaryDirectory(t, "verchestra-task-windows-pipe-");
  const channels = join(root, "channels");
  await mkdir(channels);
  const pipeHost = new FakePipeHost();
  const { host, seen } = fakeHost();
  await requireWindowsPrerequisites({
    platform: "win32",
    sessionsRoot: join(root, "sessions"),
    claude: "api-key",
    host: { ...host, bridgeTransport: () => new WindowsNamedPipeBridgeTransport({ root: channels, host: pipeHost }) }
  });
  assert.equal(pipeHost.started.length, 1, "one helper was started");
  assert.deepEqual(pipeHost.terminated, [4242], "and it was ended");
  assert.deepEqual(await readdir(channels), [], "its directory is removed");
  assert.equal(seen.proofs.length, 1);
});

// why: the real ACL tools exist only on Windows, so elsewhere the node host
// can prove nothing and the same call must answer false.
test("the node host hands the check the named-pipe transport and the real ACL proof", async (t) => {
  assert.ok(nodeWindowsTaskHost.bridgeTransport() instanceof WindowsNamedPipeBridgeTransport);
  const directory = await temporaryDirectory(t, "verchestra-task-windows-acl-");
  assert.equal(await nodeWindowsTaskHost.ownerOnly(directory), process.platform === "win32");
  assert.deepEqual(await readdir(directory), [], "the proof leaves nothing in the directory");
});
