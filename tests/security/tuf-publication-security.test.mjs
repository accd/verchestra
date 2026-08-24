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
  expires: "2035-01-01T00:00:00.000Z",
  threshold: 2,
  signers: value.signers,
  consistentSnapshot: true,
  ...overrides
});

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
  assert.throws(() => buildTufReleasePublication(inputFrom(value, { threshold: 3 })), {
    code: "VES_TUF_PUBLICATION_THRESHOLD_INVALID"
  });
  assert.throws(() => buildTufReleasePublication(inputFrom(value, { expires: "2020-01-01T00:00:00.000Z" })), {
    code: "VES_TUF_PUBLICATION_INPUT_INVALID"
  });
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
