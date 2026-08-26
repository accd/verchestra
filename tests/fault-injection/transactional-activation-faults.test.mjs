import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { TransactionalActivationManager } from "../../packages/distribution/src/transactional-activation.ts";
import { healthGate, materializeStagedRelease } from "../helpers/activation-fixture.mjs";

const roots = [];
const children = [];
const temporary = async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-t68-fault-"));
  roots.push(root);
  return root;
};
afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
});

const managerFor = (state, options = {}) =>
  new TransactionalActivationManager({
    installRoot: state.installRoot,
    stagingRoot: state.stagingRoot,
    platform: "win32",
    arch: "x64",
    healthGate: options.gate ?? state.gate,
    fault: options.fault
  });

async function seeded() {
  const root = await temporary();
  const stagingRoot = join(root, "staging");
  const installRoot = join(root, "install");
  await mkdir(stagingRoot, { recursive: true });
  const stable = await materializeStagedRelease(stagingRoot, {
    releaseId: "release:verchestra:1.0.0:win32-x64",
    semanticVersion: "1.0.0"
  });
  const candidate = await materializeStagedRelease(stagingRoot, {
    releaseId: "release:verchestra:2.0.0:win32-x64",
    semanticVersion: "2.0.0"
  });
  const state = { root, stagingRoot, installRoot, stable, candidate, gate: healthGate() };
  const manager = managerFor(state);
  const installed = await manager.activate(stable.receipt);
  return { ...state, manager, stablePointer: installed.active };
}

for (const point of [
  "after-copy",
  "after-health",
  "after-journal-prepared",
  "after-publish",
  "after-journal-published",
  "after-pointer",
  "after-journal-committed"
]) {
  test(`crash at ${point} converges on retry without losing last-known-good`, async () => {
    const state = await seeded();
    let injected = false;
    const crashing = managerFor(state, {
      fault(current) {
        if (!injected && current === point) {
          injected = true;
          throw new Error(`crash:${point}`);
        }
      }
    });
    await assert.rejects(crashing.activate(state.candidate.receipt), { code: "VES_ACTIVATION_FAILED" });
    const afterCrash = await crashing.active();
    if (["after-pointer", "after-journal-committed"].includes(point)) {
      assert.equal(afterCrash.releaseDigest, state.candidate.bundle.releaseDigest);
    } else {
      assert.deepEqual(afterCrash, state.stablePointer);
    }
    const recovered = await managerFor(state).activate(state.candidate.receipt);
    assert.equal(recovered.active.releaseDigest, state.candidate.bundle.releaseDigest);
    assert.equal((await managerFor(state).active()).releaseDigest, state.candidate.bundle.releaseDigest);
    await assert.rejects(access(join(state.installRoot, "activation-journal.json")));
  });
}

test("published candidate remains inactive after crash before pointer", async () => {
  const state = await seeded();
  const crashing = managerFor(state, {
    fault(point) {
      if (point === "after-publish") throw new Error("crash after publish");
    }
  });
  await assert.rejects(crashing.activate(state.candidate.receipt), { code: "VES_ACTIVATION_FAILED" });
  await access(join(state.installRoot, "releases", state.candidate.bundle.releaseDigest.slice("sha256:".length)));
  assert.deepEqual(await crashing.active(), state.stablePointer);
});

test("foreign activation journal blocks a different candidate", async () => {
  const state = await seeded();
  await writeFile(
    join(state.installRoot, "activation-journal.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      operation: "activate",
      state: "PREPARED",
      target: state.stablePointer,
      previous: null,
      health: {}
    })}\n`
  );
  await assert.rejects(managerFor(state).activate(state.candidate.receipt), {
    code: "VES_ACTIVATION_RECOVERY_REQUIRED"
  });
  assert.deepEqual(await managerFor(state).active(), state.stablePointer);
});

test("malformed active pointer fails closed", async () => {
  const state = await seeded();
  await writeFile(join(state.installRoot, "active.json"), "{}\n");
  await assert.rejects(managerFor(state).activate(state.candidate.receipt), {
    code: "VES_ACTIVATION_POINTER_INVALID"
  });
});

test("rollback health failure preserves the newer active release", async () => {
  const state = await seeded();
  const next = await state.manager.activate(state.candidate.receipt);
  const failingGate = healthGate({ error: new Error("rollback smoke failed") });
  await assert.rejects(managerFor(state, { gate: failingGate }).rollback(state.stable.bundle.releaseDigest), {
    code: "VES_ACTIVATION_HEALTH_FAILED"
  });
  assert.deepEqual(await state.manager.active(), next.active);
});

test("rollback acknowledgement loss after pointer converges on retry", async () => {
  const state = await seeded();
  await state.manager.activate(state.candidate.receipt);
  let injected = false;
  const crashing = managerFor(state, {
    fault(point) {
      if (!injected && point === "after-pointer") {
        injected = true;
        throw new Error("rollback acknowledgement lost");
      }
    }
  });
  await assert.rejects(crashing.rollback(state.stable.bundle.releaseDigest), { code: "VES_ROLLBACK_FAILED" });
  assert.equal((await crashing.active()).releaseDigest, state.stable.bundle.releaseDigest);
  const retried = await managerFor(state).rollback(state.stable.bundle.releaseDigest);
  assert.equal(retried.active.releaseDigest, state.stable.bundle.releaseDigest);
});

test("staging-root junction is rejected before component reads", async () => {
  const root = await temporary();
  const actual = join(root, "actual-stage");
  const linked = join(root, "linked-stage");
  const installRoot = join(root, "install");
  await mkdir(actual);
  const staged = await materializeStagedRelease(actual);
  await symlink(actual, linked, "junction");
  const manager = new TransactionalActivationManager({
    installRoot,
    stagingRoot: linked,
    platform: "win32",
    arch: "x64",
    healthGate: healthGate()
  });
  await assert.rejects(manager.activate(staged.receipt), { code: "VES_ACTIVATION_STAGE_INVALID" });
});

test("tampered installed release record blocks idempotent success", async () => {
  const state = await seeded();
  const releaseRoot = join(state.installRoot, "releases", state.stable.bundle.releaseDigest.slice("sha256:".length));
  await writeFile(join(releaseRoot, "release.json"), "{}\n");
  await assert.rejects(state.manager.activate(state.stable.receipt), { code: "VES_ROLLBACK_TARGET_INVALID" });
});

test("failed health leaves no published candidate and can be retried", async () => {
  const state = await seeded();
  const failing = managerFor(state, { gate: healthGate({ error: new Error("native smoke failed") }) });
  await assert.rejects(failing.activate(state.candidate.receipt), { code: "VES_ACTIVATION_HEALTH_FAILED" });
  await assert.rejects(
    access(join(state.installRoot, "releases", state.candidate.bundle.releaseDigest.slice("sha256:".length)))
  );
  const recovered = await managerFor(state).activate(state.candidate.receipt);
  assert.equal(recovered.active.releaseDigest, state.candidate.bundle.releaseDigest);
});

test("uninstall respects the same exclusive activation lock", async () => {
  const state = await seeded();
  await writeFile(join(state.installRoot, "activation.lock"), "held");
  await assert.rejects(state.manager.uninstall({ purgeReleases: true }), { code: "VES_ACTIVATION_BUSY" });
  assert.deepEqual(await state.manager.active(), state.stablePointer);
});

test("crash after committed journal preserves a byte-valid active pointer", async () => {
  const state = await seeded();
  const crashing = managerFor(state, {
    fault(point) {
      if (point === "after-journal-committed") throw new Error("lost final acknowledgement");
    }
  });
  await assert.rejects(crashing.activate(state.candidate.receipt), { code: "VES_ACTIVATION_FAILED" });
  const persisted = JSON.parse(await readFile(join(state.installRoot, "active.json"), "utf8"));
  assert.equal(persisted.releaseDigest, state.candidate.bundle.releaseDigest);
});

// The activation health gate runs both canonical launchers through the
// release's own runtime with the transaction payload root as their working
// directory. A child that has only just exited can still leave that directory
// held for a moment, so this reproduces the condition directly: a real process
// takes the payload root as its cwd at `after-health` and releases it shortly
// afterwards, which is precisely the window the publish rename and the
// transaction cleanup fall into.
//
// What this proves depends on the platform, and the difference is real:
//
//   - On win32 a held working directory makes both `rename` and a recursive
//     `rm` of that directory fail with EBUSY. Without the bounded retry the
//     publish rename throws, `activate` reports VES_ACTIVATION_FAILED, and the
//     launcher surfaces that as VES_VESTRA_ACTIVATION_UNAVAILABLE — exit 70,
//     the observed CI failure. Here the assertions are a true discriminator.
//   - On POSIX a held working directory blocks neither call, so the activation
//     would succeed with or without the retry. The assertions below still
//     describe the correct outcome there, but they prove nothing about the
//     retry itself; win32 CI carries that signal.
test("a transaction root still held by a live child is published rather than failed", async () => {
  const state = await seeded();
  const digest = state.candidate.bundle.releaseDigest.slice("sha256:".length);
  const transactionRoot = join(state.installRoot, "transactions", digest);
  const payloadRoot = join(transactionRoot, "release");
  let held = false;

  const manager = managerFor(state, {
    async fault(point) {
      if (point !== "after-health" || held) return;
      held = true;
      // Exits on its own, releasing the directory inside the retry budget.
      const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 500)"], {
        cwd: payloadRoot,
        stdio: "ignore"
      });
      children.push(child);
      await once(child, "spawn");
    }
  });

  const receipt = await manager.activate(state.candidate.receipt);

  assert.equal(held, true, "the transaction root was actually held while the publish rename ran");
  assert.equal(receipt.active.releaseDigest, state.candidate.bundle.releaseDigest);
  assert.equal(receipt.releaseReused, false, "this candidate was published by the rename under test");
  await access(join(state.installRoot, "releases", digest));
  assert.deepEqual(await manager.active(), receipt.active);
  await assert.rejects(access(transactionRoot), "the held transaction root is still cleaned up once it is free");
  await assert.rejects(access(join(state.installRoot, "activation-journal.json")));
});
