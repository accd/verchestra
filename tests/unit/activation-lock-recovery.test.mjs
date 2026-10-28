import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { healthGate } from "../helpers/activation-fixture.mjs";

const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

const NONCE = "00000000-0000-4000-8000-000000000000";
const DEAD_PID = 2_147_483_647;

async function managerWithLock(lockText) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-activation-lock-"));
  roots.push(root);
  const installRoot = join(root, "install");
  const stagingRoot = join(root, "staging");
  await mkdir(installRoot, { recursive: true });
  await mkdir(stagingRoot, { recursive: true });
  const lockPath = join(installRoot, "activation.lock");
  if (lockText !== undefined) await writeFile(lockPath, lockText);
  const manager = new TransactionalActivationManager({
    installRoot,
    stagingRoot,
    platform: "win32",
    arch: "x64",
    healthGate: healthGate()
  });
  return { manager, lockPath };
}

const owner = (fields) => `${JSON.stringify(fields)}\n`;

for (const [name, lockText] of [
  ["text that is not JSON", "held"],
  ["a JSON null", "null"],
  ["a nonce that is not a UUID", owner({ pid: DEAD_PID, nonce: "not-a-uuid" })],
  ["a pid that is not positive", owner({ pid: 0, nonce: NONCE })],
  ["a pid that is not an integer", owner({ pid: 1.5, nonce: NONCE })]
]) {
  test(`a lock whose owner is ${name} is never reclaimed`, async () => {
    const { manager, lockPath } = await managerWithLock(lockText);
    await assert.rejects(manager.uninstall({ purgeReleases: false }), {
      code: "VES_ACTIVATION_BUSY",
      message: "another activation owns the install root"
    });
    await access(lockPath);
  });
}

test("a lock owned by a live process is never reclaimed", async () => {
  const { manager, lockPath } = await managerWithLock(owner({ pid: process.pid, nonce: NONCE }));
  await assert.rejects(manager.uninstall({ purgeReleases: false }), {
    code: "VES_ACTIVATION_BUSY",
    message: "another activation owns the install root"
  });
  await access(lockPath);
});

test("a lock left by a dead owner is reclaimed and released after the operation", async () => {
  const { manager, lockPath } = await managerWithLock(owner({ pid: DEAD_PID, nonce: NONCE }));
  const receipt = await manager.uninstall({ purgeReleases: false });
  assert.deepEqual(receipt, {
    schemaVersion: 1,
    previous: null,
    releasesPurged: false,
    userDataPreserved: true
  });
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});

test("an unheld install root takes and releases its own lock", async () => {
  const { manager, lockPath } = await managerWithLock(undefined);
  await manager.uninstall({ purgeReleases: true });
  await assert.rejects(access(lockPath), { code: "ENOENT" });
});
