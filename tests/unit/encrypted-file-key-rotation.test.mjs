import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { ArtifactSealer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { EncryptedFileKeyProvider } from "../../packages/platform-node/src/index.ts";

const roots = [];
const request = Object.freeze({ keyId: "team-execution-2026", purposes: ["execution-package"] });
const now = () => new Date("2026-07-29T15:10:00.000Z");
const binding = Object.freeze({
  schema: { name: "execution-package", version: 1 },
  purpose: "execution-package",
  bindingId: "ticket:VES-51",
  sourceStateDigest: "a".repeat(64)
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-key-rotation-"));
  roots.push(root);
  return new EncryptedFileKeyProvider({
    stateRoot: root,
    now,
    passphrase: async () => Buffer.from("correct horse battery staple", "utf8")
  });
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("rotation creates a new physical identity, preserves the previous public reference, and persists the active key", async () => {
  const provider = await fixture();
  const initial = await provider.loadOrCreate(request);
  const rotation = await provider.rotate({ ...request, overlapUntil: "2026-08-01T00:00:00.000Z" });

  assert.equal(rotation.previous.keyId, initial.publicKeyRef.keyId);
  assert.equal(rotation.previous.validUntil, "2026-08-01T00:00:00.000Z");
  assert.notEqual(rotation.current.publicKeyRef.keyId, initial.publicKeyRef.keyId);
  assert.equal(rotation.current.publicKeyRef.validFrom, "2026-07-29T15:10:00.000Z");
  assert.deepEqual((await provider.loadOrCreate(request)).publicKeyRef, rotation.current.publicKeyRef);
});

test("revocation persists and blocks further signing-key loads", async () => {
  const provider = await fixture();
  await provider.loadOrCreate(request);
  await provider.revoke(request.keyId);

  await assert.rejects(provider.loadOrCreate(request), { code: "VES_KEY_REVOKED" });
});

test("rotation refuses an overlap that is already expired", async () => {
  const provider = await fixture();
  await provider.loadOrCreate(request);

  await assert.rejects(provider.rotate({ ...request, overlapUntil: "2026-07-29T15:09:59.999Z" }), {
    code: "VES_KEY_EXPIRED"
  });
});

test("trust roots verify the previous key during overlap and reject it after expiry", async () => {
  const provider = await fixture();
  const initial = await provider.loadOrCreate(request);
  const previousArtifact = await new ArtifactSealer({ signer: initial }).seal({ state: "before-rotation" }, binding, {
    issuedAt: "2026-07-29T15:10:00.000Z"
  });
  const rotation = await provider.rotate({ ...request, overlapUntil: "2026-08-01T00:00:00.000Z" });
  const currentArtifact = await new ArtifactSealer({ signer: rotation.current }).seal(
    { state: "after-rotation" },
    binding,
    {
      issuedAt: "2026-07-29T15:10:00.000Z"
    }
  );
  const trust = createTrustRoot({
    trustRootId: "team-execution",
    version: 2,
    keys: [rotation.previous, rotation.current.publicKeyRef]
  });

  const duringOverlap = { ...binding, now: new Date("2026-07-30T00:00:00.000Z") };
  assert.equal(
    (await new ArtifactSealer({ signer: rotation.current }).verify(previousArtifact, trust, duringOverlap)).ok,
    true
  );
  assert.equal(
    (await new ArtifactSealer({ signer: rotation.current }).verify(currentArtifact, trust, duringOverlap)).ok,
    true
  );
  assert.deepEqual(
    await new ArtifactSealer({ signer: rotation.current }).verify(previousArtifact, trust, {
      ...binding,
      now: new Date("2026-08-02T00:00:00.000Z")
    }),
    { ok: false, code: "VES_TRUST_KEY_EXPIRED" }
  );
});
