// invariant: #379's darwin backend against the real /usr/bin/security and a
// disposable keychain file that is never on the user's search list. On any
// other platform the same tests assert, not skip, that no credential store is
// qualified there — a skipped case would read as a pass it never earned.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DarwinKeychainBackend,
  MAX_CREDENTIAL_VALUE_BYTES,
  createOsCredentialStore,
  nodeSecurityRunner
} from "../../packages/platform-node/src/index.ts";
import { createDisposableKeychain, searchListLookupStatus } from "../helpers/disposable-keychain.mjs";

const DARWIN = process.platform === "darwin";
// invariant: a service name no real item uses, so exit 44 from a search-list
// lookup proves the login keychain was never written.
const workspaceId = "workspace_5d1f0a9e-2b3c-4d4e-9f5a-6b7c8d9e0f1a";
const namespace = `verchestra/${workspaceId}`;

async function withKeychain(body) {
  const keychain = await createDisposableKeychain();
  try {
    await body(keychain);
  } finally {
    await keychain.dispose();
  }
  assert.equal(searchListLookupStatus(namespace), 44, "the login keychain holds no item for the test namespace");
}

test(
  "darwin: set, has, read, update, and delete round-trip in a disposable keychain",
  { timeout: 60_000 },
  async (t) => {
    if (!DARWIN) {
      t.diagnostic(`not darwin (${process.platform}): asserting the credential store is refused instead`);
      assert.throws(() => createOsCredentialStore({ platform: process.platform }), {
        code: "VES_SECRET_STORE_UNQUALIFIED"
      });
      return;
    }
    await withKeychain(async (keychain) => {
      const store = createOsCredentialStore({ platform: "darwin", keychainPath: keychain.path });
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
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), true);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.has(workspaceId, "openai-api-key"), true);
    });
  }
);

test(
  "darwin: an unusable keychain path is refused before `security` can fall back to the login keychain",
  { timeout: 60_000 },
  async (t) => {
    if (!DARWIN) {
      t.diagnostic(`not darwin (${process.platform}): asserting the credential store is refused instead`);
      assert.throws(() => createOsCredentialStore({ platform: process.platform }), {
        code: "VES_SECRET_STORE_UNQUALIFIED"
      });
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), "verchestra-keychain-bad-"));
    try {
      const junk = join(directory, "junk.keychain-db");
      await writeFile(junk, "not a keychain");
      for (const path of [join(directory, "missing.keychain-db"), junk, directory]) {
        const backend = new DarwinKeychainBackend({ keychainPath: path });
        await assert.rejects(
          backend.store({ namespace, logicalName: "anthropic-api-key" }, new TextEncoder().encode("sk-ant-x")),
          {
            code: "VES_SECRET_KEYCHAIN_INVALID"
          }
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
    assert.equal(searchListLookupStatus(namespace), 44, "nothing fell back into the login keychain");
  }
);

test("darwin: an oversize value never reaches `security`", { timeout: 60_000 }, async (t) => {
  if (!DARWIN) {
    t.diagnostic(`not darwin (${process.platform}): asserting the credential store is refused instead`);
    assert.throws(() => createOsCredentialStore({ platform: process.platform }), {
      code: "VES_SECRET_STORE_UNQUALIFIED"
    });
    return;
  }
  await withKeychain(async (keychain) => {
    const store = createOsCredentialStore({ platform: "darwin", keychainPath: keychain.path });
    await assert.rejects(
      store.store(workspaceId, "anthropic-api-key", new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41)),
      { code: "VES_SECRET_VALUE_INVALID" }
    );
    assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
  });
});

test("darwin: the real runner kills a child at its timeout and says so", { timeout: 60_000 }, async (t) => {
  if (!DARWIN) {
    t.diagnostic(`not darwin (${process.platform}): asserting the credential store is refused instead`);
    assert.throws(() => createOsCredentialStore({ platform: process.platform }), {
      code: "VES_SECRET_STORE_UNQUALIFIED"
    });
    return;
  }
  // invariant: `help` touches no keychain, so killing it mid-run is harmless.
  const killed = await nodeSecurityRunner({ args: ["help"], timeoutMs: 1 });
  assert.equal(killed.timedOut, true);
  assert.equal(killed.exitCode, null);
  const finished = await nodeSecurityRunner({ args: ["help"], timeoutMs: 10_000 });
  assert.equal(finished.timedOut, false);
});
