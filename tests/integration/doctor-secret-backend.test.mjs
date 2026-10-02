// invariant: #379 closes the secret-presence half of L2. With a Workspace and
// the implementer credential of its mode bound in a qualified credential
// store, deep doctor's secret-presence check passes; unbound, it stays
// blocked; a store that cannot answer is a failure, never a pass. The mode is
// the machine-local setting: `claude-code-oauth-token` by default, and
// `anthropic-api-key` when the Workspace selects API keys. The store is the
// darwin backend over a fake `security` runner, so this runs identically on
// every platform.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { composeDoctorSecretProbe } from "../../apps/vestra-cli/src/secret-composition.ts";
import {
  CredentialToolUnavailableError,
  createOsCredentialStore,
  resolveStateRoot,
  resolveWorkspaceState
} from "../../packages/platform-node/src/index.ts";
import { buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import { fakePowerShellRunner, fakeSecretToolRunner } from "../helpers/fake-credential-tool-runners.mjs";
import { fakeSecurityRunner } from "../helpers/fake-security-runner.mjs";

const workspaceId = "workspace_9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
// why: a simulated platform resolves its state root with that platform's path
// rules, so its home is a path every rule set calls absolute and that does
// not exist. No setting file is found there, which is the default mode.
const DEFAULT_MODE_HOME = "/verchestra-doctor-fixture/home";
const DEFAULT_CREDENTIAL = "claude-code-oauth-token";
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function initializedRoot() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-secret-"));
  roots.push(root);
  const files = buildCanonicalInitFiles({
    workspaceId,
    displayName: "Doctor secret fixture",
    placementMode: "colocated",
    generatorVersion: "0.0.0-qualification"
  });
  await mkdir(join(root, ".verchestra"), { recursive: true });
  await writeFile(join(root, ".verchestra", "workspace.yaml"), files[".verchestra/workspace.yaml"]);
  return root;
}

async function secretPresence(root, runner) {
  const live = await composeDoctorSecretProbe({
    controlRoot: root,
    platform: "darwin",
    runner,
    env: {},
    homeDirectory: DEFAULT_MODE_HOME
  });
  const run = await runDoctorDeep({ controlRoot: root, live });
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.secret-presence:"));
}

test("a bound credential makes secret-presence pass", async () => {
  const root = await initializedRoot();
  const fake = fakeSecurityRunner();
  await createOsCredentialStore({ platform: "darwin", runner: fake.runner }).store(
    workspaceId,
    DEFAULT_CREDENTIAL,
    new TextEncoder().encode("sk-ant-doctor-fixture")
  );
  assert.equal(await secretPresence(root, fake.runner), "doctor.secret-presence:pass");
  const lookups = fake.invocations.slice(-1)[0];
  assert.deepEqual(lookups.args, [
    "find-generic-password",
    "-s",
    `verchestra/${workspaceId}`,
    "-a",
    DEFAULT_CREDENTIAL
  ]);
});

test("an unbound credential leaves secret-presence blocked", async () => {
  const root = await initializedRoot();
  assert.equal(await secretPresence(root, fakeSecurityRunner().runner), "doctor.secret-presence:blocked");
});

test("a credential bound to another Workspace does not count", async () => {
  const root = await initializedRoot();
  const fake = fakeSecurityRunner();
  await createOsCredentialStore({ platform: "darwin", runner: fake.runner }).store(
    "workspace_1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    DEFAULT_CREDENTIAL,
    new TextEncoder().encode("sk-ant-elsewhere")
  );
  assert.equal(await secretPresence(root, fake.runner), "doctor.secret-presence:blocked");
});

test("a store that cannot answer is a failure, never a pass", async () => {
  const root = await initializedRoot();
  const timedOut = async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" });
  assert.equal(await secretPresence(root, timedOut), "doctor.secret-presence:fail");
  const broken = async () => ({ exitCode: 1, stdout: "", stderr: "" });
  assert.equal(await secretPresence(root, broken), "doctor.secret-presence:fail");
});

test("the doctor never asks the store for the value", async () => {
  const root = await initializedRoot();
  const fake = fakeSecurityRunner();
  await secretPresence(root, fake.runner);
  assert.ok(fake.invocations.length > 0);
  for (const invocation of fake.invocations) {
    assert.equal(invocation.args[0], "find-generic-password");
    assert.equal(invocation.args.includes("-g") || invocation.args.includes("-w"), false);
  }
});

// invariant: the same mapping holds on the Linux Secret Service and Windows
// Credential Manager stores (AD-041), and a store that is not running in the
// session is "not configured", so it blocks rather than fails.
for (const [platform, makeFake] of [
  ["linux", fakeSecretToolRunner],
  ["win32", fakePowerShellRunner]
]) {
  async function presenceOn(root, runner) {
    const live = await composeDoctorSecretProbe({
      controlRoot: root,
      platform,
      runner,
      env: {},
      homeDirectory: DEFAULT_MODE_HOME
    });
    const run = await runDoctorDeep({ controlRoot: root, live });
    return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.secret-presence:"));
  }

  test(`${platform}: bound passes, unbound or another Workspace's blocks`, async () => {
    const root = await initializedRoot();
    const fake = makeFake();
    assert.equal(await presenceOn(root, fake.runner), "doctor.secret-presence:blocked");
    const store = createOsCredentialStore({ platform, runner: fake.runner });
    await store.store(
      "workspace_1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      DEFAULT_CREDENTIAL,
      new TextEncoder().encode("sk-ant-x")
    );
    assert.equal(await presenceOn(root, fake.runner), "doctor.secret-presence:blocked");
    await store.store(workspaceId, DEFAULT_CREDENTIAL, new TextEncoder().encode("sk-ant-doctor-fixture"));
    assert.equal(await presenceOn(root, fake.runner), "doctor.secret-presence:pass");
  });

  test(`${platform}: a store not running in this session blocks, and one that cannot answer fails`, async () => {
    const root = await initializedRoot();
    const unavailable = async () => {
      throw new CredentialToolUnavailableError();
    };
    assert.equal(await presenceOn(root, unavailable), "doctor.secret-presence:blocked");
    const timedOut = async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" });
    assert.equal(await presenceOn(root, timedOut), "doctor.secret-presence:fail");
    const broken = async () => ({ exitCode: 3, stdout: "", stderr: "" });
    assert.equal(await presenceOn(root, broken), "doctor.secret-presence:fail");
  });

  test(`${platform}: the doctor never asks the store for the value`, async () => {
    const root = await initializedRoot();
    const fake = makeFake();
    await createOsCredentialStore({ platform, runner: fake.runner }).store(
      workspaceId,
      DEFAULT_CREDENTIAL,
      new TextEncoder().encode("sk-ant-doctor-fixture")
    );
    fake.invocations.length = 0;
    assert.equal(await presenceOn(root, fake.runner), "doctor.secret-presence:pass");
    assert.ok(fake.invocations.length > 0);
    for (const invocation of fake.invocations) {
      if (platform === "linux") assert.equal(invocation.tool, "dbus-send");
      else assert.equal(invocation.tool, "cmdkey");
    }
  });
}

// invariant: the doctor observes the credential the Workspace's mode names
// (SPA-15). This case writes the machine-local setting, so it runs with the
// host's own platform and the matching fake store.
const HOST_FAKES = { darwin: fakeSecurityRunner, linux: fakeSecretToolRunner, win32: fakePowerShellRunner };

async function hostFixture() {
  const root = await initializedRoot();
  const home = join(root, "home");
  const location = { platform: process.platform, env: {}, homeDirectory: home };
  const { workspaceRoot } = resolveWorkspaceState({
    stateRoot: resolveStateRoot(location),
    workspaceId,
    platform: process.platform
  });
  await mkdir(workspaceRoot, { recursive: true });
  const fake = HOST_FAKES[process.platform]();
  const store = createOsCredentialStore({ platform: process.platform, runner: fake.runner });
  const presence = async () => {
    const live = await composeDoctorSecretProbe({ controlRoot: root, runner: fake.runner, ...location });
    const run = await runDoctorDeep({ controlRoot: root, live });
    return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.secret-presence:"));
  };
  const bind = (name) => store.store(workspaceId, name, new TextEncoder().encode("fixture-credential-value"));
  const setting = (text) => writeFile(join(workspaceRoot, "task-providers.json"), text);
  return { presence, bind, setting };
}

test("a Workspace set to API keys is checked for the API key, never the subscription token", async (t) => {
  if (HOST_FAKES[process.platform] === undefined) return t.diagnostic("no qualified credential store on this host");
  const { presence, bind, setting } = await hostFixture();
  await setting(JSON.stringify({ schemaVersion: 1, providers: { "claude-code": { auth: "api-key" } } }));
  await bind(DEFAULT_CREDENTIAL);
  assert.equal(await presence(), "doctor.secret-presence:blocked");
  await bind("anthropic-api-key");
  assert.equal(await presence(), "doctor.secret-presence:pass");
});

test("a Workspace on a subscription is not satisfied by an API key", async (t) => {
  if (HOST_FAKES[process.platform] === undefined) return t.diagnostic("no qualified credential store on this host");
  const { presence, bind, setting } = await hostFixture();
  await bind("anthropic-api-key");
  assert.equal(await presence(), "doctor.secret-presence:blocked");
  await setting(JSON.stringify({ schemaVersion: 1, providers: { codex: { auth: "api-key" } } }));
  assert.equal(await presence(), "doctor.secret-presence:blocked");
  await bind(DEFAULT_CREDENTIAL);
  assert.equal(await presence(), "doctor.secret-presence:pass");
});

test("a provider setting that cannot be read names no credential, so the check stays blocked", async (t) => {
  if (HOST_FAKES[process.platform] === undefined) return t.diagnostic("no qualified credential store on this host");
  const { presence, bind, setting } = await hostFixture();
  await bind(DEFAULT_CREDENTIAL);
  await bind("anthropic-api-key");
  for (const text of [
    "{not json",
    JSON.stringify({ schemaVersion: 1, providers: { "claude-code": { auth: "free" } } })
  ]) {
    await setting(text);
    assert.equal(await presence(), "doctor.secret-presence:blocked");
  }
});
