import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { WORKSPACE_ROOT_DIRNAME } from "../../packages/domain/src/index.ts";
import { runDoctorDeep } from "../../apps/vestra-cli/src/doctor-composition.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// DDL-07 (#207, AC7/AC8, edge case 3): the live cedar-policy check verifies a
// real Ed25519-signed bundle read-only, never a file-presence check, and
// never lets the bundle digest reach the sealed report.

let roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function cedarPolicyCode(run) {
  return run.payload["doctor.check_codes"].find((code) => code.startsWith("doctor.cedar-policy:"));
}

test("a verifying bundle reports pass through the real doctor composition", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-cedar-policy-"));
  roots.push(root);
  await provisionDoctorFixtures(root);

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(cedarPolicyCode(run), "doctor.cedar-policy:pass");
});

test("a tampered bundle reports fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-cedar-policy-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const bundlePath = join(root, WORKSPACE_ROOT_DIRNAME, "policy", "active.bundle");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  // Change signed content without re-signing: the digest recorded in the
  // bundle no longer reproduces from its contents.
  await writeFile(
    bundlePath,
    JSON.stringify({ ...bundle, policies: [{ ...bundle.policies[0], cedar: "forbid(principal, action, resource);" }] })
  );

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(cedarPolicyCode(run), "doctor.cedar-policy:fail");
});

test("a bundle with a corrupted signature reports fail, even with a matching digest", async () => {
  // Distinct from the tampered-content case above: bundleDigest still
  // reproduces from the (unchanged) content, so verifyPolicyBundle's digest
  // check alone cannot catch this — only the actual cryptographic signature
  // check can. Isolates that this check is genuinely exercised, not merely
  // present in the import graph.
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-cedar-policy-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const bundlePath = join(root, WORKSPACE_ROOT_DIRNAME, "policy", "active.bundle");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  await writeFile(bundlePath, JSON.stringify({ ...bundle, signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }));

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(cedarPolicyCode(run), "doctor.cedar-policy:fail");
});

test("a truncated bundle reports fail without throwing out of runDoctor", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-cedar-policy-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const bundlePath = join(root, WORKSPACE_ROOT_DIRNAME, "policy", "active.bundle");
  await writeFile(bundlePath, "");

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(cedarPolicyCode(run), "doctor.cedar-policy:fail");
});

test("an unprovisioned bundle reports blocked, never fail", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-cedar-policy-"));
  roots.push(root);
  // Deliberately not provisioned: no .verchestra/policy/active.bundle exists.

  const run = await runDoctorDeep({ controlRoot: root });

  assert.equal(cedarPolicyCode(run), "doctor.cedar-policy:blocked");
});

test("the bundle digest never reaches the sealed report", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-doctor-cedar-policy-"));
  roots.push(root);
  await provisionDoctorFixtures(root);
  const bundlePath = join(root, WORKSPACE_ROOT_DIRNAME, "policy", "active.bundle");
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));

  const run = await runDoctorDeep({ controlRoot: root });

  const serialized = `${JSON.stringify(run.payload)}\n${JSON.stringify(run.artifact)}`;
  assert.equal(serialized.includes(bundle.bundleDigest), false);
});
