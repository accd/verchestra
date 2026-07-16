import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { buildTufUpdateFixture } from "./tuf-update-fixture.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export async function materializeStagedRelease(stagingRoot, options = {}) {
  const fixture = buildTufUpdateFixture(options);
  const bundle = fixture.bundle;
  const receipt = {
    schemaVersion: 1,
    stageId: `stage:${bundle.releaseDigest}`,
    releaseId: bundle.releaseId,
    releaseDigest: bundle.releaseDigest,
    platform: bundle.target.platform,
    arch: bundle.target.arch,
    sourceMode: options.sourceMode ?? "offline",
    sourceId: options.sourceId ?? "fixture:activation",
    bundle,
    components: bundle.components.map(({ componentId, logicalPath, contentDigest, sizeBytes }) => ({
      componentId,
      logicalPath,
      contentDigest,
      sizeBytes
    })),
    activationAllowed: false
  };
  const stageRoot = join(stagingRoot, bundle.releaseDigest.slice("sha256:".length));
  await mkdir(stageRoot, { recursive: true });
  for (const component of bundle.components) {
    const path = join(stageRoot, component.logicalPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, fixture.componentBytes.get(component.logicalPath));
  }
  await writeFile(join(stageRoot, "staged-release.json"), `${JSON.stringify(receipt)}\n`);
  return { bundle, fixture, receipt, stageRoot };
}

export function passingHealth(bundle, overrides = {}) {
  const behavior = overrides.behaviorDigest ?? digest("launcher-equivalent-behavior");
  return {
    schemaVersion: 1,
    checks: ["migration", "native", "driver"].map((name) => ({
      name,
      status: "pass",
      evidenceDigest: digest(`health:${name}`)
    })),
    launchers: ["launcher:vestra", "launcher:verchestra"].map((componentId) => ({
      componentId,
      exitCode: 0,
      semanticVersion: bundle.semanticVersion,
      releaseDigest: bundle.releaseDigest,
      normalizedBehaviorDigest: behavior
    })),
    ...overrides
  };
}

export function healthGate(overrides = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(input) {
      calls.push(input);
      if (overrides.error) throw overrides.error;
      return overrides.evidence ?? passingHealth(input.bundle);
    }
  };
}
