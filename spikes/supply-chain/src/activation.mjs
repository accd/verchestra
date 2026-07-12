import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_ACTIVATION_COMPONENTS = Object.freeze([
  "core", "schemas", "cedar", "sqlite", "drivers", "extensions", "migrations",
  "licenses", "sbom", "provenance", "evaluations", "launchers"
]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function failure(code, message, previousActive, fields = {}) {
  return Object.assign(new Error(message), { code, previousActive, ...fields });
}

export class ActivationManager {
  constructor({ root, platform, fault = () => {} }) {
    this.root = root;
    this.platform = platform;
    this.fault = fault;
    this.recordedEvents = [];
  }

  async #initialize() {
    await mkdir(join(this.root, "staging"), { recursive: true });
    await mkdir(join(this.root, "releases"), { recursive: true });
  }

  async active() {
    try {
      return JSON.parse(await readFile(join(this.root, "active.json"), "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async events() {
    return [...this.recordedEvents];
  }

  #validate(candidate, previous) {
    if (candidate.platform !== this.platform) throw failure("VES_ACTIVATION_PLATFORM_MISMATCH", "candidate platform does not match", previous);
    for (const name of REQUIRED_ACTIVATION_COMPONENTS) {
      if (!candidate.components.some((component) => component.name === name)) {
        throw failure("VES_ACTIVATION_COMPONENT_MISSING", `required component is missing: ${name}`, previous, { component: name });
      }
    }
    if (candidate.components.some((component) => component.releaseId !== candidate.releaseId)) {
      throw failure("VES_ACTIVATION_RELEASE_MIXED", "candidate components come from mixed release views", previous);
    }
    if (candidate.components.some((component) => sha256(component.content) !== component.sha256)) {
      throw failure("VES_ACTIVATION_INTEGRITY", "candidate component digest does not match", previous);
    }
  }

  async install(candidate) {
    await this.#initialize();
    const previous = (await this.active())?.releaseId ?? null;
    this.#validate(candidate, previous);
    const staging = join(this.root, "staging", `${candidate.releaseId}-${crypto.randomUUID()}`);
    const releasePath = join(this.root, "releases", candidate.releaseId);
    await mkdir(staging, { recursive: true });
    let stage = "before-write";
    try {
      this.fault(stage);
      for (const component of candidate.components) {
        await writeFile(join(staging, component.path), component.content);
      }
      const manifest = { releaseId: candidate.releaseId, platform: candidate.platform, components: candidate.components.map(({ content, ...component }) => component) };
      await writeFile(join(staging, "release.json"), JSON.stringify(manifest));
      this.recordedEvents.push("staged");
      stage = "before-health";
      this.fault(stage);
      for (const component of candidate.components) {
        if (sha256(await readFile(join(staging, component.path))) !== component.sha256) throw new Error("health digest mismatch");
      }
      this.recordedEvents.push("health-passed");
      stage = "before-publish";
      this.fault(stage);
      await rename(staging, releasePath);
      this.recordedEvents.push("release-published");
      stage = "before-pointer";
      this.fault(stage);
      await this.#switchPointer(candidate.releaseId);
      this.recordedEvents.push("active-pointer-switched");
      return { previous, active: candidate.releaseId, rolledBack: false };
    } catch (error) {
      const codes = {
        "before-write": "VES_ACTIVATION_STAGE_FAILED",
        "before-health": "VES_ACTIVATION_HEALTH_FAILED",
        "before-publish": "VES_ACTIVATION_PUBLISH_FAILED",
        "before-pointer": "VES_ACTIVATION_POINTER_FAILED"
      };
      throw failure(codes[stage], `activation failed at ${stage}`, previous, { cause: error });
    } finally {
      if (existsSync(staging)) await rm(staging, { recursive: true, force: true });
    }
  }

  async #switchPointer(releaseId) {
    const temporary = join(this.root, `active.${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ releaseId }));
    await rename(temporary, join(this.root, "active.json"));
  }

  async rollback(releaseId) {
    await this.#initialize();
    const previous = (await this.active())?.releaseId ?? null;
    const manifestPath = join(this.root, "releases", releaseId, "release.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      if (manifest.releaseId !== releaseId || manifest.platform !== this.platform) throw new Error("invalid release manifest");
    } catch (error) {
      throw failure("VES_ROLLBACK_TARGET_INVALID", "rollback target is missing or invalid", previous, { cause: error });
    }
    await this.#switchPointer(releaseId);
    return { previous, active: releaseId, rolledBack: true };
  }
}
