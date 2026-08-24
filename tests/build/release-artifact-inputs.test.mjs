import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildHermeticDistributionBundleFromFiles } from "../../packages/distribution/src/artifact-inputs.ts";
import { verifyHermeticDistributionBundle } from "../../packages/distribution/src/hermetic-bundle.ts";
import { components, releaseId } from "../helpers/hermetic-bundle-fixture.mjs";

const target = Object.freeze({ platform: "win32", arch: "x64", nodeVersion: "24.14.0" });

const descriptors = () =>
  components().map((component, index) => ({
    componentId: component.componentId,
    kind: component.kind,
    platform: component.platform,
    arch: component.arch,
    logicalPath: component.logicalPath,
    sourcePath: `payload/${String(index).padStart(2, "0")}.bin`,
    licenseRefs: component.licenseRefs,
    attestationRefs: component.attestationRefs,
    executable: component.executable
  }));

const writeFixture = async (root) => {
  await mkdir(join(root, "payload"), { recursive: true });
  for (const [index, component] of components().entries()) {
    await writeFile(join(root, "payload", `${String(index).padStart(2, "0")}.bin`), `bytes:${component.componentId}`);
  }
};

const input = (root, sources = descriptors()) => ({
  schemaVersion: 1,
  releaseId,
  semanticVersion: "1.0.0",
  createdAt: "2026-08-24T00:00:00.000Z",
  target,
  runtimeResolver: false,
  rootDirectory: root,
  sources
});

test("builds a complete hermetic bundle from real isolated bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-artifact-inputs-"));
  try {
    await writeFixture(root);
    const bundle = await buildHermeticDistributionBundleFromFiles(input(root));
    assert.equal(bundle.components.length, 16);
    assert.equal(bundle.components[0].sizeBytes > 0, true);
    assert.match(bundle.components[0].contentDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(verifyHermeticDistributionBundle(bundle), bundle);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle identity is independent of source descriptor order", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-artifact-order-"));
  try {
    await writeFixture(root);
    const sources = descriptors();
    const first = await buildHermeticDistributionBundleFromFiles(input(root, sources));
    const second = await buildHermeticDistributionBundleFromFiles(input(root, [...sources].reverse()));
    assert.equal(first.releaseDigest, second.releaseDigest);
    assert.deepEqual(first.components, second.components);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle projection never includes the machine build root or source paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-artifact-redaction-"));
  try {
    await writeFixture(root);
    const bundle = await buildHermeticDistributionBundleFromFiles(input(root));
    const projection = JSON.stringify(bundle);
    assert.equal(projection.includes(root), false);
    assert.equal(projection.includes("payload/00.bin"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing source bytes fail closed with a specific source error", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-artifact-missing-"));
  try {
    await writeFixture(root);
    const sources = descriptors(root);
    sources[0] = { ...sources[0], sourcePath: "payload/missing.bin" };
    await assert.rejects(() => buildHermeticDistributionBundleFromFiles(input(root, sources)), {
      code: "VES_DISTRIBUTION_ARTIFACT_SOURCE_MISSING"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("traversal, duplicate, and directory sources are refused before bundle construction", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-artifact-boundary-"));
  try {
    await writeFixture(root);
    const traversal = descriptors();
    traversal[0] = { ...traversal[0], sourcePath: "../outside.bin" };
    await assert.rejects(() => buildHermeticDistributionBundleFromFiles(input(root, traversal)), {
      code: "VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID"
    });

    const duplicate = descriptors();
    duplicate[1] = { ...duplicate[1], sourcePath: duplicate[0].sourcePath };
    await assert.rejects(() => buildHermeticDistributionBundleFromFiles(input(root, duplicate)), {
      code: "VES_DISTRIBUTION_ARTIFACT_DUPLICATE"
    });

    const duplicateComponent = descriptors();
    duplicateComponent[1] = { ...duplicateComponent[1], componentId: duplicateComponent[0].componentId };
    await assert.rejects(() => buildHermeticDistributionBundleFromFiles(input(root, duplicateComponent)), {
      code: "VES_DISTRIBUTION_ARTIFACT_DUPLICATE"
    });

    const duplicateLogicalPath = descriptors();
    duplicateLogicalPath[1] = { ...duplicateLogicalPath[1], logicalPath: duplicateLogicalPath[0].logicalPath };
    await assert.rejects(() => buildHermeticDistributionBundleFromFiles(input(root, duplicateLogicalPath)), {
      code: "VES_DISTRIBUTION_ARTIFACT_DUPLICATE"
    });

    const directory = descriptors();
    directory[0] = { ...directory[0], sourcePath: "payload" };
    await assert.rejects(() => buildHermeticDistributionBundleFromFiles(input(root, directory)), {
      code: "VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
