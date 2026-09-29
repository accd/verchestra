// invariant: #379's real-keychain qualification (`pnpm qualify:keychain`),
// never a gate suite: the darwin backend against the real /usr/bin/security and a
// disposable keychain file. Every call goes through a runner that refuses to
// spawn unless it names that file, and the file's own attribute dump proves
// exactly which items the test left behind. Nothing here reads or writes the
// login keychain or the search list. On any other platform the same tests
// assert, not skip, that no credential store is qualified there — a skipped
// case would read as a pass it never earned.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DarwinKeychainBackend,
  MAX_CREDENTIAL_VALUE_BYTES,
  createOsCredentialStore
} from "../../../packages/platform-node/src/index.ts";
import { createDisposableKeychain, keychainBoundRunner } from "./disposable-keychain.mjs";

const DARWIN = process.platform === "darwin";
const workspaceId = "workspace_5d1f0a9e-2b3c-4d4e-9f5a-6b7c8d9e0f1a";
const namespace = `verchestra/${workspaceId}`;
const item = (logicalName) => `${namespace}\u0000${logicalName}`;

function refusedElsewhere(t) {
  t.diagnostic(`not darwin (${process.platform}): asserting the credential store is refused instead`);
  assert.throws(() => createOsCredentialStore({ platform: process.platform }), {
    code: "VES_SECRET_STORE_UNQUALIFIED"
  });
}

async function withKeychain(body) {
  const keychain = await createDisposableKeychain();
  try {
    const bound = keychainBoundRunner(keychain.path);
    const store = createOsCredentialStore({ platform: "darwin", keychainPath: keychain.path, runner: bound.runner });
    await body({ keychain, store, bound });
  } finally {
    await keychain.dispose();
  }
}

test(
  "darwin: set, has, read, update, and delete round-trip in a disposable keychain",
  { timeout: 60_000 },
  async (t) => {
    if (!DARWIN) return refusedElsewhere(t);
    await withKeychain(async ({ keychain, store, bound }) => {
      const encode = (text) => new TextEncoder().encode(text);
      await store.verify();
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.read(workspaceId, "anthropic-api-key"), undefined);
      const first = "sk-ant-disposable-~!@#$%^&*()_+{}|:<>?`-=[];,./'\"\\";
      await store.store(workspaceId, "anthropic-api-key", encode(first));
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), true);
      assert.equal(new TextDecoder().decode(await store.adapter.read(workspaceId, "anthropic-api-key")), first);
      await store.store(workspaceId, "anthropic-api-key", encode("sk-ant-rotated"));
      assert.equal(
        new TextDecoder().decode(await store.adapter.read(workspaceId, "anthropic-api-key")),
        "sk-ant-rotated"
      );
      await store.store(workspaceId, "openai-api-key", encode("A".repeat(MAX_CREDENTIAL_VALUE_BYTES)));
      assert.equal((await store.adapter.read(workspaceId, "openai-api-key")).length, MAX_CREDENTIAL_VALUE_BYTES);
      assert.deepEqual(keychain.items(), [item("anthropic-api-key"), item("openai-api-key")]);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), true);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.deepEqual(keychain.items(), [item("openai-api-key")]);
      for (const command of ["find-generic-password", "delete-generic-password", "-i add-generic-password"])
        assert.ok(bound.commands.includes(command), command);
    });
  }
);

test(
  "darwin: an unusable keychain path is refused before `security` is ever spawned",
  { timeout: 60_000 },
  async (t) => {
    if (!DARWIN) return refusedElsewhere(t);
    const directory = await mkdtemp(join(tmpdir(), "verchestra-keychain-bad-"));
    try {
      const junk = join(directory, "junk.keychain-db");
      await writeFile(junk, "not a keychain");
      for (const path of [join(directory, "missing.keychain-db"), junk, directory]) {
        const bound = keychainBoundRunner(path);
        const backend = new DarwinKeychainBackend({ keychainPath: path, runner: bound.runner });
        const locator = { namespace, logicalName: "anthropic-api-key" };
        for (const operation of [
          () => backend.store(locator, new TextEncoder().encode("sk-ant-x")),
          () => backend.delete(locator),
          () => backend.read(locator),
          () => backend.has(locator)
        ])
          await assert.rejects(operation(), { code: "VES_SECRET_KEYCHAIN_INVALID" });
        assert.deepEqual(bound.commands, [], path);
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test("darwin: an oversize value never reaches `security`", { timeout: 60_000 }, async (t) => {
  if (!DARWIN) return refusedElsewhere(t);
  await withKeychain(async ({ keychain, store, bound }) => {
    await assert.rejects(
      store.store(workspaceId, "anthropic-api-key", new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41)),
      { code: "VES_SECRET_VALUE_INVALID" }
    );
    assert.deepEqual(bound.commands, []);
    assert.deepEqual(keychain.items(), []);
  });
});

test("darwin: the real runner kills a child at its timeout and says so", { timeout: 60_000 }, async (t) => {
  if (!DARWIN) return refusedElsewhere(t);
  await withKeychain(async ({ keychain, bound }) => {
    const args = ["find-generic-password", "-s", namespace, "-a", "anthropic-api-key", keychain.path];
    const killed = await bound.runner({ args, timeoutMs: 1 });
    assert.equal(killed.timedOut, true);
    assert.equal(killed.exitCode, null);
    const finished = await bound.runner({ args, timeoutMs: 10_000 });
    assert.equal(finished.timedOut, false);
    assert.equal(finished.exitCode, 44);
  });
});
