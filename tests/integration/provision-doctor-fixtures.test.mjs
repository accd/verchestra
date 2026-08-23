import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
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

  // provisionDoctorFixtures canonicalizes its controlRoot argument (a
  // security fix: every write is validated against the real, resolved
  // directory before use) — on macOS, mkdtemp's own /var/... result and its
  // real /private/var/... target differ textually though they name the same
  // directory, so the expected paths must canonicalize the same root.
  const realRoot = await realpath(root);
  const expectedPaths = Object.values(SUBSYSTEM_OBSERVATION_PATHS)
    .map((relativePath) => join(realRoot, WORKSPACE_ROOT_DIRNAME, relativePath))
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

test("refuses to provision when the metadata root is a pre-existing symlink (P1, PR #306)", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));
  const outside = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-outside-"));
  try {
    await symlink(outside, join(root, WORKSPACE_ROOT_DIRNAME), process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(() => provisionDoctorFixtures(root), /redirected or non-directory path/u);

    assert.equal(existsSync(join(outside, "policy")), false, "must not have written through the redirect");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("refuses to provision when a subsystem directory is a pre-existing symlink (P1, PR #306)", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));
  const outside = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-outside-"));
  try {
    const metadataRoot = join(root, WORKSPACE_ROOT_DIRNAME);
    await mkdir(metadataRoot, { recursive: true });
    // Plant the redirect one level deeper than the metadata root itself —
    // the exact case the review finding named ("or a subsystem directory
    // below it such as sandbox").
    await symlink(outside, join(metadataRoot, "sandbox"), process.platform === "win32" ? "junction" : "dir");

    await assert.rejects(() => provisionDoctorFixtures(root), /redirected or non-directory path/u);

    assert.equal(existsSync(join(outside, "escape")), false, "must not have written through the redirect");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("refuses to write through a pre-existing symlink at a file target (P1, PR #306)", async () => {
  root = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-"));
  const outside = await mkdtemp(join(tmpdir(), "verchestra-doctor-fixtures-outside-"));
  const outsideFile = join(outside, "redirected-bundle");
  await writeFile(outsideFile, "pre-existing content");
  try {
    const policyDir = join(root, WORKSPACE_ROOT_DIRNAME, "policy");
    await mkdir(policyDir, { recursive: true });
    // active.bundle itself — not its parent directory — is the pre-existing
    // redirect here, planted before provisioning ever runs. Windows does not
    // permit unprivileged file symlinks on a default checkout, so use a hard
    // link there; the provisioner rejects both forms before writing.
    if (process.platform === "win32") {
      await link(outsideFile, join(policyDir, "active.bundle"));
    } else {
      await symlink(outsideFile, join(policyDir, "active.bundle"), "file");
    }

    await assert.rejects(() => provisionDoctorFixtures(root), /pre-existing symlink or hard link/u);

    assert.equal(
      await readFile(outsideFile, "utf8"),
      "pre-existing content",
      "must not have written through the redirect"
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});
