import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { materializeHermeticReleaseFromFiles } from "../../packages/distribution/src/release-materializer.ts";
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
  evaluations: [{ profile: "quick", result: "pass", assertionCount: 10, skipped: 0, todo: 0, survivingMutants: 0 }]
});

const writeFixture = async (root) => {
  await mkdir(join(root, "payload"), { recursive: true });
  for (const [index, component] of sourceComponents().entries())
    await writeFile(
      join(root, "payload", `${String(index).padStart(2, "0")}.bin`),
      `material:${component.componentId}`
    );
};

test("generated evidence cannot be smuggled in as a source component", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-release-materializer-generated-"));
  try {
    await writeFixture(root);
    const forged = descriptors();
    forged[0] = { ...forged[0], kind: "sbom" };
    await assert.rejects(() => materializeHermeticReleaseFromFiles(input(root, forged)), {
      code: "VES_DISTRIBUTION_MATERIALIZATION_GENERATED_INPUT"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a source collision with a generated evidence identity fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-release-materializer-duplicate-"));
  try {
    await writeFixture(root);
    const forged = descriptors();
    forged[0] = { ...forged[0], componentId: "provenance:build" };
    await assert.rejects(() => materializeHermeticReleaseFromFiles(input(root, forged)), {
      code: "VES_DISTRIBUTION_MATERIALIZATION_DUPLICATE"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an evaluation with surviving mutants is preserved and never upgraded", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-release-materializer-mutants-"));
  try {
    await writeFixture(root);
    const value = input(root);
    value.evaluations = [
      { profile: "security", result: "fail", assertionCount: 10, skipped: 0, todo: 0, survivingMutants: 2 }
    ];
    const result = await materializeHermeticReleaseFromFiles(value);
    const evaluation = JSON.parse(
      Buffer.from(result.evidence.find((document) => document.kind === "evaluation").bytes).toString()
    );
    assert.equal(evaluation.summary.failedProfiles, 1);
    assert.equal(evaluation.summary.survivingMutants, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("changing an observed source byte changes its component and bundle identities", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-release-materializer-integrity-"));
  try {
    await writeFixture(root);
    const before = await materializeHermeticReleaseFromFiles(input(root));
    await writeFile(join(root, "payload", "00.bin"), "material:tampered");
    const after = await materializeHermeticReleaseFromFiles(input(root));
    assert.notEqual(before.bundle.releaseDigest, after.bundle.releaseDigest);
    const beforeComponent = before.bundle.components.find(
      (component) => component.logicalPath === "components/runtime-node"
    );
    const afterComponent = after.bundle.components.find(
      (component) => component.logicalPath === "components/runtime-node"
    );
    assert.notEqual(beforeComponent.contentDigest, afterComponent.contentDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
