import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { Updater } from "tuf-js";
import { DownloadHTTPError } from "tuf-js/dist/error.js";
import type { Fetcher } from "tuf-js/dist/fetcher.js";

import {
  verifyHermeticDistributionBundle,
  type HermeticBundleComponent,
  type HermeticDistributionBundle
} from "./hermetic-bundle.ts";

const SAFE_SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$/u;
const SOURCE_MODES = new Set<DistributionSourceMode>(["online", "mirror", "offline", "air-gapped"]);
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;
const MAX_ROOT_ROTATIONS = 32;
const RESERVED_PATH = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export type DistributionSourceMode = "online" | "mirror" | "offline" | "air-gapped";

export interface DistributionSourceRead {
  readonly bytes: Uint8Array;
  readonly totalLength: number;
}

export interface DistributionSourcePort {
  readonly mode: DistributionSourceMode;
  readonly sourceId: string;
  readMetadata(path: string, maximumBytes: number): Promise<Uint8Array>;
  readTarget(path: string, offset: number, maximumBytes: number): Promise<DistributionSourceRead>;
}

export interface TufUpdateClientOptions {
  readonly trustRootDirectory: string;
  readonly stagingRoot: string;
  readonly trustedRoot: Uint8Array;
  readonly source: DistributionSourcePort;
  readonly chunkSize?: number;
}

export interface TufUpdateRequest {
  readonly platform: "win32" | "linux" | "darwin";
  readonly arch: "x64" | "arm64";
}

export interface StagedReleaseComponent {
  readonly componentId: string;
  readonly logicalPath: string;
  readonly contentDigest: string;
  readonly sizeBytes: number;
}

export interface TufStagedRelease {
  readonly schemaVersion: 1;
  readonly stageId: string;
  readonly releaseId: string;
  readonly releaseDigest: string;
  readonly platform: string;
  readonly arch: string;
  readonly sourceMode: DistributionSourceMode;
  readonly sourceId: string;
  readonly bundle: HermeticDistributionBundle;
  readonly components: readonly StagedReleaseComponent[];
  readonly activationAllowed: false;
}

export class TufUpdateError extends Error {
  readonly code: string;
  readonly activationAllowed = false;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TufUpdateError";
    this.code = code;
  }
}

type TargetInfo = NonNullable<Awaited<ReturnType<Updater["getTargetInfo"]>>>;

const fail = (code: string, message: string, cause?: unknown): never => {
  throw new TufUpdateError(code, message, cause === undefined ? undefined : { cause });
};

const validateSourceConfiguration = (mode: DistributionSourceMode, sourceId: string): void => {
  if (
    !SOURCE_MODES.has(mode) ||
    !SAFE_SOURCE_ID.test(sourceId) ||
    sourceId.includes("://") ||
    /@[^:]+:/u.test(sourceId)
  )
    fail("VES_TUF_SOURCE_INVALID", "distribution source identity or mode is invalid");
};

const sha256 = (value: Uint8Array | string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const mapError = (error: unknown): TufUpdateError => {
  if (error instanceof TufUpdateError) return error;
  const item = error as { readonly name?: string; readonly message?: string };
  const detail = `${item.name ?? ""} ${item.message ?? ""}`;
  if (item.name === "ExpiredMetadataError" || /expired/iu.test(detail))
    return new TufUpdateError("VES_TUF_EXPIRED", "TUF metadata is expired", { cause: error });
  if (
    item.name === "BadVersionError" ||
    item.name === "EqualVersionError" ||
    /rollback|version.*(?:less|lower|older)/iu.test(detail)
  )
    return new TufUpdateError("VES_TUF_ROLLBACK", "TUF metadata rollback was rejected", { cause: error });
  if (item.name === "UnsignedMetadataError" || /signature|threshold|signed by/iu.test(detail))
    return new TufUpdateError("VES_TUF_THRESHOLD", "TUF signature threshold was not met", { cause: error });
  if (/delegat/iu.test(detail))
    return new TufUpdateError("VES_TUF_DELEGATION_INVALID", "TUF delegated target resolution failed", {
      cause: error
    });
  if (/hash|length|integrity/iu.test(detail))
    return new TufUpdateError("VES_TUF_INTEGRITY", "TUF metadata or target integrity failed", { cause: error });
  if (/interrupt|invalid partial response|invalid chunk/iu.test(detail))
    return new TufUpdateError("VES_TUF_PARTIAL_DOWNLOAD", "TUF target download was interrupted", {
      cause: error
    });
  if (
    error instanceof DownloadHTTPError ||
    /not found|download|partial|unavailable|unable to load targets|\b404\b/iu.test(detail)
  )
    return new TufUpdateError("VES_TUF_PARTIAL_PUBLISH", "TUF repository is partially published", {
      cause: error
    });
  return new TufUpdateError("VES_TUF_INVALID", "TUF release resolution failed", { cause: error });
};

const frozenReceipt = (value: Omit<TufStagedRelease, "components"> & { components: StagedReleaseComponent[] }) =>
  Object.freeze({
    ...value,
    components: Object.freeze(value.components.map((entry) => Object.freeze({ ...entry })))
  });

const targetMetadataPath = (urlValue: string): string => {
  const url = new URL(urlValue);
  const parts = url.pathname.split("/").filter(Boolean);
  parts.shift();
  return decodeURIComponent(parts.join("/"));
};

class SourceFetcher implements Fetcher {
  readonly #source: DistributionSourcePort;

  constructor(source: DistributionSourcePort) {
    this.#source = source;
  }

  async downloadBytes(url: string, maximumLength: number): Promise<Buffer> {
    const path = targetMetadataPath(url);
    let raw: Uint8Array;
    try {
      raw = await this.#source.readMetadata(path, maximumLength);
    } catch (error) {
      if (error instanceof DownloadHTTPError) throw error;
      throw new DownloadHTTPError(`metadata unavailable: ${path}`, 404);
    }
    const bytes = Buffer.from(raw);
    if (bytes.length > maximumLength) throw new Error("metadata length exceeds maximum");
    return bytes;
  }

  async downloadFile<T>(url: string, maximumLength: number, handler: (file: string) => Promise<T>): Promise<T> {
    const path = targetMetadataPath(url);
    const temporaryRoot = join(process.env["TEMP"] ?? process.cwd(), `.vestra-tuf-${randomUUID()}`);
    const temporaryFile = join(temporaryRoot, "target");
    try {
      await mkdir(temporaryRoot, { recursive: false, mode: 0o700 });
      const bytes = await readWholeTarget(this.#source, path, maximumLength, DEFAULT_CHUNK_SIZE);
      await writeFile(temporaryFile, bytes, { mode: 0o600, flag: "wx" });
      return await handler(temporaryFile);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

const readWholeTarget = async (
  source: DistributionSourcePort,
  path: string,
  expectedLength: number,
  chunkSize: number
): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < expectedLength) {
    const result = await source.readTarget(path, offset, Math.min(chunkSize, expectedLength - offset));
    if (!Number.isSafeInteger(result.totalLength) || result.totalLength !== expectedLength)
      fail("VES_TUF_LENGTH_MISMATCH", "target length changed or differs from TUF metadata");
    const bytes = Buffer.from(result.bytes);
    if (bytes.length === 0 || bytes.length > Math.min(chunkSize, expectedLength - offset))
      fail("VES_TUF_PARTIAL_DOWNLOAD", "target source returned an invalid partial response");
    chunks.push(bytes);
    offset += bytes.length;
  }
  return Buffer.concat(chunks, expectedLength);
};

const parseConsistentSnapshot = async (metadataDirectory: string): Promise<boolean> => {
  const root = JSON.parse(await readFile(join(metadataDirectory, "root.json"), "utf8")) as {
    readonly signed?: { readonly consistent_snapshot?: unknown };
  };
  const value = root.signed?.consistent_snapshot;
  if (typeof value !== "boolean") fail("VES_TUF_INVALID", "trusted root omits consistent snapshot policy");
  return value as boolean;
};

const sourcePathFor = (target: TargetInfo, consistentSnapshot: boolean): string => {
  if (!consistentSnapshot) return target.path;
  const hash = target.hashes["sha256"];
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/u.test(hash))
    fail("VES_TUF_INTEGRITY", "target has no exact SHA-256 identity");
  const parsed = parse(target.path);
  return parsed.dir ? `${parsed.dir.replaceAll("\\", "/")}/${hash}.${parsed.base}` : `${hash}.${parsed.base}`;
};

const assertWithin = (root: string, candidate: string): void => {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  if (normalizedCandidate !== normalizedRoot && !normalizedCandidate.startsWith(`${normalizedRoot}${sep}`))
    fail("VES_TUF_STAGE_PATH_INVALID", "staging path escapes the release root");
};

const optionalStat = async (path: string) => {
  try {
    return await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};

const verifyFile = async (path: string, component: HermeticBundleComponent): Promise<boolean> => {
  const info = await optionalStat(path);
  if (!info?.isFile() || info.size !== component.sizeBytes) return false;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return `sha256:${hash.digest("hex")}` === component.contentDigest;
};

const ensureNoSymlink = async (path: string): Promise<void> => {
  try {
    if ((await lstat(path)).isSymbolicLink()) fail("VES_TUF_STAGE_PATH_INVALID", "staging path is a symbolic link");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const ensureDirectoryChain = async (root: string, target: string): Promise<void> => {
  assertWithin(root, target);
  await ensureNoSymlink(root);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const relative = resolve(target).slice(resolve(root).length).split(sep).filter(Boolean);
  let current = resolve(root);
  for (const segment of relative) {
    current = join(current, segment);
    await ensureNoSymlink(current);
    await mkdir(current, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      fail("VES_TUF_STAGE_PATH_INVALID", "staging directory chain is not a real directory");
  }
};

const repositoryPath = (value: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2048 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/u.test(value)
  )
    fail("VES_TUF_SOURCE_PATH_INVALID", "repository path is invalid");
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        RESERVED_PATH.test(segment) ||
        !/^[A-Za-z0-9._@+\-]+$/u.test(segment)
    )
  )
    fail("VES_TUF_SOURCE_PATH_INVALID", "repository path has an unsafe segment");
  return value;
};

const ensureReadChain = async (root: string, candidate: string): Promise<void> => {
  assertWithin(root, candidate);
  if ((await lstat(root)).isSymbolicLink()) fail("VES_TUF_SOURCE_PATH_INVALID", "repository root is a symbolic link");
  const relative = resolve(candidate).slice(resolve(root).length).split(sep).filter(Boolean);
  let current = resolve(root);
  for (const segment of relative) {
    current = join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) fail("VES_TUF_SOURCE_PATH_INVALID", "repository path is a symbolic link");
  }
};

export interface NodeFilesystemDistributionSourceOptions {
  readonly mode: "mirror" | "offline" | "air-gapped";
  readonly sourceId: string;
  readonly root: string;
}

export class NodeFilesystemDistributionSource implements DistributionSourcePort {
  readonly mode: "mirror" | "offline" | "air-gapped";
  readonly sourceId: string;
  readonly #root: string;

  constructor(options: NodeFilesystemDistributionSourceOptions) {
    validateSourceConfiguration(options.mode, options.sourceId);
    this.mode = options.mode;
    this.sourceId = options.sourceId;
    this.#root = resolve(options.root);
  }

  async #read(area: "metadata" | "targets", path: string, offset: number, maximumBytes: number) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0)
      fail("VES_TUF_SOURCE_READ_INVALID", "repository read bounds are invalid");
    const areaRoot = join(this.#root, area);
    const candidate = join(areaRoot, ...repositoryPath(path).split("/"));
    await ensureReadChain(this.#root, candidate);
    const handle = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) fail("VES_TUF_SOURCE_PATH_INVALID", "repository target is not a regular file");
      if (area === "metadata" && info.size > maximumBytes)
        fail("VES_TUF_SOURCE_LIMIT", "repository metadata exceeds its verified bound");
      const length = Math.min(maximumBytes, Math.max(0, info.size - offset));
      const bytes = Buffer.alloc(length);
      const result = await handle.read(bytes, 0, length, offset);
      return { bytes: bytes.subarray(0, result.bytesRead), totalLength: info.size };
    } finally {
      await handle.close();
    }
  }

  async readMetadata(path: string, maximumBytes: number): Promise<Uint8Array> {
    return (await this.#read("metadata", path, 0, maximumBytes)).bytes;
  }

  async readTarget(path: string, offset: number, maximumBytes: number): Promise<DistributionSourceRead> {
    return this.#read("targets", path, offset, maximumBytes);
  }
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpsDistributionSourceOptions {
  readonly mode: "online" | "mirror";
  readonly sourceId: string;
  readonly metadataBaseUrl: string;
  readonly targetBaseUrl: string;
  readonly fetch?: FetchLike;
}

const verifiedBaseUrl = (value: string): URL => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "")
    fail("VES_TUF_SOURCE_INVALID", "distribution source URL must be credential-free HTTPS");
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
};

const sourceUrl = (base: URL, path: string): URL =>
  new URL(repositoryPath(path).split("/").map(encodeURIComponent).join("/"), base);

const contentLength = (response: Response): number | undefined => {
  const raw = response.headers.get("content-length");
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0)
    fail("VES_TUF_SOURCE_HTTP_INVALID", "source returned an invalid content length");
  return value;
};

export class HttpsDistributionSource implements DistributionSourcePort {
  readonly mode: "online" | "mirror";
  readonly sourceId: string;
  readonly #metadataBaseUrl: URL;
  readonly #targetBaseUrl: URL;
  readonly #fetch: FetchLike;

  constructor(options: HttpsDistributionSourceOptions) {
    validateSourceConfiguration(options.mode, options.sourceId);
    this.mode = options.mode;
    this.sourceId = options.sourceId;
    this.#metadataBaseUrl = verifiedBaseUrl(options.metadataBaseUrl);
    this.#targetBaseUrl = verifiedBaseUrl(options.targetBaseUrl);
    this.#fetch = options.fetch ?? fetch;
  }

  async readMetadata(path: string, maximumBytes: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0)
      fail("VES_TUF_SOURCE_READ_INVALID", "metadata bound is invalid");
    const response = await this.#fetch(sourceUrl(this.#metadataBaseUrl, path), {
      method: "GET",
      redirect: "error"
    });
    if (response.status !== 200) fail("VES_TUF_SOURCE_HTTP", "metadata source did not return HTTP 200");
    const declared = contentLength(response);
    if (declared !== undefined && declared > maximumBytes)
      fail("VES_TUF_SOURCE_LIMIT", "remote metadata exceeds its verified bound");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maximumBytes || (declared !== undefined && declared !== bytes.length))
      fail("VES_TUF_SOURCE_LIMIT", "remote metadata length is invalid");
    return bytes;
  }

  async readTarget(path: string, offset: number, maximumBytes: number): Promise<DistributionSourceRead> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(maximumBytes) || maximumBytes <= 0)
      fail("VES_TUF_SOURCE_READ_INVALID", "target range is invalid");
    const last = offset + maximumBytes - 1;
    const response = await this.#fetch(sourceUrl(this.#targetBaseUrl, path), {
      method: "GET",
      redirect: "error",
      headers: { range: `bytes=${offset}-${last}` }
    });
    if (response.status !== 206) fail("VES_TUF_SOURCE_HTTP", "target source must honor an exact byte range");
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/u.exec(response.headers.get("content-range") ?? "");
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    const totalLength = Number(match?.[3]);
    if (
      match === null ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      !Number.isSafeInteger(totalLength) ||
      start !== offset ||
      end < start ||
      end > last ||
      totalLength <= end
    )
      fail("VES_TUF_SOURCE_HTTP_INVALID", "target source returned an invalid content range");
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== end - start + 1 || bytes.length > maximumBytes)
      fail("VES_TUF_SOURCE_HTTP_INVALID", "target response bytes contradict its range");
    return { bytes, totalLength };
  }
}

export class TufUpdateClient {
  readonly #metadataDirectory: string;
  readonly #stagingRoot: string;
  readonly #trustedRoot: Buffer;
  readonly #source: DistributionSourcePort;
  readonly #chunkSize: number;

  constructor(options: TufUpdateClientOptions) {
    validateSourceConfiguration(options.source.mode, options.source.sourceId);
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_SIZE)
      fail("VES_TUF_SOURCE_INVALID", "download chunk size is invalid");
    if (!(options.trustedRoot instanceof Uint8Array) || options.trustedRoot.byteLength === 0)
      fail("VES_TUF_TRUST_ROOT_INVALID", "trusted root bytes are required");
    this.#metadataDirectory = resolve(options.trustRootDirectory);
    this.#stagingRoot = resolve(options.stagingRoot);
    this.#trustedRoot = Buffer.from(options.trustedRoot);
    this.#source = options.source;
    this.#chunkSize = chunkSize;
  }

  async #bootstrapTrust(): Promise<void> {
    await ensureNoSymlink(this.#metadataDirectory);
    await mkdir(this.#metadataDirectory, { recursive: true, mode: 0o700 });
    const bootstrapDigestPath = join(this.#metadataDirectory, "bootstrap-root.sha256");
    const rootPath = join(this.#metadataDirectory, "root.json");
    await ensureNoSymlink(bootstrapDigestPath);
    await ensureNoSymlink(rootPath);
    const expectedDigest = sha256(this.#trustedRoot);
    const existingDigest = await readFile(bootstrapDigestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existingDigest !== undefined && existingDigest !== expectedDigest)
      fail("VES_TUF_TRUST_ROOT_MISMATCH", "bootstrap trust root cannot be replaced");
    if (existingDigest === undefined) {
      await writeFile(rootPath, this.#trustedRoot, { mode: 0o600, flag: "wx" });
      await writeFile(bootstrapDigestPath, expectedDigest, { mode: 0o600, flag: "wx" });
    }
  }

  async #resolveTarget(updater: Updater, path: string): Promise<TargetInfo> {
    const target = await updater.getTargetInfo(path);
    if (target === undefined) throw new TufUpdateError("VES_TUF_PARTIAL_PUBLISH", `TUF target is missing: ${path}`);
    if (target.length <= 0 || !Number.isSafeInteger(target.length))
      fail("VES_TUF_INTEGRITY", `TUF target has invalid length: ${path}`);
    return target as TargetInfo;
  }

  async #readVerifiedTarget(target: TargetInfo, consistentSnapshot: boolean): Promise<Buffer> {
    const bytes = await readWholeTarget(
      this.#source,
      sourcePathFor(target, consistentSnapshot),
      target.length,
      this.#chunkSize
    );
    try {
      await target.verify(Readable.from(bytes));
    } catch (error) {
      fail("VES_TUF_INTEGRITY", `target failed TUF verification: ${target.path}`, error);
    }
    return bytes;
  }

  async #stageComponent(
    stageRoot: string,
    component: HermeticBundleComponent,
    target: TargetInfo,
    consistentSnapshot: boolean
  ): Promise<void> {
    if (target.length !== component.sizeBytes || `sha256:${target.hashes["sha256"] ?? ""}` !== component.contentDigest)
      fail("VES_TUF_RELEASE_VIEW_MIXED", `TUF metadata conflicts with release manifest: ${component.componentId}`);
    const custom = target.custom;
    if (
      custom["releaseId"] !== component.releaseId ||
      custom["componentId"] !== component.componentId ||
      custom["contentDigest"] !== component.contentDigest
    )
      fail(
        "VES_TUF_PROVENANCE_MISMATCH",
        `target provenance is not bound to the release view: ${component.componentId}`
      );

    const finalPath = join(stageRoot, component.logicalPath);
    const partialPath = `${finalPath}.part`;
    assertWithin(stageRoot, finalPath);
    await ensureNoSymlink(finalPath);
    await ensureNoSymlink(partialPath);
    await ensureDirectoryChain(stageRoot, dirname(finalPath));
    if (await verifyFile(finalPath, component)) return;
    if (await optionalStat(finalPath)) await rm(finalPath, { force: true });
    let offset = (await optionalStat(partialPath))?.size ?? 0;
    if (offset > component.sizeBytes) {
      await rm(partialPath, { force: true });
      offset = 0;
    }
    const sourcePath = sourcePathFor(target, consistentSnapshot);
    while (offset < component.sizeBytes) {
      const maximum = Math.min(this.#chunkSize, component.sizeBytes - offset);
      const result = await this.#source.readTarget(sourcePath, offset, maximum);
      if (result.totalLength !== component.sizeBytes)
        fail("VES_TUF_LENGTH_MISMATCH", `target length changed during resume: ${component.componentId}`);
      const bytes = Buffer.from(result.bytes);
      if (bytes.length === 0 || bytes.length > maximum)
        fail("VES_TUF_PARTIAL_DOWNLOAD", `target returned an invalid chunk: ${component.componentId}`);
      const handle = await open(
        partialPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
        0o600
      );
      try {
        const current = await handle.stat();
        if (current.size !== offset) fail("VES_TUF_STAGE_CONFLICT", "staging offset changed concurrently");
        await handle.write(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      offset += bytes.length;
    }
    if (!(await verifyFile(partialPath, component))) {
      await rm(partialPath, { force: true });
      fail("VES_TUF_INTEGRITY", `staged target digest is invalid: ${component.componentId}`);
    }
    await rename(partialPath, finalPath);
  }

  async resolveAndStage(request: TufUpdateRequest): Promise<TufStagedRelease> {
    if (
      !(["win32", "linux", "darwin"] as const).includes(request.platform) ||
      !(["x64", "arm64"] as const).includes(request.arch)
    )
      fail("VES_TUF_TARGET_INVALID", "requested release target is invalid");
    try {
      await this.#bootstrapTrust();
      const updater = new Updater({
        metadataDir: this.#metadataDirectory,
        metadataBaseUrl: "https://source.invalid/metadata/",
        targetBaseUrl: "https://source.invalid/targets/",
        fetcher: new SourceFetcher(this.#source),
        config: { maxRootRotations: MAX_ROOT_ROTATIONS, prefixTargetsWithHash: true }
      });
      await updater.refresh();
      const consistentSnapshot = await parseConsistentSnapshot(this.#metadataDirectory);
      const manifestPath = `releases/${request.platform}-${request.arch}/release.json`;
      const manifestTarget = await this.#resolveTarget(updater, manifestPath);
      const manifestBytes = await this.#readVerifiedTarget(manifestTarget, consistentSnapshot);
      const manifest: HermeticDistributionBundle = (() => {
        try {
          return verifyHermeticDistributionBundle(JSON.parse(manifestBytes.toString("utf8")));
        } catch (error) {
          return fail("VES_TUF_BUNDLE_INVALID", "resolved release manifest is invalid", error);
        }
      })();
      if (manifest.target.platform !== request.platform || manifest.target.arch !== request.arch)
        fail("VES_TUF_PLATFORM_MISMATCH", "resolved release does not match the requested target");
      const releaseCustom = manifestTarget.custom;
      if (
        releaseCustom["releaseId"] !== manifest.releaseId ||
        releaseCustom["releaseDigest"] !== manifest.releaseDigest ||
        releaseCustom["platform"] !== request.platform ||
        releaseCustom["arch"] !== request.arch
      )
        fail("VES_TUF_RELEASE_VIEW_MIXED", "release target metadata conflicts with its manifest");

      const stageId = `stage:${manifest.releaseDigest}`;
      const stageRoot = join(this.#stagingRoot, manifest.releaseDigest.slice("sha256:".length));
      assertWithin(this.#stagingRoot, stageRoot);
      await ensureDirectoryChain(this.#stagingRoot, stageRoot);
      for (const component of manifest.components) {
        const target = await this.#resolveTarget(updater, component.logicalPath);
        await this.#stageComponent(stageRoot, component, target, consistentSnapshot);
      }
      const receipt = frozenReceipt({
        schemaVersion: 1,
        stageId,
        releaseId: manifest.releaseId,
        releaseDigest: manifest.releaseDigest,
        platform: request.platform,
        arch: request.arch,
        sourceMode: this.#source.mode,
        sourceId: this.#source.sourceId,
        bundle: manifest,
        components: manifest.components.map(({ componentId, logicalPath, contentDigest, sizeBytes }) => ({
          componentId,
          logicalPath,
          contentDigest,
          sizeBytes
        })),
        activationAllowed: false
      });
      const receiptPath = join(stageRoot, "staged-release.json");
      await ensureNoSymlink(receiptPath);
      const encoded = `${JSON.stringify(receipt)}\n`;
      try {
        await writeFile(receiptPath, encoded, { mode: 0o600, flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if ((await readFile(receiptPath, "utf8")) !== encoded)
          fail("VES_TUF_STAGE_CONFLICT", "existing staged release receipt conflicts with resolved view");
      }
      return receipt;
    } catch (error) {
      throw mapError(error);
    }
  }
}
