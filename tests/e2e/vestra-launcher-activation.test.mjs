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
