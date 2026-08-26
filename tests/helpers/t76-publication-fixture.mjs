// A disposable five-target T76 candidate closure laid out exactly the way the
// candidate-build workflow's artifacts land after download: one directory per
// target holding `target-build-evidence.json` and a `t76-target-output/` tree,
// plus the reconciled `t76-target-index.json`.
//
// Every byte here is ephemeral and lives under `mkdtemp(tmpdir())`. The signing
// keys are generated per call and are test-only; no tracked file carries key
// material, a real revision, or a machine-local path.

import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { buildHermeticDistributionBundle } from "../../packages/distribution/src/index.ts";

export const PUBLICATION_REVISION = "b3f1c0d9e8a72645130fbc9a8d7e6f5041b2c3d4";
export const PRIOR_PUBLICATION_REVISION = "5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b";
export const PUBLICATION_RELEASE_ID = "release:verchestra:1.0.0:fixture";
export const PUBLICATION_SEMANTIC_VERSION = "1.0.0";
export const PUBLICATION_EXPIRES = "2035-01-01T00:00:00.000Z";
export const PUBLICATION_BASE_URL = "https://releases.example.invalid/verchestra/";

export const PUBLICATION_TARGETS = Object.freeze([
  Object.freeze({ platform: "darwin", arch: "arm64", nodeVersion: "24.14.0" }),
  Object.freeze({ platform: "darwin", arch: "x64", nodeVersion: "24.14.0" }),
  Object.freeze({ platform: "linux", arch: "arm64", nodeVersion: "24.14.0" }),
  Object.freeze({ platform: "linux", arch: "x64", nodeVersion: "24.14.0" }),
  Object.freeze({ platform: "win32", arch: "x64", nodeVersion: "24.14.0" })
]);

// A real candidate's component paths run three to seven segments deep, and the
// tuf-js delegation matcher requires equal segment counts, so the closure
// carries genuinely nested paths — not only the flat two-segment shape — to
// exercise the exact-path delegation derivation at realistic depth.
const COMPONENT_SPEC = Object.freeze([
  ["node-runtime", "runtime:node", "runtime/node"],
  ["core-code", "core:verchestra", "components/core-verchestra"],
  ["core-code", "core:packages-core", "components/packages/core/src/index.ts"],
  ["schema", "schemas:contracts", "components/schemas/contracts/execution-package.schema.json"],
  ["migration", "migrations:runtime", "components/migrations-runtime"],
  ["policy", "policy:cedar", "components/policy-cedar"],
  ["cedar-wasm", "wasm:cedar", "native/cedar-wasm.wasm"],
  ["sqlite-native", "native:sqlite", "native/sqlite-vec"],
  ["driver", "driver:claude", "components/driver-claude"],
  ["connector", "connector:jira", "components/connector-jira"],
  ["skill", "skill:tlc", "components/skill-tlc"],
  ["license", "license:product", "licenses/product.txt"],
  ["sbom", "sbom:cyclonedx", "evidence/sbom.cdx.json"],
  ["provenance", "provenance:build", "evidence/provenance.intoto.jsonl"],
  ["evaluation", "evaluation:release", "evidence/evaluation.json"],
  ["launcher", "launcher:vestra", "bin/vestra.mjs"],
  ["launcher", "launcher:verchestra", "bin/verchestra.mjs"]
]);

const EVIDENCE_KINDS = new Set(["license", "sbom", "provenance", "evaluation"]);
const TARGET_KINDS = new Set(["node-runtime", "sqlite-native", "launcher"]);

const roots = [];

export const targetKey = (target) => `${target.platform}-${target.arch}`;
export const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = (value) => `${canonicalizeJsonV2(value)}\n`;

/** A deterministic Ed25519 test key encoded exactly the way the secret is. */
export function testSigningKeyBase64() {
  const pair = generateKeyPairSync("ed25519");
  return pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

const componentBytesFor = (target, componentId, payloadSalt = "") =>
  Buffer.from(`payload:${payloadSalt}${targetKey(target)}:${componentId}`, "utf8");

const componentFor = (target, [kind, componentId, logicalPath], releaseId, payloadSalt) => {
  const bytes = componentBytesFor(target, componentId, payloadSalt);
  const targeted = TARGET_KINDS.has(kind);
  return {
    componentId,
    kind,
    releaseId,
    platform: targeted ? target.platform : "any",
    arch: targeted ? target.arch : "any",
    logicalPath,
    contentDigest: sha(bytes),
    sizeBytes: bytes.byteLength,
    licenseRefs: EVIDENCE_KINDS.has(kind) ? [] : ["license:product"],
    attestationRefs: EVIDENCE_KINDS.has(kind) ? [] : ["provenance:build", "evaluation:release"],
    executable: kind === "node-runtime" || kind === "launcher"
  };
};

export function bundleForTarget(target, options = {}) {
  const releaseId = options.releaseId ?? PUBLICATION_RELEASE_ID;
  return buildHermeticDistributionBundle({
    schemaVersion: 1,
    releaseId,
    semanticVersion: options.semanticVersion ?? PUBLICATION_SEMANTIC_VERSION,
    createdAt: "2026-08-25T00:00:00.000Z",
    target,
    runtimeResolver: false,
    components: COMPONENT_SPEC.map((spec) => componentFor(target, spec, releaseId, options.payloadSalt ?? ""))
  });
}

const buildInfoFor = (bundle, revision) => ({
  schemaVersion: 1,
  deterministic: true,
  revision,
  releaseId: bundle.releaseId,
  semanticVersion: bundle.semanticVersion,
  target: bundle.target,
  evidence: bundle.components
    .filter((component) => EVIDENCE_KINDS.has(component.kind))
    .map(({ kind, logicalPath, contentDigest, sizeBytes }) => ({ kind, logicalPath, contentDigest, sizeBytes }))
});

const evidenceFor = (bundle, buildInfo, revision) => ({
  schemaVersion: 1,
  revision,
  releaseId: bundle.releaseId,
  semanticVersion: bundle.semanticVersion,
  target: bundle.target,
  releaseDigest: bundle.releaseDigest,
  componentCount: bundle.components.length,
  gateEvidenceDigest: sha(`gate-evaluations:${targetKey(bundle.target)}`),
  buildInfoDigest: sha(canonicalizeJsonV2(buildInfo))
});

const writeTargetOutput = async (directory, bundle, buildInfo, target, payloadSalt) => {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "bundle.json"), canonical(bundle));
  await writeFile(join(directory, "build-info.json"), canonical(buildInfo));
  await writeFile(
    join(directory, "component-manifest.json"),
    canonical({
      schemaVersion: 1,
      components: bundle.components.map(({ componentId, kind, logicalPath, contentDigest, sizeBytes }) => ({
        componentId,
        kind,
        logicalPath,
        contentDigest,
        sizeBytes
      }))
    })
  );
  for (const component of bundle.components) {
    const path = join(directory, "payload", ...component.logicalPath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, componentBytesFor(target, component.componentId, payloadSalt));
  }
};

const writeTarget = async (root, target, options) => {
  const payloadSalt = options.payloadSalt ?? "";
  const bundle = bundleForTarget(target, { payloadSalt, ...(options.bundleOverrides?.[targetKey(target)] ?? {}) });
  const revision = options.revisionOverrides?.[targetKey(target)] ?? options.revision;
  const buildInfo = buildInfoFor(bundle, revision);
  const directory = join(root, `t76-target-${targetKey(target)}-11223344`);
  await mkdir(directory, { recursive: true });
  const evidence = evidenceFor(bundle, buildInfo, revision);
  await writeFile(join(directory, "target-build-evidence.json"), canonical(evidence));
  await writeFile(join(directory, "gate-evaluations.json"), canonical([]));
  await writeTargetOutput(join(directory, "t76-target-output"), bundle, buildInfo, target, payloadSalt);
  return { bundle, evidence, directory };
};

/**
 * Materializes a candidate closure on disk.
 *
 * `options.omitTargets` drops targets from both the index and the artifacts;
 * `options.bundleOverrides` and `options.revisionOverrides` make one target
 * disagree with the rest; `options.payloadSalt` derives a closure with
 * entirely distinct payload bytes and therefore distinct release digests.
 * `tamperPayload` rewrites one payload after sealing.
 */
export async function candidateClosure(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t76-publish-"));
  roots.push(root);
  const revision = options.revision ?? PUBLICATION_REVISION;
  const targetsDirectory = join(root, "targets");
  await mkdir(targetsDirectory, { recursive: true });
  const omitted = new Set(options.omitTargets ?? []);
  const selected = PUBLICATION_TARGETS.filter((target) => !omitted.has(targetKey(target)));
  const written = [];
  for (const target of selected) written.push(await writeTarget(targetsDirectory, target, { ...options, revision }));
  const entries = written.map((item) => item.evidence);
  const indexDigest = sha(canonicalizeJsonV2(entries));
  const indexPath = join(root, "t76-target-index.json");
  await writeFile(
    indexPath,
    canonical({
      schemaVersion: 1,
      revision,
      targets: entries,
      digest: indexDigest
    })
  );
  return {
    root,
    indexPath,
    indexDigest,
    targetsDirectory,
    revision,
    outputDirectory: join(root, "publication-output"),
    targets: written
  };
}

/**
 * A sealed PRIOR candidate closure: a different revision and entirely distinct
 * payload bytes, so every per-target release digest differs from the current
 * closure's. Its reconciled index is what `--rollback-index` consumes, and the
 * per-key release digests plus the index digest are exposed so tests can
 * assert the emitted rollback proof byte for byte.
 */
export async function priorCandidateClosure(options = {}) {
  const closure = await candidateClosure({
    revision: PRIOR_PUBLICATION_REVISION,
    payloadSalt: "prior-release:",
    ...options
  });
  const releaseDigests = Object.fromEntries(
    closure.targets.map((item) => [targetKey(item.bundle.target), item.evidence.releaseDigest])
  );
  return { ...closure, releaseDigests };
}

/** Overwrites one sealed payload byte so the digest check must reject it. */
export async function tamperPayload(closure, key, componentId) {
  const directory = join(closure.targetsDirectory, `t76-target-${key}-11223344`, "t76-target-output", "payload");
  const target = closure.targets.find((item) => targetKey(item.bundle.target) === key);
  const component = target.bundle.components.find((item) => item.componentId === componentId);
  await writeFile(join(directory, ...component.logicalPath.split("/")), "tampered");
}

export async function disposePublicationFixtures() {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
}
