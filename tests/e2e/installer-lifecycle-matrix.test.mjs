import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  SUPPORTED_LAUNCHER_ARCHES,
  SUPPORTED_LAUNCHER_PLATFORMS
} from "../../apps/vestra-launcher/src/supported-host.ts";
import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { healthGate, materializeStagedRelease } from "../helpers/activation-fixture.mjs";

// T75 installer matrix: install -> activate -> rollback -> uninstall, across
// the declared host set.
//
// The activation surface was already covered densely, one transition at a
// time: tests/integration/transactional-activation.test.mjs proves activate,
// re-activate, rollback and uninstall; the fault and security suites prove
// their refusals. What no test anywhere did was run the transitions as one
// sequence against one install root. Every uninstall case in the repository
// starts from a fresh activate, so the state uninstall is asked to clean up has
// only ever arrived one way, and the post-rollback install root — where the
// active pointer names an older release than the newest installed one — was
// never uninstalled at all.
//
// This file is the sequence, and it lives in test:e2e deliberately. The
// uninstall happy path previously existed only in test:integration, which
// `gate:security` and `gate:release` do not run (matrix.md section 2), so a
// release-gated run could see uninstall's refusals but never its behaviour.
// test:e2e runs in full, build and security.

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t75-installer-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

// The declared host set, read from the launcher's canonical declaration. A
// platform or architecture added there enters this matrix automatically.
const DECLARED_TARGETS = SUPPORTED_LAUNCHER_PLATFORMS.flatMap((platform) =>
  SUPPORTED_LAUNCHER_ARCHES.map((arch) => ({ platform, arch }))
);

const releaseFor = (platform, arch, semanticVersion) => ({
  platform,
  arch,
  semanticVersion,
  releaseId: `release:verchestra:${semanticVersion}:${platform}-${arch}`
});

async function installRoot({ platform, arch }) {
  const root = await temporary();
  const stagingRoot = join(root, "staging");
  const installRootPath = join(root, "install");
  await mkdir(stagingRoot, { recursive: true });
  const gate = healthGate();
  const manager = new TransactionalActivationManager({
    installRoot: installRootPath,
    stagingRoot,
    platform,
    arch,
    healthGate: gate
  });
  return { stagingRoot, installRoot: installRootPath, manager, gate };
}

const releaseDirectory = (root, digest) => join(root, "releases", digest.slice("sha256:".length));

test("the matrix covers exactly the declared launcher host set", () => {
  // The binding. A host added to the launcher's frozen lists enters this matrix
  // rather than gaining an installer with no lifecycle evidence.
  assert.deepEqual(DECLARED_TARGETS.map((target) => `${target.platform}-${target.arch}`).sort(), [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win32-arm64",
    "win32-x64"
  ]);
  assert.equal(DECLARED_TARGETS.length, 6);
});

for (const target of DECLARED_TARGETS) {
  const name = `${target.platform}-${target.arch}`;

  test(`${name} is an accepted activation target`, async () => {
    // The release-target axis. Every declared host must be constructible as an
    // activation target on any runner, because a release is built for a target
    // and staged from wherever the build ran.
    const root = await temporary();
    const manager = new TransactionalActivationManager({
      installRoot: join(root, "install"),
      stagingRoot: join(root, "staging"),
      platform: target.platform,
      arch: target.arch,
      healthGate: healthGate()
    });
    assert.equal(await manager.active(), null, "a fresh install root has no active release");
  });

  test(`${name} completes install, activate, rollback, and uninstall as one sequence`, async () => {
    // The sequence no test ran. Each step asserts the state the next step
    // depends on, so a transition that only works from a fresh root fails here.
    const state = await installRoot(target);

    // 1. INSTALL — stage and activate the first release.
    const first = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "1.0.0"));
    const installed = await state.manager.activate(first.receipt);
    assert.equal(installed.previous, null, "the first activation has no predecessor");
    assert.equal(installed.active.releaseDigest, first.bundle.releaseDigest);
    await access(releaseDirectory(state.installRoot, first.bundle.releaseDigest));

    // A file the operator owns. It must survive every later transition.
    await writeFile(join(state.installRoot, "user-owned.txt"), "preserve");

    // 2. ACTIVATE — a newer release supersedes it and records the predecessor.
    const second = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "2.0.0"));
    const upgraded = await state.manager.activate(second.receipt);
    assert.deepEqual(upgraded.previous, installed.active, "an upgrade must record exactly the release it replaced");
    assert.equal(upgraded.active.releaseDigest, second.bundle.releaseDigest);

    // 3. ROLLBACK — back to the first release, re-inspecting its health.
    const healthCallsBeforeRollback = state.gate.calls.length;
    const rolled = await state.manager.rollback(first.bundle.releaseDigest);
    assert.equal(rolled.operation, "rollback");
    assert.deepEqual(rolled.active, installed.active, "rollback must select the exact prior release");
    assert.equal(
      state.gate.calls.length,
      healthCallsBeforeRollback + 1,
      "rollback re-inspects health rather than trusting the earlier verdict"
    );
    // Both releases are still installed; rollback moves the pointer, not the bytes.
    await access(releaseDirectory(state.installRoot, first.bundle.releaseDigest));
    await access(releaseDirectory(state.installRoot, second.bundle.releaseDigest));

    // 4. UNINSTALL — from the rolled-back state, which is the transition that
    // had no coverage: the active pointer names an older release than the
    // newest installed one.
    const removed = await state.manager.uninstall({ purgeReleases: false });
    assert.equal(removed.userDataPreserved, true);
    assert.deepEqual(removed.previous, installed.active, "uninstall reports the release it deactivated");
    assert.equal(await state.manager.active(), null, "uninstall clears the active pointer");
    assert.equal(await readFile(join(state.installRoot, "user-owned.txt"), "utf8"), "preserve");
    // Without purge, both verified releases survive an uninstall that followed
    // a rollback, not only one that followed an activation.
    await access(releaseDirectory(state.installRoot, first.bundle.releaseDigest));
    await access(releaseDirectory(state.installRoot, second.bundle.releaseDigest));
  });
}

test("a purge after a rollback removes every managed release and no user data", async () => {
  // The purge half of the same untested transition. One host is enough: the
  // release-target axis is covered above and purge is host-independent, so
  // repeating it six times would add runtime without adding a case.
  const target = { platform: "win32", arch: "x64" };
  const state = await installRoot(target);
  const first = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "1.0.0"));
  await state.manager.activate(first.receipt);
  const second = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "2.0.0"));
  await state.manager.activate(second.receipt);
  await state.manager.rollback(first.bundle.releaseDigest);
  await writeFile(join(state.installRoot, "user-owned.txt"), "preserve");

  const receipt = await state.manager.uninstall({ purgeReleases: true });
  assert.equal(receipt.releasesPurged, true);
  assert.equal(receipt.userDataPreserved, true);
  assert.deepEqual(await readdir(join(state.installRoot, "releases")), [], "purge must leave no managed release");
  assert.equal(await readFile(join(state.installRoot, "user-owned.txt"), "utf8"), "preserve");
});

test("an install root can be reinstalled after a purging uninstall", async () => {
  // Uninstall must leave a root a later install can use. If purge left behind
  // a pointer, a journal, or a lock, the next activation would fail and the
  // operator's only recovery would be deleting the directory by hand.
  const target = { platform: "win32", arch: "x64" };
  const state = await installRoot(target);
  const first = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "1.0.0"));
  await state.manager.activate(first.receipt);
  await state.manager.uninstall({ purgeReleases: true });
  assert.equal(await state.manager.active(), null);

  const reinstalled = await state.manager.activate(first.receipt);
  assert.equal(reinstalled.active.releaseDigest, first.bundle.releaseDigest);
  assert.equal(reinstalled.previous, null, "a reinstall after a purge starts from no predecessor");
  await access(releaseDirectory(state.installRoot, first.bundle.releaseDigest));
});

test("rollback to a release the purge removed is refused, and the root stays usable", async () => {
  // The failure the previous test's cleanliness could otherwise hide: a purged
  // release must not be silently re-selectable, and refusing it must not wedge
  // the install root.
  const target = { platform: "win32", arch: "x64" };
  const state = await installRoot(target);
  const first = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "1.0.0"));
  await state.manager.activate(first.receipt);
  const second = await materializeStagedRelease(state.stagingRoot, releaseFor(target.platform, target.arch, "2.0.0"));
  await state.manager.activate(second.receipt);
  await state.manager.uninstall({ purgeReleases: true });

  await assert.rejects(state.manager.rollback(first.bundle.releaseDigest), { code: "VES_ROLLBACK_TARGET_INVALID" });
  assert.equal(await state.manager.active(), null, "a refused rollback leaves the root deactivated, not corrupted");
  const recovered = await state.manager.activate(second.receipt);
  assert.equal(recovered.active.releaseDigest, second.bundle.releaseDigest);
});

test("an undeclared host is refused as an activation target", async () => {
  // The closed half of the host axis. Recorded as an executed refusal so the
  // declared set means something.
  const root = await temporary();
  for (const candidate of [
    { platform: "aix", arch: "x64" },
    { platform: "linux", arch: "ia32" },
    { platform: "Win32", arch: "x64" }
  ])
    assert.throws(
      () =>
        new TransactionalActivationManager({
          installRoot: join(root, "install"),
          stagingRoot: join(root, "staging"),
          platform: candidate.platform,
          arch: candidate.arch,
          healthGate: healthGate()
        }),
      { code: "VES_ACTIVATION_ROOT_INVALID" },
      `${candidate.platform}-${candidate.arch} was accepted as an activation target`
    );
});
