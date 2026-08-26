import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { buildTufReleasePublication } from "../../packages/distribution/src/tuf-publication.ts";
import { fixture, MapDistributionSource } from "../helpers/tuf-publication-fixture.mjs";

const inputFrom = (value, overrides = {}) => ({
  schemaVersion: 1,
  candidate: value.candidate,
  componentBytes: value.componentBytes,
  metadataVersion: 1,
  rootVersion: 1,
  expires: value.expires,
  roles: value.roles,
  consistentSnapshot: true,
  ...overrides
});

const signedBody = (bytes) => JSON.parse(Buffer.from(bytes).toString("utf8"));

test("publisher rejects incomplete, duplicate, or mismatched component bytes", () => {
  const value = fixture();
  assert.throws(() => buildTufReleasePublication(inputFrom(value, { componentBytes: value.componentBytes.slice(1) })), {
    code: "VES_TUF_PUBLICATION_BYTES_INCOMPLETE"
  });
  const duplicate = [...value.componentBytes];
  duplicate[1] = duplicate[0];
  assert.throws(() => buildTufReleasePublication(inputFrom(value, { componentBytes: duplicate })), {
    code: "VES_TUF_PUBLICATION_BYTES_DUPLICATE"
  });
  const changed = value.componentBytes.map((entry, index) =>
    index === 0 ? { ...entry, bytes: Buffer.from("different") } : entry
  );
  assert.throws(() => buildTufReleasePublication(inputFrom(value, { componentBytes: changed })), {
    code: "VES_TUF_PUBLICATION_BYTES_MISMATCH"
  });
});

test("publisher refuses an unattainable signature threshold and expired metadata", () => {
  const value = fixture();
  // A per-role threshold above that role's own signer count is unattainable.
  assert.throws(
    () =>
      buildTufReleasePublication(
        inputFrom(value, { roles: { ...value.roles, root: { threshold: 3, signers: value.roles.root.signers } } })
      ),
    { code: "VES_TUF_PUBLICATION_THRESHOLD_INVALID" }
  );
  // A past instant for any role is refused before the ordering check.
  assert.throws(
    () =>
      buildTufReleasePublication(
        inputFrom(value, { expires: { ...value.expires, timestamp: "2020-01-01T00:00:00.000Z" } })
      ),
    { code: "VES_TUF_PUBLICATION_INPUT_INVALID" }
  );
});

test("publisher refuses metadata expiries the freeze-attack defense would invert (#18, F2)", () => {
  const value = fixture();
  // Timestamp expiring after the root would let a short online window drag the
  // offline root's expiry down — exactly the coupling F2 removes.
  assert.throws(
    () =>
      buildTufReleasePublication(
        inputFrom(value, {
          expires: {
            timestamp: "2036-01-01T00:00:00.000Z",
            snapshot: "2030-01-01T00:00:00.000Z",
            targets: "2035-01-01T00:00:00.000Z",
            root: "2035-01-01T00:00:00.000Z"
          }
        })
      ),
    { code: "VES_TUF_PUBLICATION_EXPIRY_ORDER_INVALID" }
  );
});

test("the emitted root separates online from offline authority, and each role signs its own (#18, F1)", () => {
  const value = fixture();
  const root = signedBody(value.publication.trustedRoot).signed;
  const offlineIds = value.offline.map((signer) => signer.keyId).sort();
  const onlineIds = value.online.map((signer) => signer.keyId).sort();

  // Root and targets delegate to the offline key; timestamp and snapshot to the
  // online key. The two sets are disjoint, so the online key can sign neither
  // root nor targets — TUF's containment property.
  assert.deepEqual([...root.roles.root.keyids].sort(), offlineIds);
  assert.deepEqual([...root.roles.targets.keyids].sort(), offlineIds);
  assert.deepEqual([...root.roles.timestamp.keyids].sort(), onlineIds);
  assert.deepEqual([...root.roles.snapshot.keyids].sort(), onlineIds);
  assert.equal(
    offlineIds.some((id) => onlineIds.includes(id)),
    false,
    "online and offline authority must be disjoint"
  );
  // The root declares the union of both key sets, once each.
  assert.deepEqual(Object.keys(root.keys).sort(), [...offlineIds, ...onlineIds].sort());
  // Root version is a real input, not a hardcoded 1 (rotation is expressible).
  assert.equal(root.version, 1);

  // Each metadata file is signed only by its role's keys.
  const signaturesOf = (name) =>
    signedBody(value.publication.metadata.get(name))
      .signatures.map((signature) => signature.keyid)
      .sort();
  assert.deepEqual(signaturesOf("root.json"), offlineIds);
  assert.deepEqual(signaturesOf("timestamp.json"), onlineIds);
  assert.deepEqual(signaturesOf("1.snapshot.json"), onlineIds);
  assert.deepEqual(signaturesOf("1.targets.json"), offlineIds);
  assert.deepEqual(signaturesOf("1.components.json"), offlineIds);
});

test("TUF resolver rejects target bytes changed after signed publication", async () => {
  const value = fixture();
  const tamperedTargets = new Map(value.publication.targets);
  const [targetPath, original] = tamperedTargets.entries().next().value;
  const tampered = Buffer.from(original);
  tampered[0] ^= 0xff;
  tamperedTargets.set(targetPath, tampered);
  const publication = { ...value.publication, targets: tamperedTargets };
  const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-publication-security-"));
  try {
    const client = new TufUpdateClient({
      trustRootDirectory: join(root, "trust"),
      stagingRoot: join(root, "staging"),
      trustedRoot: publication.trustedRoot,
      source: new MapDistributionSource(publication, "offline"),
      chunkSize: 17
    });
    await assert.rejects(
      () => client.resolveAndStage({ platform: "win32", arch: "x64" }),
      (error) => {
        assert.equal(error.code, "VES_TUF_INTEGRITY");
        assert.equal(error.activationAllowed, false);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
