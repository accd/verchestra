import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  machineLocalEnvironment,
  NodeActivationClosure
} from "../../apps/vestra-launcher/closure/node-activation-closure.ts";
import { runBootstrap } from "../../apps/vestra-launcher/src/bootstrap.ts";
import { NodeFilesystemDistributionSource } from "../../packages/distribution/src/tuf-update-client.ts";
import { disposeHealthFixtures, dualModeLauncherSource, healthReport } from "../helpers/activation-health-fixture.mjs";
import { createUpdateKeys } from "../helpers/tuf-update-fixture.mjs";
import {
  disposeLauncherReleaseFixtures,
  publishExecutableRelease
} from "../helpers/vestra-launcher-release-fixture.mjs";

// The whole bootstrap, against a real signed TUF repository holding a release
// that genuinely executes: resolve, stage, verify, activate transactionally
// behind the observed health gate, resolve the active launcher, and hand control
// to it. Nothing here is stubbed except the transport, which is a filesystem
// repository rather than an HTTPS one — the published wiring pins HTTPS, and no
// test may reach the public network.

const roots = [];

after(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await disposeLauncherReleaseFixtures();
  await disposeHealthFixtures();
});

const launchers = () =>
  Object.fromEntries(
    ["launcher:vestra", "launcher:verchestra"].map((componentId) => [
      componentId,
      dualModeLauncherSource(healthReport(componentId))
    ])
  );

async function packagedLauncher() {
  const published = await publishExecutableRelease({ launchers: launchers() });
  const home = await mkdtemp(join(tmpdir(), "verchestra-launcher-home-"));
  roots.push(home);
  const packageRoot = join(home, "package");
  await mkdir(join(packageRoot, "config"), { recursive: true });
  await writeFile(join(packageRoot, "config", "root.json"), Buffer.from(published.trustedRoot));
  await writeFile(join(packageRoot, "config", "release-source.json"), JSON.stringify(published.source));
  const installRoot = join(home, "state", "install");
  const closure = new NodeActivationClosure(() =>
    Object.freeze({
      installRoot,
      stagingRoot: join(home, "state", "staging"),
      trustRootDirectory: join(home, "state", "trust"),
      createSource: (pinned) =>
        new NodeFilesystemDistributionSource({
          mode: "offline",
          sourceId: pinned.sourceId,
          root: published.repositoryRoot
        })
    })
  );
  return { closure, installRoot, packageRoot, published };
}

const context = (packageRoot) => ({ platform: process.platform, arch: process.arch, packageRoot });

const releaseRootOf = (installRoot, bundle) =>
  join(installRoot, "releases", bundle.releaseDigest.slice("sha256:".length));

const absent = async (path) => {
  try {
    await stat(path);
    return false;
  } catch {
    return true;
  }
};

test("the bootstrap resolves, activates, and runs the pinned release end to end", async () => {
  const { closure, installRoot, packageRoot, published } = await packagedLauncher();
  const args = ["--exit=3", "--message", 'a b "c"', "$(echo pwned)", "; echo pwned", "%USERPROFILE%"];
  const lines = [];

  const status = await runBootstrap(args, context(packageRoot), (line) => lines.push(line), closure);

  assert.deepEqual(lines, [], "a completed activation renders no public error");
  assert.equal(status, 3, "the activated launcher's exit status is the command's observable result");

  const active = JSON.parse(await readFile(join(installRoot, "active.json"), "utf8"));
  assert.deepEqual(active, {
    schemaVersion: 1,
    releaseId: published.bundle.releaseId,
    releaseDigest: published.bundle.releaseDigest,
    semanticVersion: published.bundle.semanticVersion
  });

  const observed = JSON.parse(
    await readFile(join(releaseRootOf(installRoot, published.bundle), "bin", "observed-argv.json"), "utf8")
  );
  assert.deepEqual(observed, args, "user arguments crossed the process boundary verbatim, unexpanded by any shell");
});

test("a second run revalidates the active release and still executes it", async () => {
  const { closure, installRoot, packageRoot, published } = await packagedLauncher();
  assert.equal(await runBootstrap(["--exit=0"], context(packageRoot), () => undefined, closure), 0);
  const journal = join(installRoot, "activation-journal.json");
  assert.equal(await absent(journal), true, "a committed activation leaves no journal behind");

  const lines = [];
  const status = await runBootstrap(["--exit=7"], context(packageRoot), (line) => lines.push(line), closure);
  assert.deepEqual(lines, []);
  assert.equal(status, 7);
  const observed = JSON.parse(
    await readFile(join(releaseRootOf(installRoot, published.bundle), "bin", "observed-argv.json"), "utf8")
  );
  assert.deepEqual(observed, ["--exit=7"]);
});

test("a tampered component byte stops the bootstrap before anything is activated", async () => {
  const { closure, installRoot, packageRoot, published } = await packagedLauncher();
  const [first] = published.bundle.components;
  const digest = first.contentDigest.slice("sha256:".length);
  const slash = first.logicalPath.lastIndexOf("/");
  const tampered = join(
    published.repositoryRoot,
    "targets",
    ...`${first.logicalPath.slice(0, slash + 1)}${digest}.${first.logicalPath.slice(slash + 1)}`.split("/")
  );
  await writeFile(tampered, Buffer.alloc(first.sizeBytes, 0x41));

  const lines = [];
  const status = await runBootstrap(["--exit=0"], context(packageRoot), (line) => lines.push(line), closure);

  assert.equal(status, 70);
  assert.match(lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: /u);
  assert.match(lines[0], /\(VES_TUF_[A-Z_]+\)/u, "the canonical TUF code survives as a bounded diagnostic detail");
  assert.equal(await absent(join(installRoot, "active.json")), true, "nothing was activated");
});

test("a release that is not the pinned release is refused before activation", async () => {
  const published = await publishExecutableRelease({ launchers: launchers() });
  const home = await mkdtemp(join(tmpdir(), "verchestra-launcher-pinned-"));
  roots.push(home);
  const packageRoot = join(home, "package");
  await mkdir(join(packageRoot, "config"), { recursive: true });
  await writeFile(join(packageRoot, "config", "root.json"), Buffer.from(published.trustedRoot));
  await writeFile(
    join(packageRoot, "config", "release-source.json"),
    JSON.stringify({ ...published.source, releaseId: "release:verchestra:other" })
  );
  const installRoot = join(home, "state", "install");
  const closure = new NodeActivationClosure(() =>
    Object.freeze({
      installRoot,
      stagingRoot: join(home, "state", "staging"),
      trustRootDirectory: join(home, "state", "trust"),
      createSource: (pinned) =>
        new NodeFilesystemDistributionSource({
          mode: "offline",
          sourceId: pinned.sourceId,
          root: published.repositoryRoot
        })
    })
  );

  const lines = [];
  const status = await runBootstrap(["--exit=0"], context(packageRoot), (line) => lines.push(line), closure);

  assert.equal(status, 70);
  assert.match(lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: .*\(VES_TUF_RELEASE_VIEW_MIXED\)\./u);
  assert.equal(await absent(join(installRoot, "active.json")), true);
});

test("the published wiring derives its roots from the home directory alone", async () => {
  const home = await mkdtemp(join(tmpdir(), "verchestra-launcher-state-"));
  roots.push(home);
  const source = { sourceId: "source:online:primary", rootDigest: `sha256:${"a".repeat(64)}` };
  const restore = process.env["HOME"];
  const restoreProfile = process.env["USERPROFILE"];
  try {
    process.env["HOME"] = home;
    process.env["USERPROFILE"] = home;
    const environment = machineLocalEnvironment({ platform: process.platform, arch: process.arch }, source);
    for (const root of [environment.installRoot, environment.stagingRoot, environment.trustRootDirectory]) {
      assert.ok(root.startsWith(home), `${root} must live under the home directory`);
    }
    assert.notEqual(environment.installRoot, environment.stagingRoot);
    assert.ok(environment.trustRootDirectory.endsWith("a".repeat(64)), "each pinned root anchors in its own directory");
    assert.equal(await absent(environment.installRoot), true, "deriving a layout creates nothing");
  } finally {
    if (restore === undefined) delete process.env["HOME"];
    else process.env["HOME"] = restore;
    if (restoreProfile === undefined) delete process.env["USERPROFILE"];
    else process.env["USERPROFILE"] = restoreProfile;
  }
});

// #393 / AD-036. One machine, one trust root, two launchers: A pins release
// 1.0.0 published at TUF metadata version 1, B pins 2.0.0 at version 2. After A
// then B, the persistent metadata cache is at version 2, so resolving A again is
// a metadata downgrade that anti-rollback refuses. A retained, superseded A must
// instead re-activate from its verified installed bytes with no source read.

class CountingSource {
  constructor(inner) {
    this.inner = inner;
    this.mode = inner.mode;
    this.sourceId = inner.sourceId;
    this.reads = 0;
  }

  async readMetadata(path, maximumBytes) {
    this.reads += 1;
    return await this.inner.readMetadata(path, maximumBytes);
  }

  async readTarget(path, offset, maximumBytes) {
    this.reads += 1;
    return await this.inner.readTarget(path, offset, maximumBytes);
  }
}

const versionedLaunchers = (semanticVersion) =>
  Object.fromEntries(
    ["launcher:vestra", "launcher:verchestra"].map((componentId) => [
      componentId,
      dualModeLauncherSource(healthReport(componentId, { semanticVersion }))
    ])
  );

async function sharedMachine() {
  const home = await mkdtemp(join(tmpdir(), "verchestra-launcher-rollback-"));
  roots.push(home);
  const installRoot = join(home, "state", "install");
  const sources = new Map();
  // why: this mirrors `machineLocalEnvironment`, which anchors each pinned root
  // in its own trust directory under one shared install root.
  const closureFor = (published) =>
    new NodeActivationClosure((_host, pinned) =>
      Object.freeze({
        installRoot,
        stagingRoot: join(home, "state", "staging"),
        trustRootDirectory: join(home, "state", "trust", pinned.rootDigest.slice("sha256:".length)),
        createSource: (source) => {
          const counting = new CountingSource(
            new NodeFilesystemDistributionSource({
              mode: "offline",
              sourceId: source.sourceId,
              root: published.repositoryRoot
            })
          );
          sources.set(published, counting);
          return counting;
        }
      })
    );
  const launch = async (published, exit = 0) => {
    const packageRoot = join(home, `package-${published.bundle.semanticVersion}-${sources.size}`);
    await mkdir(join(packageRoot, "config"), { recursive: true });
    await writeFile(join(packageRoot, "config", "root.json"), Buffer.from(published.trustedRoot));
    await writeFile(join(packageRoot, "config", "release-source.json"), JSON.stringify(published.source));
    const lines = [];
    const status = await runBootstrap(
      [`--exit=${exit}`],
      context(packageRoot),
      (line) => lines.push(line),
      closureFor(published)
    );
    return { status, lines, reads: sources.get(published)?.reads };
  };
  const activate = async (published) => {
    const target = await closureFor(published).activate({
      host: { platform: process.platform, arch: process.arch },
      source: published.source,
      trustedRoot: published.trustedRoot
    });
    return { target, reads: sources.get(published).reads };
  };
  const active = async () => JSON.parse(await readFile(join(installRoot, "active.json"), "utf8"));
  return { home, installRoot, launch, activate, active };
}

async function releasePair() {
  const keys = createUpdateKeys(2);
  const releaseA = await publishExecutableRelease({
    keys,
    metadataVersion: 1,
    semanticVersion: "1.0.0",
    launchers: versionedLaunchers("1.0.0")
  });
  const releaseB = await publishExecutableRelease({
    keys,
    metadataVersion: 2,
    semanticVersion: "2.0.0",
    launchers: versionedLaunchers("2.0.0")
  });
  assert.equal(releaseA.source.rootDigest, releaseB.source.rootDigest, "A and B share one trust root");
  assert.notEqual(releaseA.bundle.releaseDigest, releaseB.bundle.releaseDigest);
  return { keys, releaseA, releaseB };
}

async function updatedMachine() {
  const pair = await releasePair();
  const machine = await sharedMachine();
  assert.equal((await machine.launch(pair.releaseA)).status, 0, "A activates through TUF");
  assert.equal((await machine.launch(pair.releaseB)).status, 0, "B updates over A through TUF");
  assert.equal((await machine.active()).releaseDigest, pair.releaseB.bundle.releaseDigest);
  return { ...pair, machine };
}

test("A then B then A re-activates the retained A locally with zero source reads (#393)", async () => {
  const { releaseA, releaseB, machine } = await updatedMachine();

  const rolled = await machine.activate(releaseA);
  assert.equal(rolled.reads, 0, "the retained path must not read the distribution source at all");
  assert.deepEqual(rolled.target.activation, { operation: "rollback", releaseReused: true, network: false });
  assert.equal(rolled.target.releaseId, releaseA.bundle.releaseId);
  assert.equal(rolled.target.semanticVersion, "1.0.0");
  assert.equal((await machine.active()).releaseDigest, releaseA.bundle.releaseDigest);
  assert.equal(await absent(join(machine.installRoot, "activation-journal.json")), true, "rollback commits cleanly");

  // The superseded release stays retained: running it again executes it, still
  // with no source read, and the process result is the child's own status.
  const again = await machine.launch(releaseA, 5);
  assert.deepEqual(again.lines, []);
  assert.equal(again.status, 5);
  assert.equal(again.reads, 0);

  // B is still the latest verified release, so it keeps the network path.
  const steady = await machine.activate(releaseB);
  assert.ok(steady.reads > 0, "the latest verified release still resolves through TUF");
  assert.deepEqual(steady.target.activation, { operation: "activate", releaseReused: true, network: true });
});

test("without a verified-release record, re-invoking A after B is still refused as a TUF rollback", async () => {
  // The pre-#393 state: an install that recorded nothing (every published
  // package before this change) keeps today's behavior exactly.
  const { releaseA, releaseB, machine } = await updatedMachine();
  await rm(join(machine.installRoot, "verified"), { recursive: true, force: true });

  const result = await machine.launch(releaseA);
  assert.equal(result.status, 70);
  assert.match(result.lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: .*\(VES_TUF_ROLLBACK\)\./u);
  assert.ok(result.reads > 0, "with nothing retained the launcher resolves through the source");
  assert.equal((await machine.active()).releaseDigest, releaseB.bundle.releaseDigest, "B stays active");
});

test("a tampered retained A fails closed, never falls back to the network, and leaves B active", async () => {
  const { releaseA, releaseB, machine } = await updatedMachine();
  const component = releaseA.bundle.components.find((entry) => entry.componentId === "core:verchestra");
  await writeFile(
    join(releaseRootOf(machine.installRoot, releaseA.bundle), ...component.logicalPath.split("/")),
    Buffer.alloc(component.sizeBytes, 0x41)
  );

  const result = await machine.launch(releaseA);
  assert.equal(result.status, 70);
  assert.match(result.lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: .*\(VES_ACTIVATION_INTEGRITY\)\./u);
  assert.equal(result.reads, 0, "a failed local re-activation must not be laundered through the source");
  assert.equal((await machine.active()).releaseDigest, releaseB.bundle.releaseDigest);
});

test("an older release this machine never installed is still refused as a TUF rollback", async () => {
  const keys = createUpdateKeys(2);
  const neverInstalled = await publishExecutableRelease({
    keys,
    metadataVersion: 1,
    semanticVersion: "0.9.0",
    launchers: versionedLaunchers("0.9.0")
  });
  const current = await publishExecutableRelease({
    keys,
    metadataVersion: 2,
    semanticVersion: "2.0.0",
    launchers: versionedLaunchers("2.0.0")
  });
  const machine = await sharedMachine();
  assert.equal((await machine.launch(current)).status, 0);

  const result = await machine.launch(neverInstalled);
  assert.equal(result.status, 70);
  assert.match(result.lines[0], /^VES_VESTRA_ACTIVATION_UNAVAILABLE: .*\(VES_TUF_ROLLBACK\)\./u);
  assert.ok(result.reads > 0, "only the network path can serve a release that was never retained");
  assert.equal((await machine.active()).releaseDigest, current.bundle.releaseDigest);
});

test("a retained release is never re-activated locally under a different trust root", async () => {
  const { releaseA, machine } = await updatedMachine();
  // The same release identity, pinned by a package that carries another root.
  const otherRoot = await publishExecutableRelease({
    metadataVersion: 1,
    semanticVersion: "1.0.0",
    launchers: versionedLaunchers("1.0.0")
  });
  assert.notEqual(otherRoot.source.rootDigest, releaseA.source.rootDigest);
  assert.equal(otherRoot.source.releaseId, releaseA.source.releaseId);

  const resolved = await machine.activate(otherRoot);
  assert.ok(resolved.reads > 0, "a different root must resolve through its own TUF metadata");
  assert.equal(resolved.target.activation.network, true);
  assert.equal(resolved.target.activation.operation, "activate");
});
