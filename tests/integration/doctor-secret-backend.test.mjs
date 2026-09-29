// invariant: #379 closes the secret-presence half of L2. With a Workspace and a
// bound `anthropic-api-key` in a qualified credential store, deep doctor's
// secret-presence check passes; unbound, it stays blocked; a store that cannot
// answer is a failure, never a pass. The store is the darwin backend over a
// fake `security` runner, so this runs identically on every platform.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { composeDoctorSecretProbe } from "../../apps/vestra-cli/src/secret-composition.ts";
import { createOsCredentialStore } from "../../packages/platform-node/src/index.ts";
import { buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import { fakeSecurityRunner } from "../helpers/fake-security-runner.mjs";

const workspaceId = "workspace_9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
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
  const live = await composeDoctorSecretProbe({ controlRoot: root, platform: "darwin", runner });
  const run = await runDoctorDeep({ controlRoot: root, live });
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.secret-presence:"));
}

test("a bound credential makes secret-presence pass", async () => {
  const root = await initializedRoot();
  const fake = fakeSecurityRunner();
  await createOsCredentialStore({ platform: "darwin", runner: fake.runner }).store(
    workspaceId,
    "anthropic-api-key",
    new TextEncoder().encode("sk-ant-doctor-fixture")
  );
  assert.equal(await secretPresence(root, fake.runner), "doctor.secret-presence:pass");
  const lookups = fake.invocations.slice(-1)[0];
  assert.deepEqual(lookups.args, [
    "find-generic-password",
    "-s",
    `verchestra/${workspaceId}`,
    "-a",
    "anthropic-api-key"
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
    "anthropic-api-key",
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
