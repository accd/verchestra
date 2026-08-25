import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { buildHermeticDistributionBundle } from "../../packages/distribution/src/index.ts";
import { materializeT76Candidate } from "../../scripts/t76-materialize-candidate.mjs";
import { bundleInput, sha } from "../helpers/hermetic-bundle-fixture.mjs";

const canonical = (value) => `${canonicalizeJsonV2(value)}\n`;
const bytesFor = (component) => Buffer.from(`payload:${component.componentId}`);

const candidateInputs = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t76-candidate-"));
  const build = join(root, "build");
  await mkdir(join(build, "payload"), { recursive: true });
  const bundle = buildHermeticDistributionBundle(bundleInput());
  const components = bundle.components.map((component) => {
    const bytes = bytesFor(component);
    const contentDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return { ...component, contentDigest, sizeBytes: bytes.byteLength };
  });
  const actualBundle = buildHermeticDistributionBundle({ ...bundleInput(), components });
  for (const component of components) {
    const path = join(build, "payload", ...component.logicalPath.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytesFor(component));
  }
  await writeFile(join(build, "bundle.json"), canonical(actualBundle));
  await writeFile(
    join(build, "component-manifest.json"),
    canonical({
      schemaVersion: 1,
      components: components.map(({ componentId, kind, logicalPath, contentDigest, sizeBytes }) => ({
        componentId,
        kind,
        logicalPath,
        contentDigest,
        sizeBytes
      }))
    })
  );
  await writeFile(
    join(build, "build-info.json"),
    canonical({
      schemaVersion: 1,
      deterministic: true,
      revision: "a".repeat(40),
      releaseId: actualBundle.releaseId,
      semanticVersion: actualBundle.semanticVersion,
      target: actualBundle.target,
      evidence: components
        .filter((component) => ["license", "sbom", "provenance", "evaluation"].includes(component.kind))
        .map(({ kind, logicalPath, contentDigest, sizeBytes }) => ({ kind, logicalPath, contentDigest, sizeBytes }))
    })
  );
  const views = ["online", "mirror", "offline", "air-gapped"].map((mode) => ({
    mode,
    sourceId: `source:${mode}`,
    releaseDigest: actualBundle.releaseDigest,
    metadataDigest: sha(`${mode}:metadata`),
    targetDigest: sha(`${mode}:target`)
  }));
  const viewsPath = join(root, "views.json");
  const rollbackPath = join(root, "rollback.json");
  await writeFile(viewsPath, canonical(views));
  await writeFile(
    rollbackPath,
    canonical({ previousReleaseDigest: sha("previous"), verified: true, verificationDigest: sha("rollback") })
  );
  return { root, build, viewsPath, rollbackPath, bundle: actualBundle };
};

test("materializes a candidate from real bundle projections and payload bytes", async () => {
  const input = await candidateInputs();
  try {
    const output = join(input.root, "candidate.json");
    const candidate = await materializeT76Candidate({
      buildDirectory: input.build,
      outputPath: output,
      viewsPath: input.viewsPath,
      rollbackPath: input.rollbackPath,
      candidateId: "candidate:verchestra:1.0.0:win32-x64",
      revision: "a".repeat(40)
    });
    assert.equal(candidate.bundle.releaseDigest, input.bundle.releaseDigest);
    assert.match(candidate.candidateDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal((await readFile(output, "utf8")).includes(input.root), false);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test("rejects a payload mutation before writing a candidate", async () => {
  const input = await candidateInputs();
  try {
    const first = input.bundle.components[0];
    await writeFile(join(input.build, "payload", ...first.logicalPath.split("/")), "tampered");
    await assert.rejects(
      () =>
        materializeT76Candidate({
          buildDirectory: input.build,
          outputPath: join(input.root, "candidate.json"),
          viewsPath: input.viewsPath,
          rollbackPath: input.rollbackPath,
          candidateId: "candidate:verchestra:1.0.0:win32-x64",
          revision: "a".repeat(40)
        }),
      { code: "VES_T76_CANDIDATE_COMPONENT_MISMATCH" }
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

test("rejects an output overwrite and a self-referential rollback", async () => {
  const input = await candidateInputs();
  try {
    const output = join(input.root, "candidate.json");
    await writeFile(output, "existing");
    await assert.rejects(
      () =>
        materializeT76Candidate({
          buildDirectory: input.build,
          outputPath: output,
          viewsPath: input.viewsPath,
          rollbackPath: input.rollbackPath,
          candidateId: "candidate:verchestra:1.0.0:win32-x64",
          revision: "a".repeat(40)
        }),
      { code: "VES_T76_CANDIDATE_OUTPUT_EXISTS" }
    );
    await writeFile(
      input.rollbackPath,
      canonical({
        previousReleaseDigest: input.bundle.releaseDigest,
        verified: true,
        verificationDigest: sha("rollback")
      })
    );
    await assert.rejects(
      () =>
        materializeT76Candidate({
          buildDirectory: input.build,
          outputPath: join(input.root, "candidate-2.json"),
          viewsPath: input.viewsPath,
          rollbackPath: input.rollbackPath,
          candidateId: "candidate:verchestra:1.0.0:win32-x64",
          revision: "a".repeat(40)
        }),
      { code: "VES_RELEASE_CANDIDATE_ROLLBACK_INVALID" }
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});
