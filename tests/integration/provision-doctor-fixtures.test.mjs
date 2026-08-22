import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { lstat, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { SUBSYSTEM_OBSERVATION_PATHS, WORKSPACE_ROOT_DIRNAME } from "../../packages/domain/src/index.ts";
import { provisionDoctorFixtures } from "../../scripts/provision-doctor-fixtures.mjs";

// T5 (#207, DDL-03/AD-019): a T75-qualification-only provisioner materializes
// the layout contract's seven subsystem paths on a matrix leg, so the live
// probes T12-T19 observe a real subsystem rather than a directory nothing on
// the machine ever creates. It must provision exactly the contract's set —
// no more, no fewer — and it must never be reachable from a user-facing flow.

let root;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

test("provisions exactly the contract's seven paths, nothing more and nothing fewer", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));

  const provisioned = await provisionDoctorFixtures(root);

  const expectedPaths = Object.values(SUBSYSTEM_OBSERVATION_PATHS)
    .map((relativePath) => join(root, WORKSPACE_ROOT_DIRNAME, relativePath))
    .sort();
  assert.deepEqual([...provisioned].sort(), expectedPaths);
  for (const path of expectedPaths) {
    assert.equal(existsSync(path), true, `expected ${path} to exist after provisioning`);
  }
});

test("provisions nothing outside the layout contract's metadata root", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));

  await provisionDoctorFixtures(root);

  const topLevel = await readdir(root);
  assert.deepEqual(topLevel, [WORKSPACE_ROOT_DIRNAME]);
});

test("a path whose contract entry names a file is provisioned as a file, not a directory", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));

  await provisionDoctorFixtures(root);

  const bundleStat = await stat(join(root, WORKSPACE_ROOT_DIRNAME, "policy", "active.bundle"));
  assert.equal(bundleStat.isFile(), true);
  const dbStat = await stat(join(root, WORKSPACE_ROOT_DIRNAME, "runtime.db"));
  assert.equal(dbStat.isFile(), true);
});

test("a path whose contract entry names a directory is provisioned as a directory", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));

  await provisionDoctorFixtures(root);

  for (const name of ["secrets", "drivers", "connectors", "sandbox"]) {
    const entryStat = await stat(join(root, WORKSPACE_ROOT_DIRNAME, name));
    assert.equal(entryStat.isDirectory(), true, `expected ${name} to be a directory`);
  }
});

test("running twice against the same root is idempotent", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));

  const first = await provisionDoctorFixtures(root);
  const second = await provisionDoctorFixtures(root);

  assert.deepEqual([...first].sort(), [...second].sort());
});

test("the sandbox root contains a genuine out-of-root escape (T12, DDL-06)", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));

  await provisionDoctorFixtures(root);

  const sandboxRoot = join(root, WORKSPACE_ROOT_DIRNAME, "sandbox");
  const escapeLink = join(sandboxRoot, "escape");
  const linkStat = await lstat(escapeLink);
  assert.equal(linkStat.isSymbolicLink(), true);
  // Resolving through the link must land outside the sandbox root — the
  // exact property T12's live probe observes.
  const resolvedTarget = await realpath(join(escapeLink, "runtime.db"));
  const resolvedRoot = await realpath(sandboxRoot);
  assert.equal(resolvedTarget.startsWith(resolvedRoot), false);
  assert.equal(existsSync(join(escapeLink, "runtime.db")), true);
});
