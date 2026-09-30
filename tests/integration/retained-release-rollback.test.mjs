import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { healthGate, materializeStagedRelease } from "../helpers/activation-fixture.mjs";

// #393 / AD-036. The verified-release record and the trust-bound rollback that
// reads it. The launcher-level sequence is in
// tests/e2e/vestra-launcher-activation.test.mjs; these cases pin the manager's
// half of the contract directly.

const ROOT_ONE = `sha256:${"1".repeat(64)}`;
const ROOT_TWO = `sha256:${"2".repeat(64)}`;

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-retained-"));
  roots.push(root);
  const stagingRoot = join(root, "staging");
  const installRoot = join(root, "install");
  await mkdir(stagingRoot, { recursive: true });
  const gate = healthGate();
  const manager = new TransactionalActivationManager({
    installRoot,
    stagingRoot,
    platform: "win32",
    arch: "x64",
    healthGate: gate
  });
  const release = (semanticVersion) =>
    materializeStagedRelease(stagingRoot, {
      releaseId: `release:verchestra:${semanticVersion}:win32-x64`,
      semanticVersion
    });
  return { root, stagingRoot, installRoot, gate, manager, release };
}

const recordOf = async (installRoot, trustRootDigest) =>
  JSON.parse(await readFile(join(installRoot, "verified", `${trustRootDigest.slice("sha256:".length)}.json`), "utf8"));

const queryFor = (bundle, trustRootDigest = ROOT_ONE) => ({
  trustRootDigest,
  releaseId: bundle.releaseId,
  semanticVersion: bundle.semanticVersion
});

async function updated() {
  const state = await setup();
  const a = await state.release("1.0.0");
  const b = await state.release("2.0.0");
  const first = await state.manager.activate(a.receipt, { trustRootDigest: ROOT_ONE });
  const second = await state.manager.activate(b.receipt, { trustRootDigest: ROOT_ONE });
  return { ...state, a, b, first, second };
}

test("a TUF-verified activation records the release under its trust root, latest last", async () => {
  const { installRoot, a, b } = await updated();
  const record = await recordOf(installRoot, ROOT_ONE);
  assert.deepEqual(record, {
    schemaVersion: 1,
    trustRootDigest: ROOT_ONE,
    releases: [a, b].map(({ bundle }) => ({
      releaseId: bundle.releaseId,
      releaseDigest: bundle.releaseDigest,
      semanticVersion: bundle.semanticVersion
    }))
  });
});

test("an activation without provenance records nothing, so nothing becomes retained", async () => {
  const state = await setup();
  const a = await state.release("1.0.0");
  const b = await state.release("2.0.0");
  await state.manager.activate(a.receipt);
  await state.manager.activate(b.receipt);
  assert.deepEqual(await readdir(join(state.installRoot, "verified")), []);
  assert.equal(await state.manager.retainedRelease(queryFor(a.bundle)), null);
});

test("only a superseded release is retained; the latest verified release is not", async () => {
  const { manager, a, b } = await updated();
  assert.equal(await manager.retainedRelease(queryFor(b.bundle)), null, "the latest keeps the network path");
  const retained = await manager.retainedRelease(queryFor(a.bundle));
  assert.equal(retained.active.releaseDigest, a.bundle.releaseDigest);
  assert.deepEqual(retained.bundle, a.bundle);
});

test("a retained release is not visible under a different trust root", async () => {
  const { manager, a } = await updated();
  assert.equal(await manager.retainedRelease(queryFor(a.bundle, ROOT_TWO)), null);
});

test("a trust-bound rollback re-activates a retained release and does not reorder the record", async () => {
  const { installRoot, manager, gate, a, first, second } = await updated();
  const before = await recordOf(installRoot, ROOT_ONE);
  const healthCalls = gate.calls.length;

  const rolled = await manager.rollback(a.bundle.releaseDigest, { trustRootDigest: ROOT_ONE });

  assert.deepEqual(rolled, {
    schemaVersion: 1,
    operation: "rollback",
    previous: second.active,
    active: first.active,
    releaseReused: true
  });
  assert.equal(gate.calls.length, healthCalls + 1, "the health gate runs again before the pointer moves");
  assert.deepEqual(await recordOf(installRoot, ROOT_ONE), before, "a rollback is not a fresh verification");
  assert.equal((await manager.retainedRelease(queryFor(a.bundle))).active.releaseDigest, a.bundle.releaseDigest);
});

test("a trust-bound rollback refuses a release recorded only under another root", async () => {
  const { manager, a, second } = await updated();
  await assert.rejects(manager.rollback(a.bundle.releaseDigest, { trustRootDigest: ROOT_TWO }), {
    code: "VES_ROLLBACK_TARGET_UNTRUSTED"
  });
  assert.deepEqual(await manager.active(), second.active);
});

test("a trust-bound rollback refuses an installed release that was never recorded", async () => {
  const state = await setup();
  const a = await state.release("1.0.0");
  const b = await state.release("2.0.0");
  await state.manager.activate(a.receipt);
  const second = await state.manager.activate(b.receipt, { trustRootDigest: ROOT_ONE });
  await assert.rejects(state.manager.rollback(a.bundle.releaseDigest, { trustRootDigest: ROOT_ONE }), {
    code: "VES_ROLLBACK_TARGET_UNTRUSTED"
  });
  assert.deepEqual(await state.manager.active(), second.active);
});

test("a release verified again through TUF moves to the end of the record", async () => {
  const { installRoot, manager, a, b } = await updated();
  await manager.activate(a.receipt, { trustRootDigest: ROOT_ONE });
  const record = await recordOf(installRoot, ROOT_ONE);
  assert.deepEqual(
    record.releases.map((entry) => entry.releaseDigest),
    [b.bundle.releaseDigest, a.bundle.releaseDigest]
  );
  assert.equal(await manager.retainedRelease(queryFor(a.bundle)), null);
  assert.equal((await manager.retainedRelease(queryFor(b.bundle))).active.releaseDigest, b.bundle.releaseDigest);
});

test("an ambiguous identity is not retained", async () => {
  const state = await setup();
  const a = await state.release("1.0.0");
  // A second build that claims the same release identity with different bytes.
  const twin = await materializeStagedRelease(state.stagingRoot, {
    releaseId: a.bundle.releaseId,
    semanticVersion: a.bundle.semanticVersion,
    logicalPathOverrides: { "core:verchestra": "components/core-twin" }
  });
  assert.notEqual(twin.bundle.releaseDigest, a.bundle.releaseDigest);
  const b = await state.release("2.0.0");
  for (const staged of [a, twin, b]) await state.manager.activate(staged.receipt, { trustRootDigest: ROOT_ONE });
  assert.equal(await state.manager.retainedRelease(queryFor(a.bundle)), null);
});

test("a recorded release that is no longer installed is not retained", async () => {
  const { installRoot, manager, a } = await updated();
  await rm(join(installRoot, "releases", a.bundle.releaseDigest.slice("sha256:".length)), {
    recursive: true,
    force: true
  });
  assert.equal(await manager.retainedRelease(queryFor(a.bundle)), null);
});

test("a purging uninstall removes the verified-release records with the releases", async () => {
  const { installRoot, manager, a } = await updated();
  await manager.uninstall({ purgeReleases: true });
  assert.deepEqual(await readdir(join(installRoot, "verified")), []);
  assert.equal(await manager.retainedRelease(queryFor(a.bundle)), null);
});

test("an uninstall without purge keeps retained releases re-activatable", async () => {
  const { manager, a, first } = await updated();
  await manager.uninstall({ purgeReleases: false });
  const rolled = await manager.rollback(a.bundle.releaseDigest, { trustRootDigest: ROOT_ONE });
  assert.equal(rolled.previous, null);
  assert.deepEqual(rolled.active, first.active);
});

test("the retained lookup creates nothing in an absent install root", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-retained-absent-"));
  roots.push(root);
  const manager = new TransactionalActivationManager({
    installRoot: join(root, "install"),
    stagingRoot: join(root, "staging"),
    platform: "win32",
    arch: "x64",
    healthGate: healthGate()
  });
  const query = {
    trustRootDigest: ROOT_ONE,
    releaseId: "release:verchestra:1.0.0:win32-x64",
    semanticVersion: "1.0.0"
  };
  assert.equal(await manager.retainedRelease(query), null);
  assert.deepEqual(await readdir(root), []);
});
