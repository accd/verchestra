// Drives the real T76 candidate builder end to end.
//
// The builder now bundles the sealed launchers from the working tree and
// therefore refuses to build from a dirty tree (VES_T76_BUILD_TREE_DIRTY), so
// this suite runs it against a sealed single-commit replica of the current
// repository state (tests/helpers/sealed-repository-fixture.mjs) instead of
// the developer's checkout: the replica satisfies the builder's clean-tree
// guarantee by construction while still building the real, current sources
// under test, and no test ever commits into - or depends on the cleanliness
// of - the tree a developer is actually working in.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { after, before, test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { buildReproducibleT76Target, bundleSealedLauncher } from "../../scripts/t76-build-candidate.mjs";
import { createSealedRepositoryReplica } from "../helpers/sealed-repository-fixture.mjs";

const target = Object.freeze({ platform: process.platform, arch: process.arch, nodeVersion: process.version.slice(1) });
const evaluations = Object.freeze(
  ["build", "full", "quick", "release", "security"].map((profile) => ({
    profile,
    result: "pass",
    assertionCount: 100,
    skipped: 0,
    todo: 0,
    survivingMutants: 0
  }))
);

let replica;

before(async () => {
  replica = await createSealedRepositoryReplica();
});

after(async () => {
  await replica?.dispose();
});

const options = (outputDirectory, overrides = {}) => ({
  repositoryRoot: replica.repository,
  revision: replica.revision,
  releaseId: "release:verchestra:test:target",
  semanticVersion: "0.0.0-qualification",
  createdAt: "2026-08-25T00:00:00.000Z",
  target,
  outputDirectory,
  evaluations,
  ...overrides
});

const walk = async (root, current = root) => {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, path)));
    else files.push({ path: relative(root, path).replaceAll("\\", "/"), bytes: await readFile(path) });
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
};

const expectedKinds = new Set([
  "node-runtime",
  "core-code",
  "schema",
  "migration",
  "policy",
  "cedar-wasm",
  "sqlite-native",
  "driver",
  "connector",
  "skill",
  "license",
  "sbom",
  "provenance",
  "evaluation",
  "launcher"
]);

test("the real target builder binds exact revision, host assets, and all supply-chain evidence", async () => {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-t76-build-"));
  const output = join(parent, "candidate");
  try {
    const result = await buildReproducibleT76Target(options(output));
    assert.equal(result.revision, replica.revision);
    assert.equal(result.target.platform, target.platform);
    assert.equal(result.target.arch, target.arch);
    assert.match(result.bundle.releaseDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.deepEqual(new Set(result.bundle.components.map((component) => component.kind)), expectedKinds);
    assert.equal(result.evidence.length, 4);
    assert.deepEqual(result.evidence.map((document) => document.kind).sort(), [
      "evaluation",
      "license",
      "provenance",
      "sbom"
    ]);
    assert.equal(await stat(join(output, "input-root")).catch(() => undefined), undefined);
    // The sealed launcher is the deterministic bundle of its tracked closure
    // entry, never the development shim sealed verbatim: the shim imports
    // `../src/main.ts`, which does not resolve in a staged release layout
    // (tests/build/sealed-launcher-closure.test.mjs proves both halves).
    const bundledLauncher = await bundleSealedLauncher({
      repository: replica.repository,
      componentId: "launcher:vestra",
      semanticVersion: "0.0.0-qualification",
      nodeVersion: target.nodeVersion
    });
    const launcher = result.bundle.components.find((component) => component.componentId === "launcher:vestra");
    assert.equal(launcher.contentDigest, `sha256:${createHash("sha256").update(bundledLauncher).digest("hex")}`);
    const trackedShim = await readFile(join(replica.repository, "apps", "vestra-cli", "bin", "vestra.mjs"));
    assert.notEqual(launcher.contentDigest, `sha256:${createHash("sha256").update(trackedShim).digest("hex")}`);
    // The closure entries the bundle is compiled from are sealed as sources.
    assert.ok(
      result.bundle.components.some(
        (component) => component.logicalPath === "components/apps/vestra-cli/closure/vestra-entry.ts"
      )
    );
    // The sealed runtime carries the executable extension exactly on the one
    // platform whose process creation requires it: Windows resolves image
    // names through PATHEXT, so identical bytes spawn as `node.exe` and
    // ENOENT as extensionless `node`. Each fleet leg asserts its own host's
    // naming, which is what makes this behavioral where it matters.
    const runtime = result.bundle.components.find((component) => component.kind === "node-runtime");
    assert.equal(runtime.logicalPath, process.platform === "win32" ? "runtime/node.exe" : "runtime/node");
    const bundleBytes = await readFile(join(output, "bundle.json"), "utf8");
    assert.equal(bundleBytes, canonicalizeJsonV2(result.bundle));
    const buildInfo = JSON.parse(await readFile(join(output, "build-info.json"), "utf8"));
    assert.equal(buildInfo.revision, replica.revision);
    assert.equal(Object.hasOwn(buildInfo, "repositoryRoot"), false);
    assert.equal(buildInfo.target.nodeVersion, process.version.slice(1));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the same exact inputs produce byte-identical target output", async () => {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-t76-build-determinism-"));
  const first = join(parent, "first");
  const second = join(parent, "second");
  try {
    const one = await buildReproducibleT76Target(options(first));
    // An untracked byproduct beside a faithful tree (a CI output directory,
    // a gate evidence file) must neither refuse the build nor reach it: the
    // byte-identity assertion below is what proves it cannot leak.
    const byproduct = join(replica.repository, "ci-byproduct.txt");
    await writeFile(byproduct, "untracked byproduct\n");
    let two;
    try {
      two = await buildReproducibleT76Target(options(second));
    } finally {
      await rm(byproduct, { force: true });
    }
    assert.equal(two.bundle.releaseDigest, one.bundle.releaseDigest);
    const firstFiles = await walk(first);
    const secondFiles = await walk(second);
    assert.deepEqual(
      secondFiles.map(({ path }) => path),
      firstFiles.map(({ path }) => path)
    );
    for (const [index, file] of firstFiles.entries()) assert.deepEqual(secondFiles[index].bytes, file.bytes, file.path);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("the builder refuses revision, tree, target, and evaluation drift before emitting a candidate", async () => {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-t76-build-reject-"));
  try {
    await assert.rejects(
      buildReproducibleT76Target(options(join(parent, "revision"), { revision: "a".repeat(40) })),
      (error) => error.code === "VES_T76_BUILD_REVISION_MISMATCH"
    );
    // A modified TRACKED file at the right revision is still not the sealed
    // revision's content, and the launcher bundles compile from that tree.
    // Untracked byproducts are tolerated (the determinism test proves they
    // cannot leak into the output), so the drift here edits a tracked source
    // that feeds the bundle, and the refusal must name it.
    const driftFile = join(replica.repository, "apps", "vestra-cli", "closure", "vestra-entry.ts");
    const driftOriginal = await readFile(driftFile);
    await writeFile(driftFile, Buffer.concat([driftOriginal, Buffer.from("// drift\n")]));
    try {
      await assert.rejects(buildReproducibleT76Target(options(join(parent, "dirty"))), (error) => {
        assert.equal(error.code, "VES_T76_BUILD_TREE_DIRTY");
        assert.match(error.message, /vestra-entry[.]ts/u);
        return true;
      });
    } finally {
      await writeFile(driftFile, driftOriginal);
    }
    await assert.rejects(
      buildReproducibleT76Target(
        options(join(parent, "target"), { target: { ...target, arch: target.arch === "x64" ? "arm64" : "x64" } })
      ),
      (error) => error.code === "VES_T76_BUILD_TARGET_MISMATCH"
    );
    await assert.rejects(
      buildReproducibleT76Target(options(join(parent, "evaluation"), { evaluations: evaluations.slice(0, 4) })),
      (error) => error.code === "VES_T76_BUILD_EVALUATION_INCOMPLETE"
    );
    await assert.rejects(
      buildReproducibleT76Target(
        options(join(parent, "survivor"), {
          evaluations: evaluations.map((evaluation) => ({
            ...evaluation,
            survivingMutants: evaluation.profile === "full" ? 1 : 0
          }))
        })
      ),
      (error) => error.code === "VES_T76_BUILD_EVALUATION_NOT_READY"
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
