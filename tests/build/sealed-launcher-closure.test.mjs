// The sealed launchers must BE the product from a realistic staged release
// layout - the exact realism the previous fixtures lacked. The T76 candidate
// used to seal the development shims `apps/vestra-cli/bin/*.mjs` verbatim;
// those import `../src/main.ts` and workspace packages by name, which resolve
// in a repository checkout but not in a staged release, and every gate stayed
// green because the health fixtures ran synthetic self-contained scripts
// instead of the real tracked bins (the same fixture-realism gap class as the
// TUF delegation-path bug). A live install proved it: activation downloaded
// and staged the full release, then failed VES_ACTIVATION_HEALTH_FAILED
// because `runtime/node bin/vestra.mjs --activation-health` died with
// ERR_MODULE_NOT_FOUND on `release/src/main.ts`.
//
// So this suite builds the real closure entries with the real builder's
// bundler, assembles a staged replica that mirrors what activation stages -
// `bin/`, `runtime/`, `native/`, and pointedly NO `src/` and NO
// `node_modules/` - and drives the REAL NodeActivationHealthGate plus the
// delegated CLI paths against it.

import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { NodeActivationHealthGate } from "../../packages/platform-node/src/activation-launcher-adapters.ts";
import { DEFAULT_RUNTIME_MIGRATIONS } from "../../packages/platform-node/src/runtime-store/runtime-migrations.ts";
import { SEALED_LAUNCHER_ENTRIES, bundleSealedLauncher } from "../../scripts/t76-build-candidate.mjs";
import { createSealedRepositoryReplica } from "../helpers/sealed-repository-fixture.mjs";

const SEALED_VERSION = "9.9.9-sealed";
const NODE_VERSION = process.version.slice(1);
// Same platform naming as tests/helpers/activation-health-fixture.mjs: on
// Windows an extensionless executable cannot be spawned (the platform appends
// an executable extension while searching), so a spawnable staged runtime is
// `runtime/node.exe` there and `runtime/node` everywhere else.
const RUNTIME_LOGICAL_PATH = process.platform === "win32" ? "runtime/node.exe" : "runtime/node";
const LAUNCHER_IDS = Object.freeze(["launcher:vestra", "launcher:verchestra"]);
const NATIVE_PLACEHOLDERS = Object.freeze({
  "native/sqlite-vec": Buffer.alloc(4096, 7),
  "native/cedar-wasm.wasm": Buffer.alloc(1536, 9)
});

let replica;
const disposable = [];
const sealedBins = {};

before(async () => {
  replica = await createSealedRepositoryReplica();
  for (const componentId of LAUNCHER_IDS) {
    sealedBins[componentId] = await bundleSealedLauncher({
      repository: replica.repository,
      componentId,
      semanticVersion: SEALED_VERSION,
      nodeVersion: NODE_VERSION
    });
  }
});

after(async () => {
  await Promise.all(disposable.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
  await replica?.dispose();
});

// The layout activation actually stages: the release's own runtime, the two
// sealed launchers, and the native components - nothing else. No repository
// sources, no dependency store, no package manifests.
async function stagedLayout(bins) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-sealed-layout-"));
  disposable.push(root);
  const releaseRoot = join(root, "release");
  await mkdir(join(releaseRoot, "bin"), { recursive: true });
  await mkdir(join(releaseRoot, "native"), { recursive: true });
  await mkdir(join(releaseRoot, "runtime"), { recursive: true });
  await copyFile(process.execPath, join(releaseRoot, ...RUNTIME_LOGICAL_PATH.split("/")));
  for (const [logicalPath, bytes] of Object.entries(NATIVE_PLACEHOLDERS))
    await writeFile(join(releaseRoot, ...logicalPath.split("/")), bytes);
  await writeFile(join(releaseRoot, "bin", "vestra.mjs"), bins["launcher:vestra"]);
  await writeFile(join(releaseRoot, "bin", "verchestra.mjs"), bins["launcher:verchestra"]);
  return releaseRoot;
}

const bundleView = () => ({
  semanticVersion: SEALED_VERSION,
  releaseDigest: `sha256:${"ab".repeat(32)}`,
  components: [
    { componentId: "runtime:node", kind: "node-runtime", logicalPath: RUNTIME_LOGICAL_PATH },
    { componentId: "launcher:vestra", kind: "launcher", logicalPath: "bin/vestra.mjs" },
    { componentId: "launcher:verchestra", kind: "launcher", logicalPath: "bin/verchestra.mjs" }
  ]
});

function spawnSealed(releaseRoot, launcher, args) {
  return spawnSync(
    join(releaseRoot, ...RUNTIME_LOGICAL_PATH.split("/")),
    [join(releaseRoot, "bin", launcher), ...args],
    {
      cwd: releaseRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000
    }
  );
}

test("both sealed launchers pass the real activation health gate from the staged layout", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const evidence = await new NodeActivationHealthGate().evaluate({ releaseRoot, bundle: bundleView() });
  assert.equal(evidence.schemaVersion, 1);
  assert.deepEqual(
    evidence.checks.map((check) => check.name),
    ["migration", "native", "driver"]
  );
  for (const check of evidence.checks) {
    assert.equal(check.status, "pass");
    assert.match(check.evidenceDigest, /^sha256:[a-f0-9]{64}$/u);
  }
  assert.deepEqual(
    evidence.launchers.map((launcher) => launcher.componentId),
    [...LAUNCHER_IDS]
  );
  for (const launcher of evidence.launchers) {
    assert.equal(launcher.exitCode, 0);
    assert.equal(launcher.semanticVersion, SEALED_VERSION);
  }
  assert.equal(evidence.launchers[0].normalizedBehaviorDigest, evidence.launchers[1].normalizedBehaviorDigest);
});

test("the health report carries only honest observations of the staged closure", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const result = spawnSealed(releaseRoot, "vestra.mjs", ["--activation-health"]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "", "the health protocol allows no stderr output");
  const report = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(report).sort(), [
    "behavior",
    "checks",
    "componentId",
    "report",
    "schemaVersion",
    "semanticVersion"
  ]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.report, "activation-health");
  assert.equal(report.componentId, "launcher:vestra");
  assert.equal(report.semanticVersion, SEALED_VERSION);
  const native = report.checks.find((check) => check.name === "native");
  assert.deepEqual(native.observation.components, [
    { logicalPath: "native/sqlite-vec", present: true, sizeBytes: 4096 },
    { logicalPath: "native/cedar-wasm.wasm", present: true, sizeBytes: 1536 }
  ]);
  const migration = report.checks.find((check) => check.name === "migration");
  assert.deepEqual(
    migration.observation.registered.map((entry) => entry.id),
    DEFAULT_RUNTIME_MIGRATIONS.map((entry) => entry.id)
  );
  assert.equal(migration.observation.count, DEFAULT_RUNTIME_MIGRATIONS.length);
  const driver = report.checks.find((check) => check.name === "driver");
  assert.ok(driver.observation.drivers.length > 0);
  assert.equal(driver.observation.selfTestProfile.profileId, "drivers");
  assert.deepEqual(
    report.behavior.commands.map((command) => command.name),
    ["init", "self-test", "doctor"]
  );
});

test("a sealed launcher without its native components fails the health gate closed", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  await rm(join(releaseRoot, "native"), { recursive: true, force: true });
  await assert.rejects(new NodeActivationHealthGate().evaluate({ releaseRoot, bundle: bundleView() }), (error) => {
    assert.equal(error.code, "VES_LAUNCHER_EXIT_NONZERO");
    return true;
  });
  const result = spawnSealed(releaseRoot, "vestra.mjs", ["--activation-health"]);
  assert.equal(result.status, 1);
  const diagnostic = JSON.parse(result.stderr);
  assert.equal(diagnostic.checks.find((check) => check.name === "native").status, "fail");
});

test("the sealed launcher is the real CLI for every other argument vector", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const version = spawnSealed(releaseRoot, "vestra.mjs", ["--version"]);
  assert.equal(version.status, 0);
  assert.equal(version.stderr, "");
  assert.match(version.stdout, new RegExp(`^Verchestra ${SEALED_VERSION.replaceAll(".", "\\.")} `, "u"));
  const help = spawnSealed(releaseRoot, "verchestra.mjs", ["--help"]);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, "");
  for (const command of ["init", "self-test", "doctor"]) assert.match(help.stdout, new RegExp(`\\b${command}\\b`, "u"));
});

// The red-to-green discriminator: the development shims the candidate used to
// seal verbatim die in exactly the way the live install died, and this
// harness - unlike the old synthetic fixtures - observes it.
test("the development shim launchers fail this same gate from the staged layout", async () => {
  const shims = {};
  for (const [componentId, entry] of Object.entries(SEALED_LAUNCHER_ENTRIES)) {
    const shimPath = entry.replace("closure/", "bin/").replace("-entry.ts", ".mjs");
    shims[componentId] = await readFile(join(replica.repository, ...shimPath.split("/")));
  }
  const releaseRoot = await stagedLayout(shims);
  await assert.rejects(new NodeActivationHealthGate().evaluate({ releaseRoot, bundle: bundleView() }), (error) => {
    assert.equal(error.code, "VES_LAUNCHER_EXIT_NONZERO");
    return true;
  });
  const result = spawnSealed(releaseRoot, "vestra.mjs", ["--activation-health"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/u);
});

test("sealed launcher bundling is deterministic", async () => {
  for (const componentId of LAUNCHER_IDS) {
    const again = await bundleSealedLauncher({
      repository: replica.repository,
      componentId,
      semanticVersion: SEALED_VERSION,
      nodeVersion: NODE_VERSION
    });
    assert.deepEqual(again, sealedBins[componentId], `${componentId} must rebuild byte-identically`);
  }
});

test("a sealed launcher bundle imports Node built-ins only", () => {
  for (const componentId of LAUNCHER_IDS) {
    const text = sealedBins[componentId].toString("utf8");
    const specifiers = [...text.matchAll(/(?:^|[\s;}])import\s*(?:[^"';]*?from\s*)?["']([^"']+)["']/gu)].map(
      (match) => match[1]
    );
    assert.ok(specifiers.length > 0);
    assert.deepEqual(
      specifiers.filter((specifier) => !specifier.startsWith("node:")),
      [],
      `${componentId} must not import outside node: built-ins`
    );
    assert.doesNotMatch(text, /import\s*\{[^}]*\}\s*from\s*"node:sqlite"/u, "node:sqlite must stay lazy");
  }
});
