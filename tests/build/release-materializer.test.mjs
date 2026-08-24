import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { materializeHermeticReleaseFromFiles } from "../../packages/distribution/src/release-materializer.ts";
import { verifyHermeticDistributionBundle } from "../../packages/distribution/src/hermetic-bundle.ts";
import { components, releaseId } from "../helpers/hermetic-bundle-fixture.mjs";

const generated = new Set(["sbom", "provenance", "evaluation"]);
const sourceComponents = () => components().filter((component) => !generated.has(component.kind));

const descriptors = () =>
  sourceComponents().map((component, index) => ({
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
  for (const [index, component] of sourceComponents().entries())
    await writeFile(
      join(root, "payload", `${String(index).padStart(2, "0")}.bin`),
      `material:${component.componentId}`
    );
};

const input = (root, sources = descriptors()) => ({
  schemaVersion: 1,
  releaseId,
  semanticVersion: "1.0.0",
  createdAt: "2026-08-25T00:00:00.000Z",
  target: { platform: "win32", arch: "x64", nodeVersion: "24.14.0" },
  runtimeResolver: false,
  rootDirectory: root,
  sources,
  revision: "b".repeat(40),
  evaluations: [
    { profile: "quick", result: "pass", assertionCount: 10, skipped: 0, todo: 0, survivingMutants: 0 },
    { profile: "security", result: "blocked", assertionCount: 8, skipped: 1, todo: 0, survivingMutants: 0 }
  ]
});

test("materializes source bytes, generated evidence, and a complete verified bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-release-materializer-"));
  try {
    await writeFixture(root);
    const result = await materializeHermeticReleaseFromFiles(input(root));
    assert.equal(result.bundle.components.length, 17);
    assert.equal(result.sourceArtifacts.length, 13);
    assert.deepEqual(
      result.evidence.map((document) => document.kind),
      ["license", "sbom", "provenance", "evaluation"]
    );
    assert.equal(result.componentBytes.length, 17);
    assert.deepEqual(verifyHermeticDistributionBundle(result.bundle), result.bundle);
    assert.equal(result.evidence[0].bytes.byteLength > 0, true);
    assert.equal(JSON.stringify(result).includes(root), false);
    for (const component of result.bundle.components) {
      const bytes = result.componentBytes.find((entry) => entry.logicalPath === component.logicalPath)?.bytes;
      assert.ok(bytes, `missing bytes for ${component.logicalPath}`);
      assert.equal(component.sizeBytes, bytes.byteLength);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("materialization is independent of source descriptor order and preserves findings", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-release-materializer-order-"));
  try {
    await writeFixture(root);
    const first = await materializeHermeticReleaseFromFiles(input(root));
    const second = await materializeHermeticReleaseFromFiles(input(root, [...descriptors()].reverse()));
    assert.equal(first.bundle.releaseDigest, second.bundle.releaseDigest);
    assert.deepEqual(first.evidence, second.evidence);
    assert.deepEqual(first.componentBytes, second.componentBytes);
    const evaluation = JSON.parse(
      Buffer.from(first.evidence.find((document) => document.kind === "evaluation").bytes).toString()
    );
    assert.equal(evaluation.summary.failedProfiles, 1);
    assert.equal(evaluation.summary.skippedCases, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
