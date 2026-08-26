import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";

// #18 (L2): the native-asset probe reports whether a verified native release
// has actually been activated on this machine, read from the install root's
// activation record rather than from the launcher's own releaseDigest, which is
// null by protocol (circular). The composition root supplies the install root
// for a sealed release only, so a source checkout stays blocked; here the probe
// is driven directly against provisioned and un-provisioned install roots.
//
// It is deliberately NOT enough to reach a PASS verdict on its own: secret
// presence has no production secret backend to observe, so a real machine's
// doctor stays BLOCKED regardless. These cases assert only the native-asset
// check code, which is exactly what this change moves.

const DIGEST = `sha256:${"a".repeat(64)}`;
const OTHER_DIGEST = `sha256:${"b".repeat(64)}`;

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
});

async function scratch(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

// Lays down an install root exactly as the activator does: active.json at the
// root and the named release under releases/<digest>/release.json.
async function activatedInstall(activeDigest, laidDownDigest = activeDigest) {
  const installRoot = await scratch("verchestra-doctor-install-");
  await writeFile(
    join(installRoot, "active.json"),
    JSON.stringify({
      schemaVersion: 1,
      releaseId: "release:verchestra:1.0.0:fixture",
      releaseDigest: activeDigest,
      semanticVersion: "1.0.0"
    })
  );
  if (laidDownDigest !== null) {
    const releaseRoot = join(installRoot, "releases", laidDownDigest.slice("sha256:".length));
    await mkdir(releaseRoot, { recursive: true });
    await writeFile(join(releaseRoot, "release.json"), JSON.stringify({ bundle: { releaseDigest: laidDownDigest } }));
  }
  return installRoot;
}

function nativeAssetCode(run) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.native-asset:"));
}

async function runWithInstallRoot(installRoot) {
  const controlRoot = await scratch("verchestra-doctor-control-");
  return runDoctorDeep({ controlRoot, live: installRoot === undefined ? {} : { installRoot } });
}

test("an activated install whose recorded release is laid down reports the native asset present", async () => {
  const installRoot = await activatedInstall(DIGEST);
  assert.equal(nativeAssetCode(await runWithInstallRoot(installRoot)), "doctor.native-asset:pass");
});

test("no install root (source mode) reports the native asset blocked, never a silent pass", async () => {
  assert.equal(nativeAssetCode(await runWithInstallRoot(undefined)), "doctor.native-asset:blocked");
});

test("an install root with no activation record reports the native asset blocked", async () => {
  const installRoot = await scratch("verchestra-doctor-empty-");
  assert.equal(nativeAssetCode(await runWithInstallRoot(installRoot)), "doctor.native-asset:blocked");
});

test("an active pointer whose release is not laid down reports the native asset failed", async () => {
  // active.json names a digest, but releases/<digest> is absent: a genuine
  // inconsistency, not an un-provisioned machine.
  const installRoot = await activatedInstall(DIGEST, null);
  assert.equal(nativeAssetCode(await runWithInstallRoot(installRoot)), "doctor.native-asset:fail");
});

test("an active pointer that disagrees with the laid-down release reports failed", async () => {
  const installRoot = await activatedInstall(DIGEST, OTHER_DIGEST);
  assert.equal(nativeAssetCode(await runWithInstallRoot(installRoot)), "doctor.native-asset:fail");
});

test("a malformed active pointer reports the native asset failed, not blocked", async () => {
  const installRoot = await scratch("verchestra-doctor-malformed-");
  await writeFile(join(installRoot, "active.json"), JSON.stringify({ releaseDigest: "not-a-digest" }));
  assert.equal(nativeAssetCode(await runWithInstallRoot(installRoot)), "doctor.native-asset:fail");
});
