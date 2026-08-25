import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const TRUST = new URL("../../docs/qualification/trust/", import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, TRUST), "utf8"));

// Two signing identities exist and they answer different questions: one says
// "this qualification evidence is mine", the other says "this software is
// mine". Conflating them would let an evidence key authorize a release, so the
// separation is asserted rather than left to convention.
test("every committed trust reference is a usable Ed25519 public key", () => {
  const names = readdirSync(TRUST).filter((name) => name.endsWith(".json"));
  assert.ok(names.length >= 2);
  for (const name of names) {
    const ref = read(name);
    assert.equal(ref.algorithm, "Ed25519", name);
    assert.equal(createPublicKey(decode(ref)).asymmetricKeyType, "ed25519", name);
    assert.ok(Array.isArray(ref.purposes) && ref.purposes.length === 1, name);
    assert.match(ref.keyId, /^[a-z0-9-]+$/u, name);
  }
});

test("the evidence and release identities share neither purpose nor key material", () => {
  const evidence = read("t75-evidence-public-key.json");
  const release = read("verchestra-release-public-key.json");
  assert.notDeepEqual(evidence.purposes, release.purposes);
  assert.notEqual(evidence.keyId, release.keyId);
  const material = (ref) => createPublicKey(decode(ref)).export({ format: "der", type: "spki" }).toString("hex");
  assert.notEqual(material(evidence), material(release));
});

test("no committed trust reference carries private key material", () => {
  for (const name of readdirSync(TRUST)) {
    const raw = readFileSync(new URL(name, TRUST), "utf8");
    assert.doesNotMatch(raw, /PRIVATE KEY/u, name);
    assert.equal(Object.hasOwn(read(name), "privateKey"), false, name);
  }
});

function decode(ref) {
  if (ref.encoding === "spki-pem") return ref.publicKey;
  if (ref.encoding === "spki-der-base64url")
    return { key: Buffer.from(ref.publicKey, "base64url"), format: "der", type: "spki" };
  throw new Error(`unsupported trust reference encoding ${ref.encoding}`);
}
