// Real, spawnable release fixtures for the observed activation health gate.
//
// The hermetic bundle contract makes the release carry its own Node runtime and
// run its launchers through it, so a fixture that proves anything about
// observed health must contain a genuinely executable runtime. This helper
// copies the host Node binary once per test process and hard-links it into each
// release root, which keeps every case real without paying a 90 MB copy per
// case. `disposeHealthFixtures()` releases the cache.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, link, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { buildHermeticDistributionBundle } from "../../packages/distribution/src/hermetic-bundle.ts";

const TARGET_PLATFORM = process.platform;
const TARGET_ARCH = process.arch;
const DEFAULT_SEMANTIC_VERSION = "1.0.0";
const RUNTIME_LOGICAL_PATH = TARGET_PLATFORM === "win32" ? "runtime/node.exe" : "runtime/node";
const LAUNCHER_LOGICAL_PATHS = Object.freeze({
  "launcher:vestra": "bin/vestra.mjs",
  "launcher:verchestra": "bin/verchestra.mjs"
});
const EVIDENCE_KINDS = new Set(["license", "sbom", "provenance", "evaluation"]);
const TARGET_KINDS = new Set(["node-runtime", "sqlite-native", "launcher"]);
const SUPPORTING_COMPONENTS = Object.freeze([
  ["core-code", "core:verchestra"],
  ["schema", "schemas:contracts"],
  ["migration", "migrations:runtime"],
  ["policy", "policy:cedar"],
  ["cedar-wasm", "wasm:cedar"],
  ["sqlite-native", "native:sqlite"],
  ["driver", "driver:claude"],
  ["connector", "connector:jira"],
  ["skill", "skill:tlc"],
  ["license", "license:product"],
  ["sbom", "sbom:cyclonedx"],
  ["provenance", "provenance:build"],
  ["evaluation", "evaluation:release"]
]);

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

let runtimeCache;
const disposable = [];

async function cachedRuntime() {
  runtimeCache ??= (async () => {
    const root = await mkdtemp(join(tmpdir(), "verchestra-health-runtime-"));
    const path = join(root, TARGET_PLATFORM === "win32" ? "node.exe" : "node");
    await copyFile(process.execPath, path);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    const info = await stat(path);
    return { root, path, contentDigest: `sha256:${hash.digest("hex")}`, sizeBytes: info.size };
  })();
  return await runtimeCache;
}

/** Releases the cached runtime copy and every fixture root this module created. */
export async function disposeHealthFixtures() {
  const cache = runtimeCache;
  runtimeCache = undefined;
  const roots = disposable.splice(0);
  if (cache !== undefined) roots.push((await cache).root);
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
}

/** A launcher whose observations satisfy the activation health protocol. */
export function healthReport(componentId, overrides = {}) {
  return {
    schemaVersion: 1,
    report: "activation-health",
    componentId,
    semanticVersion: DEFAULT_SEMANTIC_VERSION,
    checks: ["migration", "native", "driver"].map((name) => ({
      name,
      status: "pass",
      observation: { check: name, applied: true }
    })),
    behavior: { commands: ["help", "version", "portability"], runtimeResolver: false },
    ...overrides
  };
}

/**
 * Emits a launcher that answers the health protocol from inside the release.
 * The argument-vector assertion is part of the fixture on purpose: a launcher
 * that is handed anything other than exactly `--activation-health` refuses,
 * which is what makes the shell-free invocation observable from the outside.
 */
export function reportingLauncherSource(report, options = {}) {
  return [
    `const observedArgv = process.argv.slice(2);`,
    `if (observedArgv.length !== 1 || observedArgv[0] !== "--activation-health") {`,
    `  process.stderr.write("unexpected argument vector");`,
    `  process.exit(64);`,
    `}`,
    `const report = ${JSON.stringify(report)};`,
    `report.behavior = { ...report.behavior, observedRuntime: process.version${
      options.includeArgv === true ? `, observedArgv` : ""
    } };`,
    `process.stdout.write(JSON.stringify(report));`,
    ""
  ].join("\n");
}

/**
 * A launcher that answers the health protocol and, for any other argument
 * vector, records the arguments it actually received next to itself and exits
 * with the status requested by a leading `--exit=<code>`. That record is how a
 * test observes, from outside the process boundary, that user arguments crossed
 * it verbatim and that no shell ever expanded them.
 */
export function dualModeLauncherSource(report) {
  return [
    `import { writeFileSync } from "node:fs";`,
    `import { dirname, join } from "node:path";`,
    `import { fileURLToPath } from "node:url";`,
    ``,
    `const observedArgv = process.argv.slice(2);`,
    `if (observedArgv.length === 1 && observedArgv[0] === "--activation-health") {`,
    `  const report = ${JSON.stringify(report)};`,
    `  report.behavior = { ...report.behavior, observedRuntime: process.version };`,
    `  process.stdout.write(JSON.stringify(report));`,
    `} else {`,
    `  const here = dirname(fileURLToPath(import.meta.url));`,
    `  writeFileSync(join(here, "observed-argv.json"), JSON.stringify(observedArgv));`,
    `  const requested = observedArgv.find((entry) => entry.startsWith("--exit="));`,
    `  process.exit(requested === undefined ? 0 : Number.parseInt(requested.slice("--exit=".length), 10));`,
    `}`,
    ""
  ].join("\n");
}

function descriptor(kind, componentId, logicalPath, bytesOrDigest) {
  const targetSpecific = TARGET_KINDS.has(kind);
  const evidence = EVIDENCE_KINDS.has(kind);
  return {
    componentId,
    kind,
    releaseId: `release:verchestra:health:${TARGET_PLATFORM}-${TARGET_ARCH}`,
    platform: targetSpecific ? TARGET_PLATFORM : "any",
    arch: targetSpecific ? TARGET_ARCH : "any",
    logicalPath,
    contentDigest: bytesOrDigest.contentDigest,
    sizeBytes: bytesOrDigest.sizeBytes,
    licenseRefs: evidence ? [] : ["license:product"],
    attestationRefs: evidence ? [] : ["provenance:build", "evaluation:release"],
    executable: kind === "node-runtime" || kind === "launcher"
  };
}

/**
 * Builds a complete release closure: real Node runtime bytes, the two canonical
 * launcher scripts, and one small file per remaining required component kind.
 * `launchers` maps a canonical launcher component ID to its script source.
 */
export async function buildExecutableRelease(options = {}) {
  const runtime = await cachedRuntime();
  const semanticVersion = options.semanticVersion ?? DEFAULT_SEMANTIC_VERSION;
  const launchers = options.launchers ?? {
    "launcher:vestra": reportingLauncherSource(healthReport("launcher:vestra", { semanticVersion })),
    "launcher:verchestra": reportingLauncherSource(healthReport("launcher:verchestra", { semanticVersion }))
  };
  const files = new Map();
  const descriptors = [descriptor("node-runtime", "runtime:node", RUNTIME_LOGICAL_PATH, runtime)];
  files.set(RUNTIME_LOGICAL_PATH, { runtimePath: runtime.path });
  for (const [kind, componentId] of SUPPORTING_COMPONENTS) {
    const logicalPath = `components/${componentId.replaceAll(":", "-")}`;
    const bytes = Buffer.from(`verchestra:${componentId}:${semanticVersion}`);
    files.set(logicalPath, { bytes });
    descriptors.push(
      descriptor(kind, componentId, logicalPath, { contentDigest: digestOf(bytes), sizeBytes: bytes.length })
    );
  }
  for (const [componentId, source] of Object.entries(launchers)) {
    const logicalPath = options.launcherLogicalPaths?.[componentId] ?? LAUNCHER_LOGICAL_PATHS[componentId];
    const bytes = Buffer.from(source);
    files.set(logicalPath, { bytes });
    descriptors.push(
      descriptor("launcher", componentId, logicalPath, { contentDigest: digestOf(bytes), sizeBytes: bytes.length })
    );
  }
  const bundle = buildHermeticDistributionBundle({
    schemaVersion: 1,
    releaseId: `release:verchestra:health:${TARGET_PLATFORM}-${TARGET_ARCH}`,
    semanticVersion,
    createdAt: "2026-08-25T00:00:00.000Z",
    target: { platform: TARGET_PLATFORM, arch: TARGET_ARCH, nodeVersion: "24.14.0" },
    runtimeResolver: false,
    components: descriptors
  });
  return { bundle, files };
}

async function writeClosure(root, files) {
  for (const [logicalPath, content] of files) {
    const path = join(root, ...logicalPath.split("/"));
    await mkdir(dirname(path), { recursive: true });
    if (content.runtimePath === undefined) await writeFile(path, content.bytes);
    else await link(content.runtimePath, path).catch(() => copyFile(content.runtimePath, path));
  }
}

/** Materializes a release closure into a fresh temporary release root. */
export async function executableReleaseRoot(options = {}) {
  const { bundle, files } = await buildExecutableRelease(options);
  const root = await mkdtemp(join(tmpdir(), "verchestra-health-release-"));
  disposable.push(root);
  const releaseRoot = join(root, "release");
  await mkdir(releaseRoot, { recursive: true });
  await writeClosure(releaseRoot, files);
  return { bundle, releaseRoot, root };
}

/**
 * Materializes the same closure as a non-authoritative TUF stage plus disjoint
 * install root, so a test can drive the real `TransactionalActivationManager`
 * against genuinely executable bytes.
 */
export async function stagedExecutableRelease(options = {}) {
  const { bundle, files } = await buildExecutableRelease(options);
  const root = await mkdtemp(join(tmpdir(), "verchestra-health-stage-"));
  disposable.push(root);
  const stagingRoot = join(root, "staging");
  const installRoot = join(root, "install");
  const stageRoot = join(stagingRoot, bundle.releaseDigest.slice("sha256:".length));
  await mkdir(stageRoot, { recursive: true });
  await writeClosure(stageRoot, files);
  const receipt = {
    schemaVersion: 1,
    stageId: `stage:${bundle.releaseDigest}`,
    releaseId: bundle.releaseId,
    releaseDigest: bundle.releaseDigest,
    platform: bundle.target.platform,
    arch: bundle.target.arch,
    sourceMode: "offline",
    sourceId: "fixture:activation-health",
    bundle,
    components: bundle.components.map(({ componentId, logicalPath, contentDigest, sizeBytes }) => ({
      componentId,
      logicalPath,
      contentDigest,
      sizeBytes
    })),
    activationAllowed: false
  };
  await writeFile(join(stageRoot, "staged-release.json"), `${JSON.stringify(receipt)}\n`);
  return { bundle, installRoot, receipt, root, stageRoot, stagingRoot };
}
