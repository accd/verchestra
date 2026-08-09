import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { healthGate, materializeStagedRelease, passingHealth } from "../helpers/activation-fixture.mjs";

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t68-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup(options = {}) {
  const root = await temporary();
  const stagingRoot = join(root, "staging");
  const installRoot = join(root, "install");
  await mkdir(stagingRoot, { recursive: true });
  const staged = await materializeStagedRelease(stagingRoot, options.release ?? {});
  const gate = options.gate ?? healthGate();
  const manager = new TransactionalActivationManager({
    installRoot,
    stagingRoot,
    platform: options.platform ?? "win32",
    arch: options.arch ?? "x64",
    healthGate: gate,
    fault: options.fault
  });
  return { root, stagingRoot, installRoot, staged, gate, manager };
}

test("complete staged closure activates only after all health evidence passes", async () => {
  const state = await setup();
  const receipt = await state.manager.activate(state.staged.receipt);
  assert.equal(receipt.active.releaseDigest, state.staged.bundle.releaseDigest);
  assert.equal(receipt.previous, null);
  assert.equal(receipt.releaseReused, false);
  assert.equal(state.gate.calls.length, 1);
});

test("active pointer is a small exact release reference", async () => {
  const state = await setup();
  await state.manager.activate(state.staged.receipt);
  const value = JSON.parse(await readFile(join(state.installRoot, "active.json"), "utf8"));
  assert.deepEqual(value, {
    schemaVersion: 1,
    releaseId: state.staged.bundle.releaseId,
    releaseDigest: state.staged.bundle.releaseDigest,
    semanticVersion: state.staged.bundle.semanticVersion
  });
});

test("active launcher resolution revalidates the bundle-owned logical path", async () => {
  const state = await setup({
    release: { logicalPathOverrides: { "launcher:vestra": "tools/vestra-direct" } }
  });
  const receipt = await state.manager.activate(state.staged.receipt);
  const result = await state.manager.resolveActiveLauncher();
  assert.deepEqual(result.active, receipt.active);
  assert.equal(
    result.executablePath,
    join(state.installRoot, "releases", receipt.active.releaseDigest.slice("sha256:".length), "tools", "vestra-direct")
  );
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.active), true);
});

test("published release contains every exact component and its verified manifest", async () => {
  const state = await setup();
  await state.manager.activate(state.staged.receipt);
  const releaseRoot = join(state.installRoot, "releases", state.staged.bundle.releaseDigest.slice("sha256:".length));
  for (const component of state.staged.bundle.components) {
    assert.equal((await stat(join(releaseRoot, component.logicalPath))).size, component.sizeBytes);
  }
  const record = JSON.parse(await readFile(join(releaseRoot, "release.json"), "utf8"));
  assert.equal(record.bundle.releaseDigest, state.staged.bundle.releaseDigest);
});

test("repeated activation revalidates and reuses one installed release", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  const second = await state.manager.activate(state.staged.receipt);
  assert.equal(second.releaseReused, true);
  assert.deepEqual(second.active, first.active);
  assert.equal((await state.manager.active()).releaseDigest, first.active.releaseDigest);
});

test("a newer activation records and preserves the previous release", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  const next = await materializeStagedRelease(state.stagingRoot, {
    releaseId: "release:verchestra:2.0.0:win32-x64",
    semanticVersion: "2.0.0"
  });
  const result = await state.manager.activate(next.receipt);
  assert.deepEqual(result.previous, first.active);
  assert.equal(result.active.semanticVersion, "2.0.0");
  await access(join(state.installRoot, "releases", first.active.releaseDigest.slice("sha256:".length)));
});

test("rollback reinspects health and atomically selects a prior verified release", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  const next = await materializeStagedRelease(state.stagingRoot, {
    releaseId: "release:verchestra:2.0.0:win32-x64",
    semanticVersion: "2.0.0"
  });
  await state.manager.activate(next.receipt);
  const rolled = await state.manager.rollback(first.active.releaseDigest);
  assert.equal(rolled.operation, "rollback");
  assert.deepEqual(rolled.active, first.active);
  assert.equal(state.gate.calls.length, 3);
});

test("rollback to a missing release preserves current active release", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  await assert.rejects(state.manager.rollback(`sha256:${"0".repeat(64)}`), {
    code: "VES_ROLLBACK_TARGET_INVALID"
  });
  assert.deepEqual(await state.manager.active(), first.active);
});

test("rollback rejects a tampered installed component and preserves active", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  const next = await materializeStagedRelease(state.stagingRoot, {
    releaseId: "release:verchestra:2.0.0:win32-x64",
    semanticVersion: "2.0.0"
  });
  const second = await state.manager.activate(next.receipt);
  const component = state.staged.bundle.components[0];
  const path = join(
    state.installRoot,
    "releases",
    first.active.releaseDigest.slice("sha256:".length),
    component.logicalPath
  );
  await writeFile(path, Buffer.alloc(component.sizeBytes, 0x41));
  await assert.rejects(state.manager.rollback(first.active.releaseDigest), { code: "VES_ACTIVATION_INTEGRITY" });
  assert.deepEqual(await state.manager.active(), second.active);
});

for (const name of ["migration", "native", "driver"]) {
  test(`missing ${name} health evidence prevents activation`, async () => {
    const gate = healthGate();
    const state = await setup({ gate });
    gate.evaluate = async ({ bundle }) => ({
      ...passingHealth(bundle),
      checks: passingHealth(bundle).checks.filter((check) => check.name !== name)
    });
    await assert.rejects(state.manager.activate(state.staged.receipt), {
      code: "VES_ACTIVATION_HEALTH_FAILED"
    });
    assert.equal(await state.manager.active(), null);
  });
}

for (const mutation of ["version", "digest", "behavior", "exit", "missing"]) {
  test(`launcher equivalence mutation is rejected: ${mutation}`, async () => {
    const gate = healthGate();
    const state = await setup({ gate });
    gate.evaluate = async ({ bundle }) => {
      const evidence = passingHealth(bundle);
      if (mutation === "version") evidence.launchers[1].semanticVersion = "9.9.9";
      if (mutation === "digest") evidence.launchers[1].releaseDigest = `sha256:${"0".repeat(64)}`;
      if (mutation === "behavior") evidence.launchers[1].normalizedBehaviorDigest = `sha256:${"1".repeat(64)}`;
      if (mutation === "exit") evidence.launchers[1].exitCode = 1;
      if (mutation === "missing") evidence.launchers.pop();
      return evidence;
    };
    await assert.rejects(state.manager.activate(state.staged.receipt), {
      code: "VES_ACTIVATION_LAUNCHER_MISMATCH"
    });
    assert.equal(await state.manager.active(), null);
  });
}

test("health adapter failure preserves last-known-good", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  const next = await materializeStagedRelease(state.stagingRoot, {
    releaseId: "release:verchestra:2.0.0:win32-x64",
    semanticVersion: "2.0.0"
  });
  state.gate.evaluate = async () => {
    throw new Error("health process failed");
  };
  await assert.rejects(state.manager.activate(next.receipt), { code: "VES_ACTIVATION_HEALTH_FAILED" });
  assert.deepEqual(await state.manager.active(), first.active);
});

test("wrong platform stage is rejected before health", async () => {
  const state = await setup({ platform: "linux" });
  await assert.rejects(state.manager.activate(state.staged.receipt), { code: "VES_ACTIVATION_RELEASE_MIXED" });
  assert.equal(state.gate.calls.length, 0);
});

// T75 M-3. Every other activation case declares a win32-x64 target whatever the
// host is, which is legitimate — the target is a release selector and those
// cases exercise the mixed-release guard. What no case covered is the actual
// product scenario: activating the release built FOR this machine. That is the
// only shape in which the host's own filesystem behaviour is exercised end to
// end (the six `mkdir` mode-0o700 sites, the atomic rename, path handling), and
// on the platform fleet each leg now proves its own target. Assertions are
// platform-aware rather than skipped, following the F1a precedent: an
// unsupported host asserts the refusal contract instead of silently passing.
const SUPPORTED_TARGETS = new Set([
  "win32-x64",
  "win32-arm64",
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64"
]);

test("activates the release built for this host", async () => {
  const platform = process.platform;
  const arch = process.arch;
  const release = { platform, arch, releaseId: `release:verchestra:1.0.0:${platform}-${arch}` };

  if (!SUPPORTED_TARGETS.has(`${platform}-${arch}`)) {
    const root = await temporary();
    assert.throws(
      () =>
        new TransactionalActivationManager({
          installRoot: join(root, "install"),
          stagingRoot: join(root, "staging"),
          platform,
          arch,
          healthGate: healthGate()
        }),
      { code: "VES_ACTIVATION_ROOT_INVALID" },
      "an unsupported host must be refused, never activated"
    );
    return;
  }

  const state = await setup({ platform, arch, release });
  assert.equal(state.staged.bundle.target.platform, platform);
  assert.equal(state.staged.bundle.target.arch, arch);
  const receipt = await state.manager.activate(state.staged.receipt);
  assert.equal(receipt.active.releaseDigest, state.staged.bundle.releaseDigest);
  assert.equal(state.gate.calls.length, 1);
  // The release really landed on this host's filesystem, not just in a receipt.
  const releaseRoot = join(state.installRoot, "releases", state.staged.bundle.releaseDigest.slice("sha256:".length));
  await access(releaseRoot);
  assert.equal(JSON.parse(await readFile(join(state.installRoot, "active.json"), "utf8")).releaseId, release.releaseId);
});

test("authoritative-looking staged receipt is rejected", async () => {
  const state = await setup();
  await assert.rejects(state.manager.activate({ ...state.staged.receipt, activationAllowed: true }), {
    code: "VES_ACTIVATION_STAGE_INVALID"
  });
});

test("staged receipt input must equal the persisted receipt", async () => {
  const state = await setup();
  await assert.rejects(state.manager.activate({ ...state.staged.receipt, sourceId: "fixture:substituted" }), {
    code: "VES_ACTIVATION_STAGE_INVALID"
  });
});

test("staged component tamper preserves last-known-good", async () => {
  const state = await setup();
  const first = await state.manager.activate(state.staged.receipt);
  const next = await materializeStagedRelease(state.stagingRoot, {
    releaseId: "release:verchestra:2.0.0:win32-x64",
    semanticVersion: "2.0.0"
  });
  const component = next.bundle.components[0];
  await writeFile(join(next.stageRoot, component.logicalPath), Buffer.alloc(component.sizeBytes, 0x42));
  await assert.rejects(state.manager.activate(next.receipt), { code: "VES_ACTIVATION_INTEGRITY" });
  assert.deepEqual(await state.manager.active(), first.active);
});

test("install and staging roots must be disjoint", async () => {
  const root = await temporary();
  assert.throws(
    () =>
      new TransactionalActivationManager({
        installRoot: root,
        stagingRoot: join(root, "staging"),
        platform: "win32",
        arch: "x64",
        healthGate: healthGate()
      }),
    { code: "VES_ACTIVATION_ROOT_INVALID" }
  );
});

test("activation lock prevents concurrent mutation", async () => {
  const state = await setup();
  await mkdir(state.installRoot, { recursive: true });
  await writeFile(join(state.installRoot, "activation.lock"), "held");
  await assert.rejects(state.manager.activate(state.staged.receipt), { code: "VES_ACTIVATION_BUSY" });
});

test("uninstall without purge removes pointer but preserves verified releases and user data", async () => {
  const state = await setup();
  const installed = await state.manager.activate(state.staged.receipt);
  await writeFile(join(state.installRoot, "user-owned.txt"), "preserve");
  const receipt = await state.manager.uninstall({ purgeReleases: false });
  assert.equal(receipt.userDataPreserved, true);
  assert.equal(await state.manager.active(), null);
  await access(join(state.installRoot, "releases", installed.active.releaseDigest.slice("sha256:".length)));
  assert.equal(await readFile(join(state.installRoot, "user-owned.txt"), "utf8"), "preserve");
});

test("uninstall purge removes only managed releases and preserves user data", async () => {
  const state = await setup();
  await state.manager.activate(state.staged.receipt);
  await writeFile(join(state.installRoot, "user-owned.txt"), "preserve");
  const receipt = await state.manager.uninstall({ purgeReleases: true });
  assert.equal(receipt.releasesPurged, true);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(join(state.installRoot, "releases")), []);
  assert.equal(await readFile(join(state.installRoot, "user-owned.txt"), "utf8"), "preserve");
});
