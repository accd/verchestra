import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { buildReproducibleT76Target } from "../../scripts/t76-build-candidate.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
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

const options = (outputDirectory, overrides = {}) => ({
  repositoryRoot,
  revision,
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
    assert.equal(result.revision, revision);
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
    const trackedLauncher = execFileSync(
      "git",
      ["-C", repositoryRoot, "show", `${revision}:apps/vestra-cli/bin/vestra.mjs`],
      { encoding: "buffer" }
    );
    const launcher = result.bundle.components.find((component) => component.componentId === "launcher:vestra");
    assert.equal(launcher.contentDigest, `sha256:${createHash("sha256").update(trackedLauncher).digest("hex")}`);
    const bundleBytes = await readFile(join(output, "bundle.json"), "utf8");
    assert.equal(bundleBytes, canonicalizeJsonV2(result.bundle));
    const buildInfo = JSON.parse(await readFile(join(output, "build-info.json"), "utf8"));
    assert.equal(buildInfo.revision, revision);
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
    const two = await buildReproducibleT76Target(options(second));
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

test("the builder refuses revision, target, and evaluation drift before emitting a candidate", async () => {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-t76-build-reject-"));
  try {
    await assert.rejects(
      buildReproducibleT76Target(options(join(parent, "revision"), { revision: "a".repeat(40) })),
      (error) => error.code === "VES_T76_BUILD_REVISION_MISMATCH"
    );
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
