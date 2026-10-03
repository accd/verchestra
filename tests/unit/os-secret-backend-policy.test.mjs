// invariant: #379, the policy every OS credential backend shares
// (credential-tool.ts): the presence budget, the value policy, the locator
// check, and the refusal that opens every write. Each case runs against all
// three backends through their fake runners, so a backend cannot drift from
// the others. Platform-independent: nothing here spawns a process.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DarwinKeychainBackend,
  KEYCHAIN_VALUE_BUDGET_BYTES,
  LinuxSecretServiceBackend,
  MAX_CREDENTIAL_VALUE_BYTES,
  PRESENCE_TIMEOUT_MS,
  WindowsCredentialManagerBackend,
  isValidCredentialValue
} from "../../packages/platform-node/src/index.ts";
import { DOCTOR_PROBE_TIMEOUT_MS } from "../../packages/application/src/index.ts";
import { fakePowerShellRunner, fakeSecretToolRunner } from "../helpers/fake-credential-tool-runners.mjs";
import { fakeSecurityRunner } from "../helpers/fake-security-runner.mjs";

const workspaceId = "workspace_0b0e8d4c-6a1e-4f7a-9d55-3e3c6f0c1a2b";
const locator = Object.freeze({ namespace: `verchestra/${workspaceId}`, logicalName: "anthropic-api-key" });
const value = () => new TextEncoder().encode("sk-ant-unit-value-123");
const silent = Object.freeze({ exitCode: 0, stdout: "", stderr: "" });

// why: `isWrite` picks out the one invocation that carries the value, and
// `accepted` is what that platform's tool answers when it reports success, so
// a case can make a write succeed without storing anything.
const PLATFORMS = Object.freeze({
  darwin: {
    Backend: DarwinKeychainBackend,
    fake: fakeSecurityRunner,
    isWrite: (record) => record.args[0] === "-i",
    accepted: silent
  },
  linux: {
    Backend: LinuxSecretServiceBackend,
    fake: fakeSecretToolRunner,
    isWrite: (record) => record.args[0] === "store",
    accepted: silent
  },
  win32: {
    Backend: WindowsCredentialManagerBackend,
    fake: fakePowerShellRunner,
    isWrite: (record) => record.stdin.includes("::Write("),
    accepted: { ...silent, stdout: "verchestra-credential:stored\r\n" }
  }
});

// why: the union of what each backend's own suite refused, so every platform
// now refuses the shapes that would break another platform's command line (a
// space and `-X` for `security`, a comma for `dbus-send`, a quote for
// PowerShell).
const NON_CANONICAL_LOCATORS = Object.freeze([
  { namespace: "verchestra/other", logicalName: "anthropic-api-key" },
  { namespace: "verchestra/not-a-workspace", logicalName: "anthropic-api-key" },
  { namespace: `elsewhere/${workspaceId}`, logicalName: "anthropic-api-key" },
  { namespace: `other/${workspaceId}`, logicalName: "anthropic-api-key" },
  { namespace: `verchestra/${workspaceId} -X 41`, logicalName: "anthropic-api-key" },
  { namespace: `verchestra/${workspaceId}'`, logicalName: "anthropic-api-key" },
  { namespace: locator.namespace, logicalName: "a b" },
  { namespace: locator.namespace, logicalName: "../x" },
  { namespace: locator.namespace, logicalName: "UPPER" },
  { namespace: locator.namespace, logicalName: "a,b" },
  { namespace: locator.namespace, logicalName: "a'b" }
]);

test("only non-empty printable ASCII without whitespace is a credential value", () => {
  assert.equal(isValidCredentialValue(value()), true);
  for (const bad of ["", " leading", "trailing\n", "in ner", "tab\t", "café", "\u007f"])
    assert.equal(isValidCredentialValue(new TextEncoder().encode(bad)), false, JSON.stringify(bad));
});

test("the value policy admits exactly the byte budget the darwin backend derives", () => {
  assert.equal(MAX_CREDENTIAL_VALUE_BYTES, 1416, "the qualification reports name this number");
  assert.equal(
    KEYCHAIN_VALUE_BUDGET_BYTES,
    MAX_CREDENTIAL_VALUE_BYTES,
    "the keychain carries exactly the policy's limit"
  );
  assert.equal(isValidCredentialValue(new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES).fill(0x41)), true);
  assert.equal(isValidCredentialValue(new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41)), false);
});

for (const [platform, { Backend, fake: makeFake, isWrite, accepted }] of Object.entries(PLATFORMS)) {
  test(`${platform}: presence runs under the presence timeout, inside the doctor's probe budget`, async () => {
    assert.ok(PRESENCE_TIMEOUT_MS < DOCTOR_PROBE_TIMEOUT_MS);
    const fake = makeFake();
    await new Backend({ runner: fake.runner }).has(locator);
    assert.ok(fake.invocations.length > 0);
    for (const invocation of fake.invocations) assert.equal(invocation.timeoutMs, PRESENCE_TIMEOUT_MS);
  });

  test(`${platform}: a non-canonical locator is refused by every operation before any process runs`, async () => {
    const fake = makeFake();
    const backend = new Backend({ runner: fake.runner });
    for (const bad of NON_CANONICAL_LOCATORS) {
      const label = `${bad.namespace} ${bad.logicalName}`;
      await assert.rejects(backend.has(bad), { code: "VES_SECRET_BINDING_INVALID" }, label);
      await assert.rejects(backend.read(bad), { code: "VES_SECRET_BINDING_INVALID" }, label);
      await assert.rejects(backend.store(bad, value()), { code: "VES_SECRET_BINDING_INVALID" }, label);
      await assert.rejects(backend.delete(bad), { code: "VES_SECRET_BINDING_INVALID" }, label);
    }
    assert.equal(fake.invocations.length, 0);
  });

  test(`${platform}: an invalid value is refused before any process runs`, async () => {
    const fake = makeFake();
    const backend = new Backend({ runner: fake.runner });
    for (const invalid of [
      new Uint8Array(),
      new TextEncoder().encode("two words"),
      new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41)
    ])
      await assert.rejects(backend.store(locator, invalid), { code: "VES_SECRET_VALUE_INVALID" });
    assert.equal(fake.invocations.length, 0);
  });

  test(`${platform}: a write the tool accepted but that did not land is a failure`, async () => {
    const fake = makeFake({ override: (record) => (isWrite(record) ? accepted : undefined) });
    const backend = new Backend({ runner: fake.runner });
    await assert.rejects(
      backend.store(locator, value()),
      (error) => error.code === "VES_SECRET_BACKEND_FAILURE" && /did not (?:land|persist)/u.test(error.message)
    );
    assert.equal(fake.invocations.filter(isWrite).length, 1, "the write was attempted once");
    assert.equal(isWrite(fake.invocations.at(-1)), false, "the refusal comes from the presence check after it");
    assert.equal(fake.items.size, 0);
  });
}
