// invariant: #379 D1, the darwin keychain backend's command protocol, against a fake
// `security` runner. Platform-independent: nothing here spawns a process.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  DarwinKeychainBackend,
  MAX_CREDENTIAL_VALUE_BYTES,
  SECURITY_EXECUTABLE,
  SECURITY_INTERACTIVE_LINE_LIMIT,
  createOsCredentialStore
} from "../../packages/platform-node/src/index.ts";
import { fakeKeychainFile, fakeSecurityRunner } from "../helpers/fake-security-runner.mjs";

const workspaceId = "workspace_0b0e8d4c-6a1e-4f7a-9d55-3e3c6f0c1a2b";
const locator = Object.freeze({ namespace: `verchestra/${workspaceId}`, logicalName: "anthropic-api-key" });
const value = () => new TextEncoder().encode("sk-ant-unit-value-123");
const scratch = await mkdtemp(join(tmpdir(), "verchestra-keychain-unit-"));
after(() => rm(scratch, { recursive: true, force: true }));

test("presence is an attribute-only lookup that never asks for the value", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  assert.equal(await backend.has(locator), false);
  assert.deepEqual(fake.invocations[0].args, [
    "find-generic-password",
    "-s",
    locator.namespace,
    "-a",
    locator.logicalName
  ]);
  for (const flag of ["-g", "-w"]) assert.equal(fake.invocations[0].args.includes(flag), false);
});

test("exit 0 is present, exit 44 is absent, and every other exit is a backend failure", async () => {
  for (const [exitCode, expected] of [
    [0, true],
    [44, false]
  ]) {
    const backend = new DarwinKeychainBackend({ runner: async () => ({ exitCode, stdout: "", stderr: "" }) });
    assert.equal(await backend.has(locator), expected);
  }
  for (const exitCode of [1, 36, 51, null]) {
    const backend = new DarwinKeychainBackend({ runner: async () => ({ exitCode, stdout: "", stderr: "" }) });
    await assert.rejects(backend.has(locator), { code: "VES_SECRET_BACKEND_FAILURE" });
  }
});

test("store writes one bounded `security -i` line over stdin and verifies the item landed", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  await backend.store(locator, value());
  const [lookup, write, verify] = fake.invocations;
  assert.deepEqual(lookup.args.slice(0, 1), ["find-generic-password"]);
  assert.deepEqual(write.args, ["-i"]);
  assert.equal(
    write.stdin,
    `add-generic-password -s ${locator.namespace} -a ${locator.logicalName} -T ${SECURITY_EXECUTABLE} -X ${Buffer.from(value()).toString("hex")}\n`
  );
  assert.deepEqual(verify.args.slice(0, 1), ["find-generic-password"]);
  assert.equal(await backend.has(locator), true);
});

test("a rotation deletes the old item and adds a fresh one, never updating it in place", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  await backend.store(locator, value());
  fake.invocations.length = 0;
  await backend.store(locator, new TextEncoder().encode("sk-ant-rotated"));
  assert.deepEqual(
    fake.invocations.map((invocation) => invocation.args[0]),
    ["find-generic-password", "delete-generic-password", "-i", "find-generic-password"]
  );
  assert.equal(new TextDecoder().decode(await backend.read(locator)), "sk-ant-rotated");
});

test("no operation ever changes an existing item's access list", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  await backend.store(locator, value());
  await backend.store(locator, value());
  await backend.has(locator);
  await backend.read(locator);
  await backend.delete(locator);
  for (const invocation of fake.invocations) {
    const tokens = invocation.args[0] === "-i" ? invocation.stdin.trim().split(" ") : invocation.args;
    for (const forbidden of ["-U", "-A", "set-generic-password-partition-list", "set-key-partition-list"])
      assert.equal(tokens.includes(forbidden), false, `${forbidden} in ${tokens[0]}`);
    const trusted = tokens.flatMap((token, index) => (token === "-T" ? [tokens[index + 1]] : []));
    assert.deepEqual(trusted, tokens[0] === "add-generic-password" ? [SECURITY_EXECUTABLE] : []);
  }
});

test("a failed add after the old item was deleted reports the credential as absent, distinctly", async () => {
  const fake = fakeSecurityRunner({
    override: (record) =>
      record.args[0] === "-i" && fake.items.size === 0 ? { exitCode: 1, stdout: "", stderr: "" } : undefined
  });
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  fake.items.set(`default\u0000${locator.namespace}\u0000${locator.logicalName}`, Buffer.from("sk-ant-old"));
  await assert.rejects(backend.store(locator, value()), { code: "VES_SECRET_ROTATION_INCOMPLETE" });
  assert.equal(await backend.has(locator), false);
  const fresh = new DarwinKeychainBackend({
    runner: async (invocation) => ({ exitCode: invocation.args[0] === "-i" ? 1 : 44, stdout: "", stderr: "" })
  });
  await assert.rejects(fresh.store(locator, value()), { code: "VES_SECRET_BACKEND_FAILURE" });
});

test("a timed-out child is reported as keychain interaction required, through the adapter too", async () => {
  const timedOut = async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" });
  const backend = new DarwinKeychainBackend({ runner: timedOut });
  for (const operation of [
    () => backend.has(locator),
    () => backend.read(locator),
    () => backend.delete(locator),
    () => backend.store(locator, value())
  ])
    await assert.rejects(operation(), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
  const store = createOsCredentialStore({ platform: "darwin", runner: timedOut });
  await assert.rejects(store.adapter.has(workspaceId, "anthropic-api-key"), {
    code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED"
  });
  await assert.rejects(store.adapter.read(workspaceId, "anthropic-api-key"), {
    code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED"
  });
});

test("store fails closed when the write exits nonzero", async () => {
  const failing = new DarwinKeychainBackend({ runner: async () => ({ exitCode: 2, stdout: "", stderr: "" }) });
  await assert.rejects(failing.store(locator, value()), { code: "VES_SECRET_BACKEND_FAILURE" });
});

test("read uses -g and decodes both the quoted and the 0x-prefixed password record", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  assert.equal(await backend.read(locator), undefined);
  await backend.store(locator, value());
  assert.deepEqual(Buffer.from(await backend.read(locator)), Buffer.from(value()));
  assert.ok(fake.invocations.at(-1).args.includes("-g"));
  assert.equal(fake.invocations.at(-1).args.includes("-w"), false);
  const hexRecord = new DarwinKeychainBackend({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: 'password: 0x41FF0A42  "A\\377\\012B"\n' })
  });
  assert.deepEqual([...(await hexRecord.read(locator))], [0x41, 0xff, 0x0a, 0x42]);
});

test("read rejects an unrecognized password record without echoing it", async () => {
  const backend = new DarwinKeychainBackend({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "surprise sk-ant-leak\n" })
  });
  await assert.rejects(backend.read(locator), (error) => {
    assert.equal(error.code, "VES_SECRET_BACKEND_FAILURE");
    assert.equal(error.message.includes("sk-ant-leak"), false);
    return true;
  });
});

test("delete reports whether an item was removed", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  assert.equal(await backend.delete(locator), false);
  await backend.store(locator, value());
  assert.equal(await backend.delete(locator), true);
  assert.equal(await backend.has(locator), false);
  const broken = new DarwinKeychainBackend({ runner: async () => ({ exitCode: 1, stdout: "", stderr: "" }) });
  await assert.rejects(broken.delete(locator), { code: "VES_SECRET_BACKEND_FAILURE" });
});

test("the value budget is derived so the worst-case line fits the 4095-byte interactive limit", async () => {
  const worstPath = `/${"a".repeat(1023)}`;
  const worstName = "a".repeat(128);
  const line = `add-generic-password -s ${locator.namespace} -a ${worstName} -T ${SECURITY_EXECUTABLE} -X ${"41".repeat(MAX_CREDENTIAL_VALUE_BYTES)} ${worstPath}`;
  assert.ok(line.length <= SECURITY_INTERACTIVE_LINE_LIMIT, `${line.length}`);
  assert.ok(line.length + 2 > SECURITY_INTERACTIVE_LINE_LIMIT, "the budget is tight, not arbitrary");
  assert.ok(MAX_CREDENTIAL_VALUE_BYTES >= 1024, "room for every provider API key format");
});

test("an oversize value is refused before any process is spawned", async () => {
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner });
  const oversize = new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41);
  await assert.rejects(backend.store(locator, oversize), { code: "VES_SECRET_VALUE_INVALID" });
  assert.equal(fake.invocations.length, 0);
  await backend.store(locator, new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES).fill(0x41));
  const write = fake.invocations.find((invocation) => invocation.args[0] === "-i");
  assert.ok(write.stdin.length - 1 <= SECURITY_INTERACTIVE_LINE_LIMIT);
});

test("an explicit keychain path must be absolute and canonical", () => {
  for (const bad of [
    "relative.keychain-db",
    "/with space/k.keychain-db",
    "/a/../k.keychain-db",
    "/a/./k.keychain-db",
    "/a//k.keychain-db",
    "/trailing/",
    '/quote"/k',
    `/${"a".repeat(1024)}`
  ])
    assert.throws(() => new DarwinKeychainBackend({ keychainPath: bad }), { code: "VES_SECRET_KEYCHAIN_INVALID" }, bad);
});

test("every operation re-proves the explicit keychain is a real keychain file before spawning", async (t) => {
  const valid = await fakeKeychainFile(scratch);
  if (process.platform === "win32") {
    // invariant: a keychain path is POSIX by construction; on win32 the same
    // fixture proves a native path is refused rather than exercised.
    t.diagnostic("win32: asserting a native path is refused as non-canonical");
    assert.throws(() => new DarwinKeychainBackend({ keychainPath: valid }), { code: "VES_SECRET_KEYCHAIN_INVALID" });
    return;
  }
  const notKeychain = join(scratch, "plain.keychain-db");
  await writeFile(notKeychain, "not a keychain");
  const directory = join(scratch, "dir.keychain-db");
  await mkdir(directory);
  const link = join(scratch, "link.keychain-db");
  await symlink(valid, link);
  for (const path of [join(scratch, "missing.keychain-db"), notKeychain, directory, link]) {
    const fake = fakeSecurityRunner();
    const backend = new DarwinKeychainBackend({ runner: fake.runner, keychainPath: path });
    await assert.rejects(backend.has(locator), { code: "VES_SECRET_KEYCHAIN_INVALID" });
    await assert.rejects(backend.read(locator), { code: "VES_SECRET_KEYCHAIN_INVALID" });
    await assert.rejects(backend.store(locator, value()), { code: "VES_SECRET_KEYCHAIN_INVALID" });
    await assert.rejects(backend.delete(locator), { code: "VES_SECRET_KEYCHAIN_INVALID" });
    assert.equal(fake.invocations.length, 0, path);
  }
  const fake = fakeSecurityRunner();
  const backend = new DarwinKeychainBackend({ runner: fake.runner, keychainPath: valid });
  await backend.store(locator, value());
  for (const invocation of fake.invocations) {
    if (invocation.args[0] === "-i") assert.equal(invocation.stdin.endsWith(` ${valid}\n`), true);
    else assert.equal(invocation.args.at(-1), valid);
  }
  assert.equal(backend.keychain, "explicit");
});

test("darwin maps to the keychain store; a platform without a qualified store is refused", () => {
  for (const platform of ["freebsd", "openbsd", "sunos", "aix"])
    assert.throws(() => createOsCredentialStore({ platform }), { code: "VES_SECRET_STORE_UNQUALIFIED" });
  for (const platform of ["linux", "win32"])
    assert.notEqual(createOsCredentialStore({ platform }).storeId, "apple-keychain-credential", platform);
  const store = createOsCredentialStore({ platform: "darwin", runner: fakeSecurityRunner().runner });
  assert.equal(store.storeId, "apple-keychain-credential");
  assert.equal(store.keychain, "default");
});
