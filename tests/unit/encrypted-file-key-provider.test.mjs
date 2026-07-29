import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { EncryptedFileKeyProvider } from "../../packages/platform-node/src/index.ts";

const roots = [];
const request = Object.freeze({ keyId: "team-execution-2026", purposes: ["execution-package"] });

async function fixture(passphrase = "correct horse battery staple") {
  const root = await mkdtemp(join(tmpdir(), "verchestra-key-provider-"));
  roots.push(root);
  return {
    root,
    provider: new EncryptedFileKeyProvider({
      stateRoot: root,
      passphrase: async () => Buffer.from(passphrase, "utf8")
    })
  };
}

async function keystorePath(root) {
  const files = await readdir(join(root, "keys"));
  assert.equal(files.length, 1);
  return join(root, "keys", files[0]);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("encrypted file provider persists one key and reloads the same public reference", async () => {
  const { root, provider } = await fixture();
  const created = await provider.loadOrCreate(request);
  const reloaded = await new EncryptedFileKeyProvider({
    stateRoot: root,
    passphrase: async () => Buffer.from("correct horse battery staple", "utf8")
  }).loadOrCreate(request);

  assert.deepEqual(reloaded.publicKeyRef, created.publicKeyRef);
  assert.notEqual(await reloaded.sign("execution-package", Buffer.from("payload")), "");
  const stored = await readFile(await keystorePath(root), "utf8");
  assert.equal(stored.includes("correct horse battery staple"), false);
  assert.equal(stored.includes('"privateKey"'), false);
  if (process.platform !== "win32") {
    assert.equal((await stat(await keystorePath(root))).mode & 0o777, 0o600);
  }
});

test("encrypted file provider rejects an incorrect passphrase without replacing the key", async () => {
  const { root, provider } = await fixture();
  const created = await provider.loadOrCreate(request);
  const wrong = new EncryptedFileKeyProvider({ stateRoot: root, passphrase: async () => Buffer.from("wrong", "utf8") });

  await assert.rejects(wrong.loadOrCreate(request), { code: "VES_KEYSTORE_INTEGRITY" });
  assert.deepEqual((await provider.loadOrCreate(request)).publicKeyRef, created.publicKeyRef);
});

test("encrypted file provider rejects a truncated keystore", async () => {
  const { root, provider } = await fixture();
  await provider.loadOrCreate(request);
  await writeFile(await keystorePath(root), "{", "utf8");

  await assert.rejects(provider.loadOrCreate(request), { code: "VES_KEYSTORE_INTEGRITY" });
});
