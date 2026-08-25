import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  buildHermeticDistributionBundle,
  type BundleArch,
  type BundlePlatform,
  type HermeticComponentKind,
  type HermeticBundleComponent,
  type HermeticDistributionBundle
} from "./hermetic-bundle.ts";

const DIGEST = (bytes: Uint8Array): string => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** A source file descriptor used only while assembling a release bundle. */
export interface ArtifactInputSource {
  readonly componentId: string;
  readonly kind: HermeticComponentKind;
  readonly platform: BundlePlatform | "any";
  readonly arch: BundleArch | "any";
  readonly logicalPath: string;
  /** A forward-slash relative path below `rootDirectory`; never emitted. */
  readonly sourcePath: string;
  readonly licenseRefs: readonly string[];
  readonly attestationRefs: readonly string[];
  readonly executable: boolean;
}

export interface FileBackedBundleInput {
  readonly schemaVersion: 1;
  readonly releaseId: string;
  readonly semanticVersion: string;
  readonly createdAt: string;
  readonly target: Readonly<{ platform: BundlePlatform; arch: BundleArch; nodeVersion: string }>;
  readonly runtimeResolver: false;
  readonly rootDirectory: string;
  readonly sources: readonly ArtifactInputSource[];
}

export interface CollectedArtifactInput {
  readonly component: HermeticBundleComponent;
  readonly bytes: Uint8Array;
}

export class ArtifactInputError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactInputError";
    this.code = code;
  }
}

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new ArtifactInputError(code, message, cause === undefined ? undefined : { cause });
};

const isInside = (root: string, candidate: string): boolean => {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

const relativeSourcePath = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\"))
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", "sourcePath must be a non-empty forward-slash path");
  const sourcePath = value as string;
  if (isAbsolute(sourcePath)) fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", "sourcePath must be relative");
  const segments = sourcePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".."))
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", "sourcePath contains an unsafe segment");
  return sourcePath;
};

const sourceMetadata = (source: ArtifactInputSource): Record<string, unknown> => ({
  componentId: source.componentId,
  kind: source.kind,
  platform: source.platform,
  arch: source.arch,
  logicalPath: source.logicalPath,
  licenseRefs: source.licenseRefs,
  attestationRefs: source.attestationRefs,
  executable: source.executable
});

const validateSource = (source: ArtifactInputSource, index: number): void => {
  if (source === null || typeof source !== "object")
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} must be an object`);
  const stringFields = ["componentId", "kind", "platform", "arch", "logicalPath"] as const;
  if (stringFields.some((field) => typeof source[field] !== "string"))
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} metadata is malformed`);
  if (typeof source.executable !== "boolean")
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} metadata is malformed`);
  if (!Array.isArray(source.licenseRefs))
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} metadata is malformed`);
  if (!Array.isArray(source.attestationRefs))
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} metadata is malformed`);
  relativeSourcePath(source.sourcePath);
};

const assertUnique = (seen: ReadonlySet<string>, value: string, index: number): void => {
  if (seen.has(value))
    fail("VES_DISTRIBUTION_ARTIFACT_DUPLICATE", `source ${index} duplicates an existing component identity`);
};

const validateSources = (sources: readonly ArtifactInputSource[]): void => {
  const componentIds = new Set<string>();
  const logicalPaths = new Set<string>();
  const sourcePaths = new Set<string>();
  for (const [index, source] of sources.entries()) {
    validateSource(source, index);
    const normalizedSourcePath = relativeSourcePath(source.sourcePath);
    assertUnique(componentIds, source.componentId, index);
    assertUnique(logicalPaths, source.logicalPath, index);
    assertUnique(sourcePaths, normalizedSourcePath, index);
    componentIds.add(source.componentId);
    logicalPaths.add(source.logicalPath);
    sourcePaths.add(normalizedSourcePath);
  }
};

const inspectRegularFile = async (candidate: string, index: number) => {
  const metadata = await lstat(candidate).catch((error: unknown) =>
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_MISSING", `source ${index} does not exist`, error)
  );
  if (metadata.isSymbolicLink())
    fail("VES_DISTRIBUTION_ARTIFACT_SYMLINK", `source ${index} must not be a symbolic link`);
  if (!metadata.isFile()) fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} is not a regular file`);
};

const resolveWithinRoot = async (root: string, candidate: string, index: number): Promise<string> => {
  const resolved = await realpath(candidate).catch((error: unknown) =>
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_MISSING", `source ${index} cannot be resolved`, error)
  );
  if (!isInside(root, resolved))
    fail("VES_DISTRIBUTION_ARTIFACT_SYMLINK", `source ${index} resolves outside the build root`);
  return resolved;
};

const readSourceBytes = async (resolved: string, index: number): Promise<Buffer> =>
  readFile(resolved).catch((error: unknown) =>
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_MISSING", `source ${index} cannot be read`, error)
  );

const readArtifact = async (
  root: string,
  source: ArtifactInputSource,
  index: number
): Promise<CollectedArtifactInput> => {
  const sourcePath = relativeSourcePath(source.sourcePath);
  const candidate = resolve(root, ...sourcePath.split("/"));
  if (!isInside(root, candidate))
    fail("VES_DISTRIBUTION_ARTIFACT_SOURCE_INVALID", `source ${index} escapes the build root`);
  await inspectRegularFile(candidate, index);
  const resolved = await resolveWithinRoot(root, candidate, index);
  const bytes = await readSourceBytes(resolved, index);
  return Object.freeze({
    component: Object.freeze({
      ...sourceMetadata(source),
      releaseId: "",
      contentDigest: DIGEST(bytes),
      sizeBytes: bytes.byteLength
    }) as HermeticBundleComponent,
    bytes: new Uint8Array(bytes)
  });
};

/**
 * Read the isolated build root once and retain the exact bytes alongside
 * their portable component identities. Source paths and the root are never
 * returned, so callers can safely pass the result to evidence or TUF stages.
 */
export async function collectHermeticArtifactInputsFromFiles(
  input: FileBackedBundleInput
): Promise<readonly CollectedArtifactInput[]> {
  if (input === null || typeof input !== "object")
    fail("VES_DISTRIBUTION_ARTIFACT_INPUT_INVALID", "file-backed bundle input must be an object");
  if (typeof input.rootDirectory !== "string" || input.rootDirectory.length === 0)
    fail("VES_DISTRIBUTION_ARTIFACT_ROOT_INVALID", "rootDirectory is required");
  if (!Array.isArray(input.sources) || input.sources.length === 0)
    fail("VES_DISTRIBUTION_ARTIFACT_INPUT_INVALID", "sources are required");
  let root: string;
  try {
    root = await realpath(input.rootDirectory);
  } catch (error) {
    fail("VES_DISTRIBUTION_ARTIFACT_ROOT_INVALID", "rootDirectory does not exist", error);
  }
  validateSources(input.sources);
  const artifacts = await Promise.all(input.sources.map((source, index) => readArtifact(root, source, index)));
  return Object.freeze(
    artifacts.map((artifact) =>
      Object.freeze({
        component: Object.freeze({ ...artifact.component, releaseId: input.releaseId }) as HermeticBundleComponent,
        bytes: new Uint8Array(artifact.bytes)
      })
    )
  );
}

/**
 * Read an isolated build directory and turn its bytes into the verified
 * hermetic bundle contract. The returned bundle contains no machine paths or
 * file contents; it carries only logical paths, byte digests, and sizes.
 */
export async function buildHermeticDistributionBundleFromFiles(
  input: FileBackedBundleInput
): Promise<HermeticDistributionBundle> {
  const artifacts = await collectHermeticArtifactInputsFromFiles(input);
  return buildHermeticDistributionBundle({
    schemaVersion: input.schemaVersion,
    releaseId: input.releaseId,
    semanticVersion: input.semanticVersion,
    createdAt: input.createdAt,
    target: input.target,
    runtimeResolver: input.runtimeResolver,
    components: artifacts.map(({ component }) => component)
  });
}
