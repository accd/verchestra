// invariant: #379's credential-handling controls on the Linux Secret Service
// and Windows Credential Manager backends (AD-041), proven without a real
// store: the value never crosses argv, the child environment, an error, or
// command output; presence never receives it; items are bound to their
// Workspace; and a store that is not running reads as not configured.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  CredentialToolUnavailableError,
  LinuxSecretServiceBackend,
  WindowsCredentialManagerBackend,
  powershellChildEnvironment,
  secretToolChildEnvironment
} from "../../packages/platform-node/src/index.ts";
import { buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import {
  DOCTOR_CREDENTIAL_NAME,
  composeDoctorSecretProbe,
  executeSecretCommand
} from "../../apps/vestra-cli/src/secret-composition.ts";
import { fakePowerShellRunner, fakeSecretToolRunner } from "../helpers/fake-credential-tool-runners.mjs";

const SENTINEL = "sk-ant-sentinel-CROSS-4b7d";
const ENCODINGS = [SENTINEL, Buffer.from(SENTINEL).toString("hex"), Buffer.from(SENTINEL).toString("base64")];
const workspaceA = "workspace_0b0e8d4c-6a1e-4f7a-9d55-3e3c6f0c1a2b";
const workspaceB = "workspace_7f1c2e3d-4b5a-4c6d-8e7f-901a2b3c4d5e";
const scratch = await mkdtemp(join(tmpdir(), "verchestra-cross-secret-"));
after(() => rm(scratch, { recursive: true, force: true }));

const PLATFORMS = Object.freeze({
  linux: { fake: fakeSecretToolRunner, store: "secret-service-credential" },
  win32: { fake: fakePowerShellRunner, store: "windows-credential-manager" }
});

async function workspaceRoot(workspaceId) {
  const root = await mkdtemp(join(scratch, "ws-"));
  const files = buildCanonicalInitFiles({
    workspaceId,
    displayName: "Cross-platform security fixture",
    placementMode: "colocated",
    generatorVersion: "0.0.0-qualification"
  });
  await mkdir(join(root, ".verchestra"), { recursive: true });
  await writeFile(join(root, ".verchestra", "workspace.yaml"), files[".verchestra/workspace.yaml"]);
  return root;
}

function pipedInput(text) {
  const listeners = new Map();
  return {
    isTTY: false,
    on(event, listener) {
      listeners.set(event, listener);
    },
    removeAllListeners() {
      listeners.clear();
    },
    pause() {},
    resume() {
      queueMicrotask(() => {
        if (text.length > 0) listeners.get("data")?.(Buffer.from(text));
        listeners.get("end")?.();
      });
    }
  };
}

async function runSecret(platform, name, { root, input = "", fake, options = { name: "anthropic-api-key" } }) {
  const stderr = [];
  try {
    const result = await executeSecretCommand(
      { name, options },
      { controlRoot: root, platform, stdin: pipedInput(input), stderr: (v) => stderr.push(v), runner: fake.runner }
    );
    return { result, stderr: stderr.join("") };
  } catch (error) {
    return { error, stderr: stderr.join("") };
  }
}

function assertNoValue(text, label) {
  for (const encoded of ENCODINGS) assert.equal(text.includes(encoded), false, `${label} carries the value`);
}

for (const [platform, { fake: makeFake, store }] of Object.entries(PLATFORMS)) {
  test(`${platform}: the value reaches the child only on stdin, never argv, output, or stderr`, async () => {
    const root = await workspaceRoot(workspaceA);
    const fake = makeFake();
    const { result, stderr } = await runSecret(platform, "secret set", { root, input: `${SENTINEL}\n`, fake });
    assert.equal(result.data.stored, true);
    assert.equal(result.data.store, store);
    for (const invocation of fake.invocations) assertNoValue(invocation.args.join(" "), "argv");
    const carriers = fake.invocations.filter((invocation) =>
      ENCODINGS.some((encoded) => invocation.stdin?.includes(encoded))
    );
    assert.equal(carriers.length, 1, "exactly one invocation carries the value, on stdin");
    assertNoValue(JSON.stringify(result.data), "command output");
    assertNoValue(stderr, "stderr");
  });

  test(`${platform}: status and doctor presence never receive the value`, async () => {
    const root = await workspaceRoot(workspaceA);
    const fake = makeFake();
    await runSecret(platform, "secret set", { root, input: SENTINEL, fake });
    const seen = [];
    const watching = async (invocation) => {
      const answer = await fake.runner(invocation);
      seen.push({ invocation, answer });
      return answer;
    };
    const status = await runSecret(platform, "secret status", { root, fake: { runner: watching } });
    assert.equal(status.result.data.present, true);
    const probe = await composeDoctorSecretProbe({ controlRoot: root, platform, runner: watching });
    assert.equal(await probe.secret.adapter.has(workspaceA, DOCTOR_CREDENTIAL_NAME), true);
    assert.ok(seen.length >= 2);
    for (const { invocation, answer } of seen) {
      assertNoValue(`${answer.stdout}${answer.stderr}`, "presence output");
      assert.equal(
        invocation.tool,
        platform === "linux" ? "dbus-send" : "cmdkey",
        "presence is an attribute-only query"
      );
    }
  });

  test(`${platform}: a credential is bound to its Workspace namespace and invisible to another`, async () => {
    const fake = makeFake();
    const rootA = await workspaceRoot(workspaceA);
    const rootB = await workspaceRoot(workspaceB);
    await runSecret(platform, "secret set", { root: rootA, input: SENTINEL, fake });
    const inA = await runSecret(platform, "secret status", { root: rootA, fake });
    const inB = await runSecret(platform, "secret status", { root: rootB, fake });
    assert.equal(inA.result.data.present, true);
    assert.equal(inB.result.data.present, false);
    assert.equal((await runSecret(platform, "secret delete", { root: rootB, fake })).result.data.deleted, false);
    assert.equal(inA.result.data.present, true);
    const write = fake.invocations.find((invocation) =>
      platform === "linux" ? invocation.args[0] === "store" : invocation.stdin.includes("::Write(")
    );
    const binding = platform === "linux" ? write.args.join(" ") : write.stdin;
    assert.ok(binding.includes(`verchestra/${workspaceA}`), "the item names its owning Workspace");
  });

  test(`${platform}: a keychain path is refused before any process runs`, async () => {
    const root = await workspaceRoot(workspaceA);
    const fake = makeFake();
    for (const command of ["secret set", "secret status", "secret delete"]) {
      const { error } = await runSecret(platform, command, {
        root,
        input: SENTINEL,
        fake,
        options: { name: "anthropic-api-key", keychain: join(root, "a.keychain-db") }
      });
      assert.equal(error.envelope.code, "VES_SECRET_KEYCHAIN_INVALID", command);
    }
    assert.equal(fake.invocations.length, 0);
  });

  test(`${platform}: an invalid value is refused before any process runs`, async () => {
    const root = await workspaceRoot(workspaceA);
    const fake = makeFake();
    for (const input of ["", "\n", "two words\n", `${SENTINEL}${"A".repeat(4096)}`]) {
      const { error, stderr } = await runSecret(platform, "secret set", { root, input, fake });
      assert.equal(error.envelope.code, "VES_SECRET_VALUE_INVALID", JSON.stringify(input.slice(0, 12)));
      assertNoValue(stderr, "stderr");
      assertNoValue(JSON.stringify(error.envelope), "error envelope");
    }
    assert.equal(fake.invocations.length, 0);
  });

  test(`${platform}: a store that is not running is not configured, for commands and for doctor`, async () => {
    const root = await workspaceRoot(workspaceA);
    // why: on Linux, no session bus; on Windows, no PowerShell or cmdkey to
    // start. The PowerShell program's own no-logon-session answer (1312) is
    // covered by the backend unit tests.
    const unavailable = {
      runner: async () => {
        if (platform === "win32") throw new CredentialToolUnavailableError();
        return { exitCode: 1, stdout: "", stderr: "secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n" };
      }
    };
    for (const command of ["secret set", "secret status", "secret delete"]) {
      const { error } = await runSecret(platform, command, { root, input: SENTINEL, fake: unavailable });
      assert.equal(error.envelope.code, "VES_SECRET_STORE_UNAVAILABLE", command);
    }
    const probe = await composeDoctorSecretProbe({ controlRoot: root, platform, runner: unavailable.runner });
    assert.equal(await probe.secret.adapter.has(workspaceA, DOCTOR_CREDENTIAL_NAME), false);
    const locked = {
      runner: async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" })
    };
    const stuck = await composeDoctorSecretProbe({ controlRoot: root, platform, runner: locked.runner });
    // why: a Secret Service child can be waiting on an unlock prompt; a
    // Credential Manager call never prompts, so its timeout is a failure.
    await assert.rejects(stuck.secret.adapter.has(workspaceA, DOCTOR_CREDENTIAL_NAME), {
      code: platform === "linux" ? "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" : "VES_SECRET_BACKEND_FAILURE"
    });
  });
}

test("backend errors never carry the child's output, which may hold the value", async () => {
  const locator = { namespace: `verchestra/${workspaceA}`, logicalName: "anthropic-api-key" };
  const leaky = async () => ({
    exitCode: 1,
    stdout: SENTINEL,
    stderr: `secret-tool: failed on ${ENCODINGS.join(" ")}`
  });
  const leakyPowerShell = async (invocation) => ({
    exitCode: invocation.tool === "cmdkey" ? 1 : 0,
    stdout: `verchestra-credential:error:5\r\n${SENTINEL}`,
    stderr: ENCODINGS.join(" ")
  });
  for (const backend of [
    new LinuxSecretServiceBackend({ runner: leaky }),
    new WindowsCredentialManagerBackend({ runner: leakyPowerShell })
  ]) {
    for (const operation of [
      () => backend.has(locator),
      () => backend.read(locator),
      () => backend.delete(locator),
      () => backend.store(locator, new TextEncoder().encode(SENTINEL))
    ]) {
      await assert.rejects(operation(), (error) => {
        assertNoValue(`${error.message} ${JSON.stringify(error)} ${String(error.stack)}`, "error");
        return true;
      });
    }
  }
});

test("neither child environment carries an ambient credential", () => {
  const prior = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  process.env.ANTHROPIC_API_KEY = SENTINEL;
  process.env.OPENAI_API_KEY = SENTINEL;
  try {
    for (const environment of [secretToolChildEnvironment(), powershellChildEnvironment()]) {
      assertNoValue(JSON.stringify(environment), "child environment");
      assert.equal(environment.ANTHROPIC_API_KEY, undefined);
      assert.equal(environment.OPENAI_API_KEY, undefined);
    }
  } finally {
    for (const [key, previous] of Object.entries(prior)) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});
