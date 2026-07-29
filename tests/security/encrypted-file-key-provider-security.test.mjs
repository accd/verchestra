import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { EncryptedFileKeyProvider } from "../../packages/platform-node/src/index.ts";

const roots = [];
const request = Object.freeze({ keyId: "team-execution-2026", purposes: ["execution-package"] });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-key-provider-security-"));
  roots.push(root);
  return {
    root,
    provider: new EncryptedFileKeyProvider({
      stateRoot: root,
      passphrase: async () => Buffer.from("correct horse battery staple", "utf8")
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

test("tampered ciphertext and public-reference metadata fail closed without regenerating a key", async () => {
  const { root, provider } = await fixture();
  const created = await provider.loadOrCreate(request);
  const path = await keystorePath(root);
  const original = JSON.parse(await readFile(path, "utf8"));
  const ciphertextTampered = structuredClone(original);
  ciphertextTampered.ciphertext = `${ciphertextTampered.ciphertext[0] === "A" ? "B" : "A"}${ciphertextTampered.ciphertext.slice(1)}`;
  await writeFile(path, `${JSON.stringify(ciphertextTampered)}\n`, "utf8");

  await assert.rejects(provider.loadOrCreate(request), { code: "VES_KEYSTORE_INTEGRITY" });
  const identityTampered = structuredClone(original);
  identityTampered.publicKeyRef.keyId = "other-key";
  await writeFile(path, `${JSON.stringify(identityTampered)}\n`, "utf8");

  await assert.rejects(provider.loadOrCreate(request), { code: "VES_KEYSTORE_INTEGRITY" });
  const malformedReference = structuredClone(original);
  malformedReference.publicKeyRef.purposes = [];
  await writeFile(path, `${JSON.stringify(malformedReference)}\n`, "utf8");

  await assert.rejects(provider.loadOrCreate(request), { code: "VES_KEYSTORE_INTEGRITY" });
  assert.equal((await readdir(join(root, "keys"))).length, 1);
  assert.equal(created.publicKeyRef.keyId, request.keyId);
});

test("keystore failures expose a stable public code without disclosing the supplied passphrase", async () => {
  const { root, provider } = await fixture();
  await provider.loadOrCreate(request);
  const secret = "incorrect-passphrase-must-not-appear";
  const wrong = new EncryptedFileKeyProvider({ stateRoot: root, passphrase: async () => Buffer.from(secret, "utf8") });

  await assert.rejects(wrong.loadOrCreate(request), (error) => {
    assert.equal(error.code, "VES_KEYSTORE_INTEGRITY");
    assert.equal(error.message.includes(secret), false);
    return true;
  });
});
