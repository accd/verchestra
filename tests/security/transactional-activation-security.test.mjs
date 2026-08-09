import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { healthGate, materializeStagedRelease, passingHealth } from "../helpers/activation-fixture.mjs";

const roots = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t68-security-"));
  roots.push(root);
  return root;
};
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup(gate = healthGate()) {
  const root = await temporary();
  const stagingRoot = join(root, "staging");
  const installRoot = join(root, "install");
  await mkdir(stagingRoot);
  const staged = await materializeStagedRelease(stagingRoot);
  const manager = new TransactionalActivationManager({
    installRoot,
    stagingRoot,
    platform: "win32",
    arch: "x64",
    healthGate: gate
  });
  return { root, stagingRoot, installRoot, staged, gate, manager };
}

test("unknown staged receipt field cannot smuggle activation authority", async () => {
  const state = await setup();
  await assert.rejects(state.manager.activate({ ...state.staged.receipt, activateNow: true }), {
    code: "VES_ACTIVATION_STAGE_INVALID"
  });
});

test("stage identity must be derived from the verified release digest", async () => {
  const state = await setup();
  const receipt = { ...state.staged.receipt, stageId: "stage:forged" };
  await writeFile(join(state.staged.stageRoot, "staged-release.json"), `${JSON.stringify(receipt)}\n`);
  await assert.rejects(state.manager.activate(receipt), { code: "VES_ACTIVATION_STAGE_INVALID" });
});

test("unknown health evidence field is rejected before publication", async () => {
  const gate = healthGate();
  const state = await setup(gate);
  gate.evaluate = async ({ bundle }) => ({ ...passingHealth(bundle), credential: "secret" });
  await assert.rejects(state.manager.activate(state.staged.receipt), {
    code: "VES_ACTIVATION_HEALTH_INVALID"
  });
});

test("unknown nested health check field is rejected", async () => {
  const gate = healthGate();
  const state = await setup(gate);
  gate.evaluate = async ({ bundle }) => {
    const evidence = passingHealth(bundle);
    evidence.checks[0].command = "unreviewed";
    return evidence;
  };
  await assert.rejects(state.manager.activate(state.staged.receipt), {
    code: "VES_ACTIVATION_HEALTH_FAILED"
  });
});

test("duplicate launcher evidence cannot collapse into a valid map", async () => {
  const gate = healthGate();
  const state = await setup(gate);
  gate.evaluate = async ({ bundle }) => {
    const evidence = passingHealth(bundle);
    evidence.launchers.push({ ...evidence.launchers[0] });
    return evidence;
  };
  await assert.rejects(state.manager.activate(state.staged.receipt), {
    code: "VES_ACTIVATION_LAUNCHER_MISMATCH"
  });
});

test("unknown active pointer field fails closed", async () => {
  const state = await setup();
  await state.manager.activate(state.staged.receipt);
  const path = join(state.installRoot, "active.json");
  const value = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, `${JSON.stringify({ ...value, command: "run" })}\n`);
  await assert.rejects(state.manager.active(), { code: "VES_ACTIVATION_POINTER_INVALID" });
});

test("active launcher resolution requires an authoritative active pointer", async () => {
  const state = await setup();
  await assert.rejects(state.manager.resolveActiveLauncher(), { code: "VES_ACTIVATION_POINTER_MISSING" });
});

test("active launcher resolution rejects pointer and installed release identity drift", async () => {
  const state = await setup();
  await state.manager.activate(state.staged.receipt);
  const path = join(state.installRoot, "active.json");
  const value = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, `${JSON.stringify({ ...value, releaseId: "release:substituted" })}\n`);
  await assert.rejects(state.manager.resolveActiveLauncher(), { code: "VES_ACTIVATION_RELEASE_MIXED" });
});

test("active launcher resolution rehashes installed launcher bytes", async () => {
  const state = await setup();
  const receipt = await state.manager.activate(state.staged.receipt);
  const launcher = state.staged.bundle.components.find((entry) => entry.componentId === "launcher:vestra");
  const path = join(
    state.installRoot,
    "releases",
    receipt.active.releaseDigest.slice("sha256:".length),
    launcher.logicalPath
  );
  await writeFile(path, Buffer.alloc(launcher.sizeBytes, 0x41));
  await assert.rejects(state.manager.resolveActiveLauncher(), { code: "VES_ACTIVATION_INTEGRITY" });
});

test("active launcher resolution rejects a launcher path junction", async () => {
  const state = await setup();
  const receipt = await state.manager.activate(state.staged.receipt);
  const releaseRoot = join(state.installRoot, "releases", receipt.active.releaseDigest.slice("sha256:".length));
  const outside = join(state.root, "outside-launcher");
  await mkdir(outside);
  await rm(join(releaseRoot, "bin"), { recursive: true });
  await symlink(outside, join(releaseRoot, "bin"), "junction");
  await assert.rejects(state.manager.resolveActiveLauncher(), { code: "VES_ACTIVATION_INTEGRITY" });
});

for (const value of ["yes", 1, null]) {
  test(`uninstall rejects non-boolean purge policy: ${String(value)}`, async () => {
    const state = await setup();
    await assert.rejects(state.manager.uninstall({ purgeReleases: value }), {
      code: "VES_UNINSTALL_INPUT_INVALID"
    });
  });
}

test("unsupported activation target is rejected at construction", async () => {
  const root = await temporary();
  assert.throws(
    () =>
      new TransactionalActivationManager({
        installRoot: join(root, "install"),
        stagingRoot: join(root, "staging"),
        platform: "freebsd",
        arch: "x64",
        healthGate: healthGate()
      }),
    { code: "VES_ACTIVATION_ROOT_INVALID" }
  );
});

test("transaction directory junction cannot redirect release publication", async () => {
  const state = await setup();
  const outside = join(state.root, "outside");
  const transaction = join(
    state.installRoot,
    "transactions",
    state.staged.bundle.releaseDigest.slice("sha256:".length)
  );
  await mkdir(join(state.installRoot, "transactions"), { recursive: true });
  await mkdir(outside);
  await symlink(outside, transaction, "junction");
  await assert.rejects(state.manager.activate(state.staged.receipt), {
    code: "VES_ACTIVATION_STAGE_INVALID"
  });
});

test("live process activation lock cannot be reclaimed", async () => {
  const state = await setup();
  await mkdir(state.installRoot, { recursive: true });
  await writeFile(
    join(state.installRoot, "activation.lock"),
    `${JSON.stringify({ pid: process.pid, nonce: "00000000-0000-4000-8000-000000000000" })}\n`
  );
  await assert.rejects(state.manager.activate(state.staged.receipt), { code: "VES_ACTIVATION_BUSY" });
});

test("dead process activation lock is reclaimed before journal reconciliation", async () => {
  const state = await setup();
  await mkdir(state.installRoot, { recursive: true });
  await writeFile(
    join(state.installRoot, "activation.lock"),
    `${JSON.stringify({ pid: 2_147_483_647, nonce: "00000000-0000-4000-8000-000000000000" })}\n`
  );
  const result = await state.manager.activate(state.staged.receipt);
  assert.equal(result.active.releaseDigest, state.staged.bundle.releaseDigest);
});
