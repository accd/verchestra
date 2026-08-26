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
// `bin/`, `runtime/`, `native/`, the sealed `components/` the bundle declares,
// and pointedly NO `src/` and NO `node_modules/` - and drives the REAL
// NodeActivationHealthGate plus the delegated CLI paths against it.
//
// The same realism gap then shipped again, in the commands themselves, because
// nothing here ever RAN one: `--help` only had to MENTION `doctor` and
// `self-test`. Three references resolved a sibling file with a specifier
// written for the repository layout and therefore landed nowhere in a release:
// the doctor's schema registry (two levels ABOVE the release root, so the
// registry was always null and the verdict always FAIL), the Self-Test full
// profile's `execFile`d crash child (a `.ts` file esbuild never emits), and the
// spawned fake driver both Self-Test driver profiles probe. The command tests
// below execute the commands from the staged layout, which is the only place
// any of the three is observable.

import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, test } from "node:test";

import { resolveDurableCrashChild, resolveSelfTestDriverFake } from "../../apps/vestra-cli/src/release-layout.ts";
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
// The crash child is not a launcher (the hermetic bundle contract admits
// exactly two) but it is bundled with the identical option vector and staged
// beside them, so every self-containment claim made about a launcher is made
// about it too.
const CRASH_CHILD_ID = "self-test:full-crash-child";
const CRASH_CHILD_LOGICAL_PATH = "bin/self-test-full-crash-child.mjs";
const SEALED_BIN_IDS = Object.freeze([...LAUNCHER_IDS, CRASH_CHILD_ID]);
const NATIVE_PLACEHOLDERS = Object.freeze({
  "native/sqlite-vec": Buffer.alloc(4096, 7),
  "native/cedar-wasm.wasm": Buffer.alloc(1536, 9)
});
const REPOSITORY_SHIM = fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url));

let replica;
const disposable = [];
const sealedBins = {};

before(async () => {
  replica = await createSealedRepositoryReplica();
  for (const componentId of SEALED_BIN_IDS) {
    sealedBins[componentId] = await bundleSealedLauncher({
      repository: replica.repository,
      componentId,
      semanticVersion: SEALED_VERSION,
      nodeVersion: NODE_VERSION
    });
  }
});

const SCRATCH_BASE = join(process.cwd(), ".tmp-sealed-command-layout");

after(async () => {
  await Promise.all(disposable.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
  await rm(SCRATCH_BASE, { recursive: true, force: true, maxRetries: 10 });
  await replica?.dispose();
});

// The candidate builder seals tracked sources as components at
// `components/<trackedPath>`, and transactional activation copies EVERY
// component of the bundle into the release root, so a real staged release
// carries them one directory up from `bin/`. Two of them are what the commands
// below actually reach for: the contract registry the doctor loads, and the
// fake driver executable the Self-Test profiles spawn.
const SEALED_COMPONENT_FILE = "apps/vestra-cli/src/self-test-driver-fake.mjs";

async function stageSealedComponents(releaseRoot) {
  const componentsRoot = join(releaseRoot, "components");
  // The schema traversal mirrors SchemaRegistry.load's own: a directory per
  // schema name, its `.json` files inside.
  const schemaSource = join(replica.repository, "schemas");
  for (const directory of await readdir(schemaSource, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    await mkdir(join(componentsRoot, "schemas", directory.name), { recursive: true });
    for (const file of await readdir(join(schemaSource, directory.name))) {
      if (!file.endsWith(".json")) continue;
      await copyFile(join(schemaSource, directory.name, file), join(componentsRoot, "schemas", directory.name, file));
    }
  }
  const componentTarget = join(componentsRoot, ...SEALED_COMPONENT_FILE.split("/"));
  await mkdir(dirname(componentTarget), { recursive: true });
  await copyFile(join(replica.repository, ...SEALED_COMPONENT_FILE.split("/")), componentTarget);
}

// The layout activation actually stages: the release's own runtime, the sealed
// `bin/` artifacts, the native components, and the sealed component sources -
// no repository checkout, no dependency store, no package manifests.
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
  if (bins[CRASH_CHILD_ID] !== undefined)
    await writeFile(join(releaseRoot, ...CRASH_CHILD_LOGICAL_PATH.split("/")), bins[CRASH_CHILD_ID]);
  await stageSealedComponents(releaseRoot);
  return releaseRoot;
}

// The invoking project a command is run FROM. It deliberately does not live
// under os.tmpdir(): the staged release root does, and the Self-Test overlap
// rule (packages/self-test/src/disposable-roots.ts) reads a shared temp-root
// ancestor between the guarded cwd and the disposable root as an overlap and
// BLOCKS the run - issue #370, a pre-existing latent defect being fixed
// separately. The repository's own scratch directory has no such ancestor, and
// tests/e2e/self-test-cli-e2e.test.mjs avoids the same trap the same way.
async function invokingProject() {
  await mkdir(SCRATCH_BASE, { recursive: true });
  const root = await mkdtemp(join(SCRATCH_BASE, "project-"));
  disposable.push(root);
  execFileSync("git", ["init", "--quiet", "--initial-branch=main"], { cwd: root });
  execFileSync("git", ["config", "user.name", "sealed-command"], { cwd: root });
  execFileSync("git", ["config", "user.email", "sealed-command@invalid.example"], { cwd: root });
  await writeFile(join(root, "package.json"), '{"private":true}\n');
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: root });
  return root;
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

function spawnSealed(releaseRoot, launcher, args, options = {}) {
  return spawnSync(
    join(releaseRoot, ...RUNTIME_LOGICAL_PATH.split("/")),
    [join(releaseRoot, "bin", launcher), ...args],
    {
      cwd: options.cwd ?? releaseRoot,
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
      timeout: options.timeoutMs ?? 60_000
    }
  );
}

// The same command from the repository checkout: ambient Node, the tracked
// development shim, the same invoking project. This is the baseline the sealed
// run must equal - the point being that a packaging change may not alter what
// a command observes about the machine.
function spawnRepository(args, cwd) {
  return spawnSync(process.execPath, [REPOSITORY_SHIM, ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 120_000
  });
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

// Executing `doctor` from the staged layout, not merely finding its name in
// `--help`. The verdict must be the machine's, not the packaging's: BLOCKED
// with exit 4 from an invoking project that has no runtime, policy, driver, or
// native-asset fixtures - byte for byte the same check catalog the repository
// checkout reports for the same project (tests/e2e/doctor-cli-e2e.test.mjs
// owns that source-mode expectation).
//
// Recorded limitation, deliberately NOT worked around here: this staged layout
// cannot reach PASS. `doctor.native-asset` reads the activation record of the
// install the sealed bundle sits in (apps/vestra-cli/src/main.ts derives it
// three levels up from the bin directory, and doctor-composition.ts cross-checks
// active.json against releases/<digest>/release.json). This test runs the bundle
// from a disposable staged root that was never activated - it holds no
// active.json - so the asset is honestly blocked. A genuinely activated release
// reports it present (tests/integration/doctor-native-asset-probe.test.mjs
// proves that path). secret-presence stays blocked regardless: no production
// secret backend exists to observe yet (#18, L2). BLOCKED is the honest verdict
// for this unprovisioned, un-activated layout.
test("doctor from the staged layout reports the machine, not the packaging", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const project = await invokingProject();
  const argv = ["doctor", "--deep", "--output", "json"];

  const sealed = spawnSealed(releaseRoot, "vestra.mjs", argv, { cwd: project, timeoutMs: 120_000 });
  assert.equal(sealed.status, 4, sealed.stderr);
  const sealedReport = JSON.parse(sealed.stdout).data;
  assert.equal(sealedReport["doctor.verdict"], "BLOCKED");
  // The defect this pins: an unresolvable schema registry made the probe
  // present-but-unhealthy, which observeToFact maps to `fail` and the verdict
  // to FAIL with exit 1 - from a sealed bundle only.
  assert.ok(sealedReport["doctor.check_codes"].includes("doctor.contract-schema:pass"));

  const source = spawnRepository(argv, project);
  const sourceReport = JSON.parse(source.stdout).data;
  assert.equal(source.status, 4, source.stderr);
  assert.equal(sourceReport["doctor.verdict"], sealedReport["doctor.verdict"]);
  assert.deepEqual(sealedReport["doctor.check_codes"], sourceReport["doctor.check_codes"]);
  // The limitation above, asserted rather than assumed: a staged, never-activated
  // bundle observes no activation record and reports the asset blocked.
  assert.ok(sealedReport["doctor.check_codes"].includes("doctor.native-asset:blocked"));
});

test("self-test --profile smoke passes from the staged layout", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const project = await invokingProject();
  const result = spawnSealed(releaseRoot, "vestra.mjs", ["self-test", "--profile", "smoke", "--output", "json"], {
    cwd: project,
    timeoutMs: 180_000
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.data["self_test.profile"], "smoke");
  assert.equal(report.data["self_test.verdict"], "PASS");
  assert.equal(report.data["self_test.check_count"], 6);
});

// The end-to-end proof for the crash child: the full profile spawns it twice
// per durable boundary and phase through the release's own runtime. Before the
// fix this died with VES_SELFTEST_CRASH_PROCESS_FAILED because the entrypoint
// named `<releaseRoot>/bin/self-test-full-crash-child.ts`, a file esbuild
// never emits. It is the slowest test here (the repository's own equivalent in
// tests/e2e/self-test-cli-e2e.test.mjs costs about the same) and it is the
// only thing that observes the spawn rather than the path.
test("self-test --profile full runs its sealed crash child from the staged layout", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const project = await invokingProject();
  const result = spawnSealed(releaseRoot, "vestra.mjs", ["self-test", "--profile", "full", "--output", "json"], {
    cwd: project,
    timeoutMs: 600_000
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.data["self_test.profile"], "full");
  assert.equal(report.data["self_test.verdict"], "PASS");
  assert.equal(report.data["self_test.check_count"], 10);
});

test("every spawned Self-Test sibling resolves to the layout it is running in", async () => {
  const releaseRoot = await stagedLayout(sealedBins);
  const stagedChild = join(releaseRoot, ...CRASH_CHILD_LOGICAL_PATH.split("/"));
  const stagedFake = join(releaseRoot, "components", ...SEALED_COMPONENT_FILE.split("/"));
  assert.ok(existsSync(stagedChild), "the candidate must emit the crash child as its own sealed artifact");
  assert.ok(existsSync(stagedFake), "the fake driver is sealed as an ordinary tracked-source component");

  // Asked as the sealed bundle asks it - from `<releaseRoot>/bin/vestra.mjs`,
  // where every module of the bundle shares one `import.meta.url` - each
  // resolver returns the artifact that is actually there, which is what
  // `execFile` needs to find.
  const sealedModuleUrl = pathToFileURL(join(releaseRoot, "bin", "vestra.mjs")).href;
  assert.equal(resolveDurableCrashChild(sealedModuleUrl), stagedChild);
  assert.equal(resolveSelfTestDriverFake(sealedModuleUrl), stagedFake);

  // And the repository layout keeps the exact siblings it always had, so the
  // fix adds a layout rather than replacing one.
  const sourceModuleUrl = new URL("../../apps/vestra-cli/src/self-test-composition.ts", import.meta.url).href;
  assert.equal(
    resolveDurableCrashChild(sourceModuleUrl),
    fileURLToPath(new URL("../../apps/vestra-cli/src/self-test-full-crash-child.ts", import.meta.url))
  );
  assert.equal(
    resolveSelfTestDriverFake(sourceModuleUrl),
    fileURLToPath(new URL(`../../${SEALED_COMPONENT_FILE}`, import.meta.url))
  );
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
  for (const componentId of SEALED_BIN_IDS) {
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
  for (const componentId of SEALED_BIN_IDS) {
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
