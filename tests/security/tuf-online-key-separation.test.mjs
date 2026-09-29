import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { canonicalize } from "@tufjs/canonical-json";

import { buildTufOnlineRoleRefresh } from "../../packages/distribution/src/tuf-publication.ts";
import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { MapDistributionSource, fixture, sha } from "../helpers/tuf-publication-fixture.mjs";

// why: key separation (#18 F1, #382): the online timestamp/snapshot key is the only
// key the monthly refresh holds, so it must be unable to author root or targets
// metadata that any party accepts, and the refresh must refuse to sign with any
// key that carries root or targets authority.

const roots = [];
after(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const hex = (value) => sha(value).slice("sha256:".length);
const body = (bytes) => JSON.parse(Buffer.from(bytes).toString("utf8"));
const envelope = (signed, signers) => {
  const payload = Buffer.from(canonicalize(signed), "utf8");
  return Buffer.from(
    JSON.stringify({
      signatures: signers.map((signer) => ({
        keyid: signer.keyId,
        sig: Buffer.from(signer.sign(payload)).toString("hex")
      })),
      signed
    }),
    "utf8"
  );
};
const metaFor = (bytes, version) => ({ version, length: bytes.byteLength, hashes: { sha256: hex(bytes) } });

const refreshInput = (value, overrides = {}) => ({
  schemaVersion: 1,
  trustedRoot: value.publication.trustedRoot,
  targets: value.publication.metadata.get("1.targets.json"),
  components: value.publication.metadata.get("1.components.json"),
  versions: { snapshot: 2, timestamp: 2 },
  expires: { snapshot: value.expires.snapshot, timestamp: value.expires.timestamp },
  roles: {
    timestamp: { threshold: value.online.length, signers: value.online },
    snapshot: { threshold: value.online.length, signers: value.online }
  },
  ...overrides
});

const stagedWith = async (value, metadata) => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-online-key-separation-"));
  roots.push(root);
  const client = new TufUpdateClient({
    trustRootDirectory: join(root, "trust"),
    stagingRoot: join(root, "staging"),
    trustedRoot: value.publication.trustedRoot,
    source: new MapDistributionSource({ metadata, targets: value.publication.targets }, "offline")
  });
  const outcome = await client.resolveAndStage({ platform: "win32", arch: "x64" }).then(
    () => undefined,
    (error) => error
  );
  const staged = await readdir(join(root, "staging")).catch(() => []);
  return { outcome, staged };
};

test("the refresh verifies and re-signs only with the online key", () => {
  const value = fixture();
  const refresh = buildTufOnlineRoleRefresh(refreshInput(value));
  assert.deepEqual([...refresh.metadata.keys()].sort(), ["2.snapshot.json", "timestamp.json"]);
  const onlineIds = value.online.map((signer) => signer.keyId).sort();
  for (const bytes of refresh.metadata.values())
    assert.deepEqual(
      body(bytes)
        .signatures.map((signature) => signature.keyid)
        .sort(),
      onlineIds
    );
});

test("the refresh refuses to sign with a key that holds root or targets authority", () => {
  const value = fixture();
  const [offline] = value.offline;
  for (const role of ["timestamp", "snapshot"]) {
    const roles = { ...refreshInput(value).roles, [role]: { threshold: 1, signers: [offline] } };
    assert.throws(() => buildTufOnlineRoleRefresh(refreshInput(value, { roles })), {
      code: "VES_TUF_PUBLICATION_ROLE_SEPARATION"
    });
  }
  // why: the offline key material under a fresh key id is still the offline key.
  const disguised = { ...offline, keyId: hex(`disguised:${offline.publicKeyPem}`) };
  const roles = { timestamp: { threshold: 1, signers: [disguised] }, snapshot: { threshold: 1, signers: [disguised] } };
  assert.throws(() => buildTufOnlineRoleRefresh(refreshInput(value, { roles })), {
    code: "VES_TUF_PUBLICATION_ROLE_SEPARATION"
  });
});

test("targets signed by the online key never verify: not in the refresh, not in the client", async () => {
  const value = fixture();
  const published = body(value.publication.metadata.get("1.targets.json")).signed;
  // why: the same signed body and version, so only the signing key differs and
  // the refusal can come from nothing but signature verification.
  const resigned = envelope(published, value.online);
  assert.throws(() => buildTufOnlineRoleRefresh(refreshInput(value, { targets: resigned })), {
    code: "VES_TUF_PUBLICATION_REFRESH_UNVERIFIED",
    message: "published targets does not meet its signature threshold"
  });
  const forgedTargets = envelope({ ...published, version: 2 }, value.online);

  // why: a compromised online key can sign a snapshot and timestamp that point at
  // its own targets, but the client checks targets against the root's offline
  // targets role and refuses before staging anything.
  const components = value.publication.metadata.get("1.components.json");
  const snapshot = envelope(
    {
      _type: "snapshot",
      spec_version: "1.0.0",
      version: 2,
      expires: value.expires.snapshot,
      meta: { "targets.json": metaFor(forgedTargets, 2), "components.json": metaFor(components, 1) }
    },
    value.online
  );
  const timestamp = envelope(
    {
      _type: "timestamp",
      spec_version: "1.0.0",
      version: 2,
      expires: value.expires.timestamp,
      meta: { "snapshot.json": metaFor(snapshot, 2) }
    },
    value.online
  );
  const metadata = new Map(value.publication.metadata);
  metadata.set("timestamp.json", timestamp);
  metadata.set("2.snapshot.json", snapshot);
  metadata.set("2.targets.json", forgedTargets);
  const { outcome, staged } = await stagedWith(value, metadata);
  assert.equal(outcome?.code, "VES_TUF_THRESHOLD");
  assert.equal(outcome.activationAllowed, false);
  assert.deepEqual(staged, []);
});

test("a root signed by the online key never replaces the offline root", async () => {
  const value = fixture();
  const published = body(value.publication.trustedRoot).signed;
  const onlineRole = { keyids: value.online.map((signer) => signer.keyId), threshold: value.online.length };
  const forgedRoot = envelope(
    { ...published, version: 2, roles: { ...published.roles, root: onlineRole, targets: onlineRole } },
    value.online
  );
  assert.throws(() => buildTufOnlineRoleRefresh(refreshInput(value, { trustedRoot: forgedRoot })), {
    code: "VES_TUF_PUBLICATION_REFRESH_UNVERIFIED"
  });
  const metadata = new Map(value.publication.metadata);
  metadata.set("2.root.json", forgedRoot);
  const { outcome, staged } = await stagedWith(value, metadata);
  assert.equal(outcome?.code, "VES_TUF_THRESHOLD");
  assert.equal(outcome.activationAllowed, false);
  assert.deepEqual(staged, []);
});
