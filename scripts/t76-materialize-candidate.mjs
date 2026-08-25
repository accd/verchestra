import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";
import {
  buildReleaseCandidate,
  verifyHermeticDistributionBundle,
  verifyReleaseCandidate
} from "../packages/distribution/src/index.ts";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const REVISION = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$/u;
const TARGET_KEYS = Object.freeze(["platform", "arch", "nodeVersion"]);
const BUILD_INFO_KEYS = Object.freeze([
  "schemaVersion",
  "deterministic",
  "revision",
  "releaseId",
  "semanticVersion",
  "target",
  "evidence"
]);
const COMPONENT_MANIFEST_KEYS = Object.freeze(["schemaVersion", "components"]);
const COMPONENT_KEYS = Object.freeze(["componentId", "kind", "logicalPath", "contentDigest", "sizeBytes"]);

const compareCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

export class T76CandidateError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "T76CandidateError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new T76CandidateError(code, message, cause === undefined ? undefined : { cause });
};

const record = (value, label) => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail("VES_T76_CANDIDATE_INPUT_INVALID", `${label} must be an object`);
  return value;
};

const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    fail("VES_T76_CANDIDATE_INPUT_INVALID", `${label} has unexpected fields`);
};

const digest = (value, label) => {
  if (typeof value !== "string" || !DIGEST.test(value)) fail("VES_T76_CANDIDATE_INPUT_INVALID", `${label} is invalid`);
  return value;
};

const safeId = (value, label) => {
  if (typeof value !== "string" || !SAFE_ID.test(value)) fail("VES_T76_CANDIDATE_INPUT_INVALID", `${label} is invalid`);
  return value;
};

const safeRelative = (value, label) => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((part) => part.length === 0 || part === "." || part === "..")
  )
    fail("VES_T76_CANDIDATE_PATH_INVALID", `${label} is not a safe relative path`);
  return value;
};

const assertInside = (root, candidate) => {
  const child = relative(resolve(root), resolve(candidate));
  if (child.length === 0 || child === ".." || child.startsWith(`..${sep}`))
    fail("VES_T76_CANDIDATE_PATH_INVALID", "candidate path escapes its root");
};

const canonicalJson = async (path, label) => {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    fail("VES_T76_CANDIDATE_INPUT_MISSING", `${label} cannot be read`, error);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("VES_T76_CANDIDATE_INPUT_INVALID", `${label} is not JSON`, error);
  }
  if (canonicalizeJsonV2(value) !== bytes.toString("utf8").trim())
    fail("VES_T76_CANDIDATE_INPUT_INVALID", `${label} is not canonical JSON`);
  return value;
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const validateTarget = (value, bundle) => {
  const target = record(value, "build target");
  exactKeys(target, TARGET_KEYS, "build target");
  if (canonicalizeJsonV2(target) !== canonicalizeJsonV2(bundle.target))
    fail("VES_T76_CANDIDATE_BUNDLE_MISMATCH", "build target differs from the verified bundle");
};

const validateBuildInfo = (value, bundle, revision) => {
  const info = record(value, "build-info");
  exactKeys(info, BUILD_INFO_KEYS, "build-info");
  if (info.schemaVersion !== 1 || info.deterministic !== true)
    fail("VES_T76_CANDIDATE_INPUT_INVALID", "build-info is not a deterministic schema-v1 record");
  if (
    info.revision !== revision ||
    info.releaseId !== bundle.releaseId ||
    info.semanticVersion !== bundle.semanticVersion
  )
    fail("VES_T76_CANDIDATE_BUNDLE_MISMATCH", "build-info identity differs from the verified bundle");
  validateTarget(info.target, bundle);
  if (!Array.isArray(info.evidence)) fail("VES_T76_CANDIDATE_INPUT_INVALID", "build-info evidence is invalid");
  return info;
};

const validateManifest = (value, bundle) => {
  const manifest = record(value, "component-manifest");
  exactKeys(manifest, COMPONENT_MANIFEST_KEYS, "component-manifest");
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.components))
    fail("VES_T76_CANDIDATE_INPUT_INVALID", "component-manifest is invalid");
  const expected = new Map(
    bundle.components.map((component) => [
      component.componentId,
      {
        componentId: component.componentId,
        kind: component.kind,
        logicalPath: component.logicalPath,
        contentDigest: component.contentDigest,
        sizeBytes: component.sizeBytes
      }
    ])
  );
  if (manifest.components.length !== expected.size)
    fail("VES_T76_CANDIDATE_COMPONENT_MISMATCH", "component-manifest is incomplete");
  for (const [index, entry] of manifest.components.entries()) {
    const item = record(entry, `component-manifest entry ${index}`);
    exactKeys(item, COMPONENT_KEYS, `component-manifest entry ${index}`);
    const reference = expected.get(item.componentId);
    if (reference === undefined || canonicalizeJsonV2(reference) !== canonicalizeJsonV2(item))
      fail("VES_T76_CANDIDATE_COMPONENT_MISMATCH", `component-manifest entry ${index} differs from the bundle`);
  }
};

const verifyPayloads = async (buildDirectory, bundle) => {
  const payloadRoot = join(buildDirectory, "payload");
  for (const component of bundle.components) {
    const logicalPath = safeRelative(component.logicalPath, "component logicalPath");
    const path = join(payloadRoot, ...logicalPath.split("/"));
    assertInside(payloadRoot, path);
    let stat;
    try {
      stat = await lstat(path);
    } catch (error) {
      fail("VES_T76_CANDIDATE_INPUT_MISSING", `payload for ${component.componentId} is missing`, error);
    }
    if (!stat.isFile())
      fail("VES_T76_CANDIDATE_INPUT_INVALID", `payload for ${component.componentId} is not a regular file`);
    const bytes = await readFile(path);
    if (bytes.byteLength !== component.sizeBytes || sha256(bytes) !== component.contentDigest)
      fail("VES_T76_CANDIDATE_COMPONENT_MISMATCH", `payload for ${component.componentId} differs from the bundle`);
  }
};

const validateOptions = (value) => {
  const input = record(value, "candidate options");
  if (typeof input.buildDirectory !== "string" || input.buildDirectory.length === 0)
    fail("VES_T76_CANDIDATE_INPUT_INVALID", "buildDirectory is invalid");
  if (typeof input.outputPath !== "string" || input.outputPath.length === 0)
    fail("VES_T76_CANDIDATE_INPUT_INVALID", "outputPath is invalid");
  if (typeof input.viewsPath !== "string" || input.viewsPath.length === 0)
    fail("VES_T76_CANDIDATE_INPUT_INVALID", "viewsPath is invalid");
  if (typeof input.rollbackPath !== "string" || input.rollbackPath.length === 0)
    fail("VES_T76_CANDIDATE_INPUT_INVALID", "rollbackPath is invalid");
  const buildDirectory = resolve(input.buildDirectory);
  const outputPath = resolve(input.outputPath);
  const candidateId = safeId(input.candidateId, "candidateId");
  if (!REVISION.test(input.revision)) fail("VES_T76_CANDIDATE_INPUT_INVALID", "revision is invalid");
  return Object.freeze({
    buildDirectory,
    outputPath,
    viewsPath: resolve(input.viewsPath),
    rollbackPath: resolve(input.rollbackPath),
    candidateId,
    revision: input.revision
  });
};

export async function materializeT76Candidate(rawOptions) {
  const options = validateOptions(rawOptions);
  const bundle = verifyHermeticDistributionBundle(
    await canonicalJson(join(options.buildDirectory, "bundle.json"), "bundle.json")
  );
  const buildInfo = validateBuildInfo(
    await canonicalJson(join(options.buildDirectory, "build-info.json"), "build-info.json"),
    bundle,
    options.revision
  );
  validateManifest(
    await canonicalJson(join(options.buildDirectory, "component-manifest.json"), "component-manifest.json"),
    bundle
  );
  await verifyPayloads(options.buildDirectory, bundle);
  const views = await canonicalJson(options.viewsPath, "release views");
  const rollback = await canonicalJson(options.rollbackPath, "rollback proof");
  const evidence = buildInfo.evidence.map((item, index) => {
    const entry = record(item, `build-info evidence ${index}`);
    exactKeys(entry, ["kind", "logicalPath", "contentDigest", "sizeBytes"], `build-info evidence ${index}`);
    return {
      kind: entry.kind,
      digest: digest(entry.contentDigest, `build-info evidence ${index} digest`),
      sizeBytes: entry.sizeBytes
    };
  });
  const candidate = buildReleaseCandidate({
    schemaVersion: 1,
    candidateId: options.candidateId,
    revision: options.revision,
    semanticVersion: bundle.semanticVersion,
    bundle,
    views,
    evidence,
    rollback
  });
  const verified = verifyReleaseCandidate(candidate);
  await mkdir(dirname(options.outputPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(options.outputPath, `${canonicalizeJsonV2(verified)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    fail("VES_T76_CANDIDATE_OUTPUT_EXISTS", "candidate output cannot be written", error);
  }
  return verified;
}

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const runCli = async () => {
  const args = process.argv.slice(2);
  const candidate = await materializeT76Candidate({
    buildDirectory: argument(args, "--build"),
    outputPath: argument(args, "--out"),
    viewsPath: resolve(argument(args, "--views")),
    rollbackPath: resolve(argument(args, "--rollback")),
    candidateId: argument(args, "--candidate-id"),
    revision: argument(args, "--revision")
  });
  console.log(`T76 candidate materialized: ${candidate.candidateDigest}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
