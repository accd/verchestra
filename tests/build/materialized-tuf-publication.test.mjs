import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildReleaseCandidate } from "../../packages/distribution/src/release-candidate.ts";
import { materializeHermeticReleaseFromFiles } from "../../packages/distribution/src/release-materializer.ts";
import { buildTufReleasePublication } from "../../packages/distribution/src/tuf-publication.ts";
import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { components, releaseId } from "../helpers/hermetic-bundle-fixture.mjs";
import { healthGate } from "../helpers/activation-fixture.mjs";
import { MapDistributionSource, defaultExpiries, rolesFor } from "../helpers/tuf-publication-fixture.mjs";

const sourceComponents = () =>
  components().filter((component) => !["sbom", "provenance", "evaluation"].includes(component.kind));
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const descriptors = () =>
  sourceComponents().map((component, index) => ({
    componentId: component.componentId,
    kind: component.kind,
    platform: component.platform,
    arch: component.arch,
    logicalPath: component.logicalPath,
    sourcePath: `payload/${String(index).padStart(2, "0")}.bin`,
    licenseRefs: component.kind === "license" ? [] : ["license:closure"],
    attestationRefs: component.attestationRefs,
    executable: component.executable
  }));

const writeFixture = async (root, suffix = "") => {
  await mkdir(join(root, "payload"), { recursive: true });
  for (const [index, component] of sourceComponents().entries())
    await writeFile(
      join(root, "payload", `${String(index).padStart(2, "0")}.bin`),
      `material:${component.componentId}${suffix}`
    );
};

const signers = () =>
  Array.from({ length: 2 }, (_, index) => {
    const pair = generateKeyPairSync("ed25519");
    const publicKeyPem = pair.publicKey.export({ format: "pem", type: "spki" }).toString();
    return {
      keyId: createHash("sha256").update(`materialized-tuf-${index}:${publicKeyPem}`).digest("hex"),
      publicKeyPem,
      sign: (payload) => sign(null, payload, pair.privateKey)
    };
  });

const candidateFor = (materialized) =>
  buildReleaseCandidate({
    schemaVersion: 1,
    candidateId: "candidate:verchestra:materialized:win32-x64",
    revision: materialized.revision,
    semanticVersion: materialized.bundle.semanticVersion,
    bundle: materialized.bundle,
    views: ["online", "mirror", "offline", "air-gapped"].map((mode) => ({
      mode,
      sourceId: `source:${mode}:materialized`,
      releaseDigest: materialized.bundle.releaseDigest,
      metadataDigest: digest(`${mode}:metadata:${materialized.bundle.releaseDigest}`),
      targetDigest: digest(`${mode}:target:${materialized.bundle.releaseDigest}`)
    })),
    evidence: materialized.evidence.map((document) => ({
      kind: document.kind,
      digest: document.contentDigest,
      sizeBytes: document.sizeBytes
    })),
    rollback: {
      previousReleaseDigest: digest("materialized-previous-release"),
      verified: true,
      verificationDigest: digest("materialized-rollback-proof")
    }
  });

const materializePublication = async (root, value) => {
  await writeFixture(root, value.suffix ?? "");
  const materialized = await materializeHermeticReleaseFromFiles({
    schemaVersion: 1,
    releaseId: value.releaseId,
    semanticVersion: value.semanticVersion,
    createdAt: "2026-08-25T00:00:00.000Z",
    target: { platform: "win32", arch: "x64", nodeVersion: "24.14.0" },
    runtimeResolver: false,
    rootDirectory: root,
    sources: descriptors(),
    revision: value.revision,
    evaluations: [{ profile: "release", result: "pass", assertionCount: 20, skipped: 0, todo: 0, survivingMutants: 0 }]
  });
  const candidate = candidateFor(materialized);
  const publication = buildTufReleasePublication({
    schemaVersion: 1,
    candidate,
    componentBytes: materialized.componentBytes,
    metadataVersion: 1,
    rootVersion: 1,
    expires: defaultExpiries,
    roles: rolesFor(signers(), signers()),
    consistentSnapshot: true
  });
  return { materialized, publication };
};

test("materialized bytes feed candidate closure and TUF resolution in every source mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-materialized-tuf-"));
  const trustRoot = await mkdtemp(join(tmpdir(), "vestra-materialized-tuf-trust-"));
  const stagingRoot = await mkdtemp(join(tmpdir(), "vestra-materialized-tuf-stage-"));
  try {
    await writeFixture(root);
    const materialized = await materializeHermeticReleaseFromFiles({
      schemaVersion: 1,
      releaseId,
      semanticVersion: "1.0.0",
      createdAt: "2026-08-25T00:00:00.000Z",
      target: { platform: "win32", arch: "x64", nodeVersion: "24.14.0" },
      runtimeResolver: false,
      rootDirectory: root,
      sources: descriptors(),
      revision: "c".repeat(40),
      evaluations: [
        { profile: "release", result: "pass", assertionCount: 20, skipped: 0, todo: 0, survivingMutants: 0 }
      ]
    });
    const candidate = candidateFor(materialized);
    const publication = buildTufReleasePublication({
      schemaVersion: 1,
      candidate,
      componentBytes: materialized.componentBytes,
      metadataVersion: 1,
      rootVersion: 1,
      expires: defaultExpiries,
      roles: rolesFor(signers(), signers()),
      consistentSnapshot: true
    });
    assert.equal(publication.bundle.releaseDigest, materialized.bundle.releaseDigest);
    for (const mode of ["online", "mirror", "offline", "air-gapped"]) {
      const client = new TufUpdateClient({
        trustRootDirectory: join(trustRoot, mode),
        stagingRoot: join(stagingRoot, mode),
        trustedRoot: publication.trustedRoot,
        source: new MapDistributionSource(publication, mode),
        chunkSize: 31
      });
      const staged = await client.resolveAndStage({ platform: "win32", arch: "x64" });
      assert.equal(staged.releaseDigest, materialized.bundle.releaseDigest);
      assert.deepEqual(staged.bundle, materialized.bundle);
    }
  } finally {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(trustRoot, { recursive: true, force: true }),
      rm(stagingRoot, { recursive: true, force: true })
    ]);
  }
});

test("materialized TUF staged releases activate and rollback through the transactional manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-materialized-rollback-"));
  const firstRoot = await mkdtemp(join(root, "first-"));
  const secondRoot = await mkdtemp(join(root, "second-"));
  const trustRoot = join(root, "trust");
  const stagingRoot = join(root, "staging");
  const installRoot = join(root, "install");
  try {
    const first = await materializePublication(firstRoot, {
      releaseId,
      semanticVersion: "1.0.0",
      revision: "d".repeat(40)
    });
    const second = await materializePublication(secondRoot, {
      releaseId: "release:verchestra:2.0.0:win32-x64",
      semanticVersion: "2.0.0",
      revision: "e".repeat(40),
      suffix: ":next"
    });
    const firstStaged = await new TufUpdateClient({
      trustRootDirectory: join(trustRoot, "first"),
      stagingRoot,
      trustedRoot: first.publication.trustedRoot,
      source: new MapDistributionSource(first.publication, "offline"),
      chunkSize: 31
    }).resolveAndStage({ platform: "win32", arch: "x64" });
    const secondStaged = await new TufUpdateClient({
      trustRootDirectory: join(trustRoot, "second"),
      stagingRoot,
      trustedRoot: second.publication.trustedRoot,
      source: new MapDistributionSource(second.publication, "offline"),
      chunkSize: 31
    }).resolveAndStage({ platform: "win32", arch: "x64" });
    const gate = healthGate();
    const manager = new TransactionalActivationManager({
      installRoot,
      stagingRoot,
      platform: "win32",
      arch: "x64",
      healthGate: gate
    });
    const firstReceipt = await manager.activate(firstStaged);
    const secondReceipt = await manager.activate(secondStaged);
    const rolled = await manager.rollback(firstReceipt.active.releaseDigest);
    assert.equal(secondReceipt.active.releaseDigest, second.materialized.bundle.releaseDigest);
    assert.equal(rolled.operation, "rollback");
    assert.equal(rolled.active.releaseDigest, first.materialized.bundle.releaseDigest);
    assert.equal((await manager.active()).releaseDigest, first.materialized.bundle.releaseDigest);
    assert.equal(gate.calls.length, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
