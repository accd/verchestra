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

// Generalized to every pair, not the two named ones, so a role-separated key
// added later — the online timestamp/snapshot key (#18, F1) and the
// release-decision key — is held to the same disjointness the moment it lands,
// with no further test change. Each identity answers a different question
// ("this evidence is mine", "this software is mine", "this timestamp is mine",
// "this decision is mine"); conflating any two would let one authority act as
// another.
test("every pair of committed trust identities is disjoint in key material, key id, and purpose", () => {
  const material = (ref) => createPublicKey(decode(ref)).export({ format: "der", type: "spki" }).toString("hex");
  const refs = readdirSync(TRUST)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const ref = read(name);
      return { name, keyId: ref.keyId, purposes: ref.purposes, material: material(ref) };
    });
  assert.ok(refs.length >= 2, "at least two trust identities must exist to separate");
  for (let i = 0; i < refs.length; i += 1)
    for (let j = i + 1; j < refs.length; j += 1) {
      const [a, b] = [refs[i], refs[j]];
      const pair = `${a.name} vs ${b.name}`;
      assert.notEqual(a.material, b.material, `${pair} share key material`);
      assert.notEqual(a.keyId, b.keyId, `${pair} share a key id`);
      assert.equal(
        a.purposes.some((purpose) => b.purposes.includes(purpose)),
        false,
        `${pair} share a purpose`
      );
    }
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
