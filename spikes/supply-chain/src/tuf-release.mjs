import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Updater } from "tuf-js";
import { DownloadHTTPError } from "tuf-js/dist/error.js";

export const QUALIFIED_TUF = Object.freeze({ package: "tuf-js", version: "5.0.1", node: "24.14.0", latestIneligible: "6.0.0", reason: "requires Node ^24.15.0" });
export const REQUIRED_RELEASE_COMPONENTS = Object.freeze([
  "core", "schemas", "cedar", "sqlite", "drivers", "extensions", "migrations",
  "licenses", "sbom", "provenance", "evaluations", "launchers"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function failure(code, message, fields = {}) {
  return Object.assign(new Error(message), { code, activationAllowed: false, ...fields });
}

class FixtureFetcher {
  constructor(repository) {
    this.repository = repository;
  }

  #bytes(url) {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const area = parts.shift();
    const path = parts.join("/");
    if (area === "metadata" && path === "2.root.json") throw new DownloadHTTPError("not found", 404);
    const bytes = area === "metadata" ? this.repository.metadata.get(path) : this.repository.targets.get(path);
    if (!bytes) throw new DownloadHTTPError("not found", 404);
    return Buffer.from(bytes);
  }

  async downloadBytes(url, maxLength) {
    const bytes = this.#bytes(url);
    if (bytes.length > maxLength) throw new Error("download exceeds maximum length");
    return bytes;
  }

  async downloadFile(url, maxLength, handler) {
    const bytes = await this.downloadBytes(url, maxLength);
    const root = await mkdtemp(join(tmpdir(), "verchestra-tuf-download-"));
    const path = join(root, "target");
    try {
      await writeFile(path, bytes);
      return await handler(path);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

function mapTufError(error) {
  if (error.code?.startsWith("VES_")) return error;
  const detail = `${error.name ?? ""} ${error.message ?? ""}`;
  if (error.name === "ExpiredMetadataError" || /expired/i.test(detail)) return failure("VES_TUF_EXPIRED", "TUF metadata is expired", { cause: error });
  if (["BadVersionError", "EqualVersionError"].includes(error.name) || /rollback|version \d+ is less than current version|version.*(?:lower|older)/i.test(detail)) {
    return failure("VES_TUF_ROLLBACK", "TUF metadata rollback was rejected", { cause: error });
  }
  if (error.name === "UnsignedMetadataError" || /signed by \d+\/\d+|signature/i.test(detail)) {
    return failure("VES_TUF_THRESHOLD", "TUF signature threshold was not met", { cause: error });
  }
  if (error instanceof DownloadHTTPError) return failure("VES_TUF_PARTIAL_PUBLISH", "TUF repository is partially published", { cause: error });
  if (/hash|length|integrity/i.test(detail)) return failure("VES_TUF_INTEGRITY", "TUF metadata or target integrity failed", { cause: error });
  if (/not found|failed to download|unable to load/i.test(detail)) return failure("VES_TUF_PARTIAL_PUBLISH", "TUF repository is partially published", { cause: error });
  return failure("VES_TUF_INVALID", "TUF release resolution failed", { cause: error });
}

export class TufReleaseResolver {
  constructor({ root, trustedRoot, repository }) {
    this.root = root;
    this.repository = repository;
    this.metadataDir = join(root, "metadata");
    this.targetDir = join(root, "targets");
    mkdirSync(this.metadataDir, { recursive: true });
    mkdirSync(this.targetDir, { recursive: true });
    const rootPath = join(this.metadataDir, "root.json");
    if (!existsSync(rootPath)) writeFileSync(rootPath, trustedRoot);
    this.updater = null;
  }

  async #download(path) {
    const info = await this.updater.getTargetInfo(path);
    if (!info) throw failure("VES_TUF_PARTIAL_PUBLISH", `TUF target metadata is missing: ${path}`);
    try {
      const file = await this.updater.downloadTarget(info);
      return await readFile(file);
    } catch (error) {
      throw mapTufError(error);
    }
  }

  async resolve({ sourceMode, platform }) {
    if (!["online", "mirror", "offline", "air-gapped"].includes(sourceMode)) throw failure("VES_TUF_SOURCE_MODE_INVALID", "distribution source mode is invalid");
    try {
      this.updater = new Updater({
        metadataDir: this.metadataDir,
        metadataBaseUrl: "https://fixture.invalid/metadata/",
        targetDir: this.targetDir,
        targetBaseUrl: "https://fixture.invalid/targets/",
        fetcher: new FixtureFetcher(this.repository),
        config: { maxRootRotations: 1 }
      });
      await this.updater.refresh();
      const manifest = JSON.parse(await this.#download("release.json"));
      if (manifest.platform !== platform) throw failure("VES_RELEASE_PLATFORM_MISMATCH", "release platform does not match", { expected: platform, actual: manifest.platform });
      for (const name of REQUIRED_RELEASE_COMPONENTS) {
        if (!manifest.components.some((component) => component.name === name)) {
          throw failure("VES_RELEASE_COMPONENT_MISSING", `release component is missing: ${name}`, { component: name });
        }
      }
      if (manifest.components.some((component) => component.releaseId !== manifest.releaseId)) {
        throw failure("VES_RELEASE_VIEW_MIXED", "release manifest mixes component views");
      }
      const components = [];
      for (const name of REQUIRED_RELEASE_COMPONENTS) {
        const component = manifest.components.find((entry) => entry.name === name);
        const bytes = await this.#download(component.path);
        if (sha256(bytes) !== component.sha256) throw failure("VES_TUF_INTEGRITY", `release component digest mismatch: ${name}`);
        components.push({ name, path: component.path, sha256: component.sha256, verified: true });
      }
      return { releaseId: manifest.releaseId, platform, sourceMode, components };
    } catch (error) {
      throw mapTufError(error);
    }
  }
}
