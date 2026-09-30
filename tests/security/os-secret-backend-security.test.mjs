// invariant: #379's credential-handling controls, proven without a real
// keychain — the value never crosses argv, the child environment, an error,
// or command output; items are bound to their Workspace; names are strict;
// and key material still requires non-exportable storage (AD-034).
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
  DarwinKeychainBackend,
  LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION,
  WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION,
  MAX_CREDENTIAL_VALUE_BYTES,
  OS_CREDENTIAL_CONTROLS,
  QualifiedOsCredentialAdapter,
  QualifiedOsSecretAdapter,
  createOsCredentialStore,
  securityChildEnvironment
} from "../../packages/platform-node/src/index.ts";
import { buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";
import {
  DOCTOR_CREDENTIAL_NAME,
  composeDoctorSecretProbe,
  executeSecretCommand
} from "../../apps/vestra-cli/src/secret-composition.ts";
import { fakeKeychainFile, fakeSecurityRunner } from "../helpers/fake-security-runner.mjs";

const SENTINEL = "sk-ant-sentinel-SECURITY-9f3c";
const SENTINEL_HEX = Buffer.from(SENTINEL).toString("hex");
const workspaceA = "workspace_0b0e8d4c-6a1e-4f7a-9d55-3e3c6f0c1a2b";
const workspaceB = "workspace_7f1c2e3d-4b5a-4c6d-8e7f-901a2b3c4d5e";
const scratch = await mkdtemp(join(tmpdir(), "verchestra-secret-security-"));
after(() => rm(scratch, { recursive: true, force: true }));

async function workspaceRoot(workspaceId) {
  const root = await mkdtemp(join(scratch, "ws-"));
  const files = buildCanonicalInitFiles({
    workspaceId,
    displayName: "Security fixture",
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

async function runSecret(name, options, { root, input = "", fake = fakeSecurityRunner() } = {}) {
  const stderr = [];
  const io = {
    controlRoot: root,
    platform: "darwin",
    stdin: pipedInput(input),
    stderr: (v) => stderr.push(v),
    runner: fake.runner
  };
  let result;
  let error;
  try {
    result = await executeSecretCommand({ name, options }, io);
  } catch (caught) {
    error = caught;
  }
  return { result, error, stderr: stderr.join(""), fake };
}

function assertNoValue(text, label) {
  assert.equal(text.includes(SENTINEL), false, `${label} carries the raw value`);
  assert.equal(text.toLowerCase().includes(SENTINEL_HEX), false, `${label} carries the hex-encoded value`);
}

test("the value never appears in any argv, and reaches the child only on stdin", async () => {
  const root = await workspaceRoot(workspaceA);
  const { result, fake, stderr } = await runSecret(
    "secret set",
    { name: "anthropic-api-key" },
    { root, input: `${SENTINEL}\n` }
  );
  assert.equal(result.data.stored, true);
  for (const invocation of fake.invocations) assertNoValue(invocation.args.join(" "), "argv");
  assert.equal(fake.invocations.filter((invocation) => invocation.stdin?.includes(SENTINEL_HEX)).length, 1);
  assertNoValue(JSON.stringify(result.data), "command output");
  assertNoValue(stderr, "stderr");
});

test("the child environment is an allowlist that never carries an ambient credential", () => {
  const prior = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  process.env.ANTHROPIC_API_KEY = SENTINEL;
  process.env.OPENAI_API_KEY = SENTINEL;
  try {
    const environment = securityChildEnvironment();
    assert.deepEqual(
      Object.keys(environment).filter((key) => !["PATH", "HOME", "USER", "LOGNAME"].includes(key)),
      []
    );
    assertNoValue(JSON.stringify(environment), "child environment");
    assert.equal(environment.PATH, "/usr/bin:/bin");
  } finally {
    for (const [key, previous] of Object.entries(prior)) {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
});

test("backend errors never carry the child's output, which may hold the value", async () => {
  const leaky = async () => ({
    exitCode: 1,
    stdout: `password: "${SENTINEL}"`,
    stderr: `unknown command "${SENTINEL_HEX}"`
  });
  const backend = new DarwinKeychainBackend({ runner: leaky });
  const locator = { namespace: `verchestra/${workspaceA}`, logicalName: "anthropic-api-key" };
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
});

test("an oversize value never reaches a process and never shows up on stderr", async () => {
  const root = await workspaceRoot(workspaceA);
  const oversize = `${SENTINEL}${"A".repeat(MAX_CREDENTIAL_VALUE_BYTES)}`;
  const { error, fake, stderr } = await runSecret(
    "secret set",
    { name: "anthropic-api-key" },
    { root, input: oversize }
  );
  assert.equal(error.envelope.code, "VES_SECRET_VALUE_INVALID");
  assert.equal(fake.invocations.filter((invocation) => invocation.args[0] === "-i").length, 0);
  assertNoValue(stderr, "stderr");
  assertNoValue(JSON.stringify(error.envelope), "error envelope");
});

test("an empty or whitespace-only value is refused before any write", async () => {
  const root = await workspaceRoot(workspaceA);
  for (const input of ["", "\n", "\r\n", " \n", "two words\n"]) {
    const { error, fake } = await runSecret("secret set", { name: "anthropic-api-key" }, { root, input });
    assert.equal(error.envelope.code, "VES_SECRET_VALUE_INVALID", JSON.stringify(input));
    assert.equal(fake.invocations.filter((invocation) => invocation.args[0] === "-i").length, 0);
  }
});

test("exactly one trailing newline is stripped from piped input", async () => {
  const root = await workspaceRoot(workspaceA);
  for (const suffix of ["", "\n", "\r\n"]) {
    const { fake } = await runSecret(
      "secret set",
      { name: "anthropic-api-key" },
      { root, input: `${SENTINEL}${suffix}` }
    );
    const write = fake.invocations.find((invocation) => invocation.args[0] === "-i");
    assert.match(write.stdin, new RegExp(` -X ${SENTINEL_HEX}\\n$`, "u"), JSON.stringify(suffix));
  }
});

test("secret set reports a rotation that deleted the old credential but could not store the new one", async () => {
  const root = await workspaceRoot(workspaceA);
  const fake = fakeSecurityRunner({
    override: (record) =>
      record.args[0] === "-i" && fake.items.size === 0 ? { exitCode: 1, stdout: "", stderr: "" } : undefined
  });
  fake.items.set(`default\u0000verchestra/${workspaceA}\u0000anthropic-api-key`, Buffer.from("sk-ant-old"));
  const { error, stderr } = await runSecret(
    "secret set",
    { name: "anthropic-api-key" },
    { root, input: SENTINEL, fake }
  );
  assert.equal(error.envelope.code, "VES_SECRET_ROTATION_INCOMPLETE");
  assert.match(error.envelope.recovery, /run vestra secret set again/u);
  assertNoValue(stderr, "stderr");
  const status = await runSecret("secret status", { name: "anthropic-api-key" }, { root, fake });
  assert.equal(status.result.data.present, false);
});

test("a keychain that needs interaction surfaces as a clear error, never a hang", async () => {
  const root = await workspaceRoot(workspaceA);
  const fake = fakeSecurityRunner({ override: () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" }) });
  for (const command of ["secret set", "secret status", "secret delete"]) {
    const { error } = await runSecret(command, { name: "anthropic-api-key" }, { root, input: SENTINEL, fake });
    assert.equal(error.envelope.code, "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED", command);
  }
});

test("with --keychain, every command and the doctor probe name that keychain in every invocation", async (t) => {
  const root = await workspaceRoot(workspaceA);
  const keychain = await fakeKeychainFile(await mkdtemp(join(scratch, "kc-")));
  if (process.platform === "win32") {
    // invariant: a keychain path is POSIX by construction; on win32 the same
    // fixture proves a native path is refused rather than exercised.
    t.diagnostic("win32: asserting a native keychain path is refused as non-canonical");
    assert.throws(() => createOsCredentialStore({ platform: "darwin", keychainPath: keychain }), {
      code: "VES_SECRET_KEYCHAIN_INVALID"
    });
    return;
  }
  const fake = fakeSecurityRunner();
  const options = { name: "anthropic-api-key", keychain };
  await runSecret("secret set", options, { root, input: SENTINEL, fake });
  await runSecret("secret set", options, { root, input: "sk-ant-rotated", fake });
  await runSecret("secret status", options, { root, fake });
  await runSecret("secret delete", options, { root, fake });
  const probe = await composeDoctorSecretProbe({
    controlRoot: root,
    platform: "darwin",
    keychainPath: keychain,
    runner: fake.runner
  });
  await probe.secret.adapter.has(workspaceA, DOCTOR_CREDENTIAL_NAME);
  const kinds = new Set(fake.invocations.map((invocation) => invocation.args[0]));
  assert.deepEqual([...kinds].sort(), ["-i", "delete-generic-password", "find-generic-password"]);
  for (const invocation of fake.invocations) {
    if (invocation.args[0] === "-i") assert.equal(invocation.stdin.endsWith(` ${keychain}\n`), true);
    else assert.equal(invocation.args.at(-1), keychain, invocation.args[0]);
  }
});

test("a credential is bound to its Workspace namespace and invisible to another Workspace", async () => {
  const fake = fakeSecurityRunner();
  const rootA = await workspaceRoot(workspaceA);
  const rootB = await workspaceRoot(workspaceB);
  await runSecret("secret set", { name: "anthropic-api-key" }, { root: rootA, input: SENTINEL, fake });
  const write = fake.invocations.find((invocation) => invocation.args[0] === "-i");
  assert.match(write.stdin, new RegExp(` -s verchestra/${workspaceA} `, "u"));
  const inA = await runSecret("secret status", { name: "anthropic-api-key" }, { root: rootA, fake });
  const inB = await runSecret("secret status", { name: "anthropic-api-key" }, { root: rootB, fake });
  assert.equal(inA.result.data.present, true);
  assert.equal(inB.result.data.present, false);
  assert.equal(inB.result.data.workspaceId, workspaceB);
});

test("logical names are validated against the strict binding pattern before any process runs", async () => {
  const root = await workspaceRoot(workspaceA);
  for (const name of ["", "UPPER", "../escape", "a b", "a/b", "-s", "x", "trailing-", `a${"b".repeat(128)}`]) {
    for (const command of ["secret set", "secret status", "secret delete"]) {
      const { error, fake } = await runSecret(command, { name }, { root, input: SENTINEL });
      assert.equal(error.envelope.code, "VES_CLI_ARGUMENT_INVALID", `${command} ${name}`);
      assert.equal(fake.invocations.length, 0);
    }
  }
  const missing = await runSecret("secret status", {}, { root });
  assert.equal(missing.error.envelope.code, "VES_CLI_ARGUMENT_INVALID");
});

test("a command outside an initialized Workspace is refused, not guessed", async () => {
  const root = await mkdtemp(join(scratch, "bare-"));
  const { error, fake } = await runSecret("secret status", { name: "anthropic-api-key" }, { root });
  assert.equal(error.envelope.code, "VES_INIT_WORKSPACE_MISSING");
  assert.equal(fake.invocations.length, 0);
});

test("a platform without a qualified store reports it as not configured", async () => {
  const root = await workspaceRoot(workspaceA);
  for (const platform of ["freebsd", "openbsd"]) {
    const fake = fakeSecurityRunner();
    let error;
    try {
      await executeSecretCommand(
        { name: "secret status", options: { name: "anthropic-api-key" } },
        { controlRoot: root, platform, stdin: pipedInput(""), stderr: () => undefined, runner: fake.runner }
      );
    } catch (caught) {
      error = caught;
    }
    assert.equal(error.envelope.code, "VES_SECRET_STORE_UNQUALIFIED");
    assert.equal(fake.invocations.length, 0);
  }
});

test("deep doctor receives a presence-only closure for the well-known credential", async () => {
  const root = await workspaceRoot(workspaceA);
  const fake = fakeSecurityRunner();
  const probe = await composeDoctorSecretProbe({ controlRoot: root, platform: "darwin", runner: fake.runner });
  assert.equal(probe.workspaceId, workspaceA);
  assert.equal(probe.secret.logicalName, DOCTOR_CREDENTIAL_NAME);
  assert.equal(DOCTOR_CREDENTIAL_NAME, "anthropic-api-key");
  assert.deepEqual(Object.keys(probe.secret.adapter), ["has"]);
  assert.equal(await probe.secret.adapter.has(workspaceA, DOCTOR_CREDENTIAL_NAME), false);
  assert.equal(
    fake.invocations.some((invocation) => invocation.args.includes("-g") || invocation.args.includes("-w")),
    false
  );
});

test("deep doctor's secret port stays unset without a Workspace or a qualified store", async () => {
  const bare = await mkdtemp(join(scratch, "bare-doctor-"));
  assert.deepEqual(await composeDoctorSecretProbe({ controlRoot: bare, platform: "darwin" }), {});
  const root = await workspaceRoot(workspaceA);
  assert.deepEqual(await composeDoctorSecretProbe({ controlRoot: root, platform: "freebsd" }), {});
});

test("key material still requires non-exportable storage; credential evidence cannot qualify it", () => {
  const backend = { has: async () => true, read: async () => undefined };
  assert.throws(
    () =>
      new QualifiedOsSecretAdapter({ platform: "darwin", evidence: DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION, backend }),
    { code: "VES_SECRET_STORE_UNQUALIFIED" }
  );
  for (const [platform, controls] of [
    ["darwin", ["keychain", "non-exportable", "user-scope", "access-control"]],
    ["win32", ["cng-ksp", "non-exportable", "user-scope", "access-control"]]
  ]) {
    const withoutNonExportable = controls.filter((control) => control !== "non-exportable");
    assert.throws(
      () =>
        new QualifiedOsSecretAdapter({
          platform,
          evidence: { digest: "a".repeat(64), controls: withoutNonExportable },
          backend
        }),
      { code: "VES_SECRET_STORE_UNQUALIFIED" },
      platform
    );
    assert.equal(
      new QualifiedOsSecretAdapter({ platform, evidence: { digest: "a".repeat(64), controls }, backend }).adapterId
        .length > 0,
      true
    );
  }
  for (const [platform, evidence] of [
    ["darwin", DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION],
    ["linux", LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION],
    ["win32", WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION]
  ]) {
    assert.equal(
      OS_CREDENTIAL_CONTROLS[platform].controls.includes("non-exportable"),
      false,
      `a readable ${platform} credential never claims it`
    );
    assert.equal(OS_CREDENTIAL_CONTROLS[platform].controls.includes("access-control"), false, platform);
    for (const keyPlatform of ["darwin", "linux", "win32"])
      assert.throws(() => new QualifiedOsSecretAdapter({ platform: keyPlatform, evidence, backend }), {
        code: "VES_SECRET_STORE_UNQUALIFIED"
      });
  }
});

test("each platform's credential contract needs its own evidence and every declared control", () => {
  const backend = { has: async () => true, read: async () => undefined };
  const byPlatform = {
    darwin: DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
    linux: LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION,
    win32: WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION
  };
  for (const [platform, evidence] of Object.entries(byPlatform)) {
    for (const [other, foreign] of Object.entries(byPlatform)) {
      if (other === platform) continue;
      assert.throws(
        () => new QualifiedOsCredentialAdapter({ platform, evidence: foreign, backend }),
        { code: "VES_SECRET_STORE_UNQUALIFIED" },
        `${other} evidence must not qualify ${platform}`
      );
    }
    for (const dropped of evidence.controls) {
      assert.throws(
        () =>
          new QualifiedOsCredentialAdapter({
            platform,
            evidence: { digest: evidence.digest, controls: evidence.controls.filter((control) => control !== dropped) },
            backend
          }),
        { code: "VES_SECRET_STORE_UNQUALIFIED" },
        `${platform} without ${dropped}`
      );
    }
    assert.equal(
      new QualifiedOsCredentialAdapter({ platform, evidence, backend }).adapterId,
      OS_CREDENTIAL_CONTROLS[platform].adapterId
    );
  }
  for (const platform of ["freebsd", "openbsd", "sunos"])
    assert.throws(
      () => new QualifiedOsCredentialAdapter({ platform, evidence: DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION, backend }),
      { code: "VES_SECRET_STORE_UNQUALIFIED" }
    );
  assert.equal(
    createOsCredentialStore({ platform: "darwin", runner: fakeSecurityRunner().runner }).storeId,
    "apple-keychain-credential"
  );
});

test("each credential evidence digest is the SHA-256 of its committed qualification report", async () => {
  for (const evidence of [
    DARWIN_KEYCHAIN_CREDENTIAL_QUALIFICATION,
    LINUX_SECRET_SERVICE_CREDENTIAL_QUALIFICATION,
    WINDOWS_CREDENTIAL_MANAGER_QUALIFICATION
  ]) {
    const report = await readFile(new URL(`../../${evidence.report}`, import.meta.url));
    assert.equal(evidence.digest, createHash("sha256").update(report).digest("hex"), evidence.report);
    const text = report.toString("utf8");
    for (const control of evidence.controls) assert.match(text, new RegExp(`\`${control}\``, "u"), control);
    assert.doesNotMatch(text, /[A-Za-z]:\\Users|\/(?:Users|home)\/[^/\s]+/u, "no machine-local path");
  }
});
