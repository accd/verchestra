import assert from "node:assert/strict";
import { createPublicKey } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const TRUST = new URL("../../docs/qualification/trust/", import.meta.url);
// invariant: an anchor retired by a rotation (#408) moves here, keeps its public
// key and key id, and gains `validUntil`. It stays so what it signed before then
// stays auditable; no signing path admits it (the publish, refresh, and T75
// attestation tests prove that refusal).
const RETIRED = new URL("retired/", TRUST);
const read = (name, directory = TRUST) => JSON.parse(readFileSync(new URL(name, directory), "utf8"));
const jsonNames = (directory) => readdirSync(directory).filter((name) => name.endsWith(".json"));

// Two signing identities exist and they answer different questions: one says
// "this qualification evidence is mine", the other says "this software is
// mine". Conflating them would let an evidence key authorize a release, so the
// separation is asserted rather than left to convention.
test("every committed trust reference is a usable Ed25519 public key", () => {
  const names = jsonNames(TRUST);
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
  const refs = jsonNames(TRUST).map((name) => {
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
  // why: only JSON references and the one retired/ directory may live here, so
  // nothing escapes the scan below by its name or its depth.
  assert.deepEqual(
    readdirSync(TRUST).filter((name) => !name.endsWith(".json")),
    ["retired"]
  );
  assert.deepEqual(
    readdirSync(RETIRED).filter((name) => !name.endsWith(".json")),
    []
  );
  for (const directory of [TRUST, RETIRED])
    for (const name of jsonNames(directory)) {
      const raw = readFileSync(new URL(name, directory), "utf8");
      assert.doesNotMatch(raw, /PRIVATE KEY/u, name);
      assert.equal(Object.hasOwn(read(name, directory), "privateKey"), false, name);
    }
});

test("no active trust reference is retired", () => {
  for (const name of jsonNames(TRUST)) {
    assert.equal(Object.hasOwn(read(name), "validUntil"), false, `${name} carries a retirement instant`);
    assert.equal(Object.hasOwn(read(name), "validFrom"), false, `${name} carries a validity window`);
  }
});

test("every retired trust reference is a usable Ed25519 key, named by its key id, retired at a real instant", () => {
  const retired = jsonNames(RETIRED);
  // why: the #408 rotation retired the offline, online, and evidence keys; the
  // set may grow with later rotations but never shrink, or history is lost.
  for (const keyId of ["verchestra-release-20260825", "verchestra-release-timestamp-20260930", "t75-evidence-20260825"])
    assert.ok(retired.includes(`${keyId}.json`), `${keyId} stays recorded as retired`);
  const activePurposes = new Set(jsonNames(TRUST).flatMap((name) => read(name).purposes));
  for (const name of retired) {
    const ref = read(name, RETIRED);
    assert.equal(name, `${ref.keyId}.json`, `${name} is named by its key id`);
    assert.equal(ref.algorithm, "Ed25519", name);
    assert.equal(createPublicKey(decode(ref)).asymmetricKeyType, "ed25519", name);
    assert.ok(Array.isArray(ref.purposes) && ref.purposes.length === 1, name);
    assert.match(ref.keyId, /^[a-z0-9-]+$/u, name);
    assert.equal(typeof ref.validUntil, "string", `${name} records when it was retired`);
    assert.equal(new Date(ref.validUntil).toISOString(), ref.validUntil, `${name} retires at an exact UTC instant`);
    // why: a retired key was superseded by an active key for the same authority,
    // so a rotation can never silently drop a role.
    assert.ok(activePurposes.has(ref.purposes[0]), `${name}'s ${ref.purposes[0]} role has an active successor`);
  }
});

test("no key is ever reused: every committed trust identity, active or retired, differs in key material and key id", () => {
  const material = (ref) => createPublicKey(decode(ref)).export({ format: "der", type: "spki" }).toString("hex");
  const refs = [
    ...jsonNames(TRUST).map((name) => ({ name, ref: read(name) })),
    ...jsonNames(RETIRED).map((name) => ({ name: `retired/${name}`, ref: read(name, RETIRED) }))
  ];
  assert.ok(refs.length >= 7, "four active and three retired identities are committed");
  for (let i = 0; i < refs.length; i += 1)
    for (let j = i + 1; j < refs.length; j += 1) {
      const pair = `${refs[i].name} vs ${refs[j].name}`;
      assert.notEqual(material(refs[i].ref), material(refs[j].ref), `${pair} share key material`);
      assert.notEqual(refs[i].ref.keyId, refs[j].ref.keyId, `${pair} share a key id`);
    }
});

function decode(ref) {
  if (ref.encoding === "spki-pem") return ref.publicKey;
  if (ref.encoding === "spki-der-base64url")
    return { key: Buffer.from(ref.publicKey, "base64url"), format: "der", type: "spki" };
  throw new Error(`unsupported trust reference encoding ${ref.encoding}`);
}
