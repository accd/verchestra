// invariant: `init` and the workspace scanner start git with the same scrubbed
// environment as the task path (#595, SEC-007). Git reads its repository and
// configuration from GIT_* variables before it looks at its working directory,
// so an inherited GIT_DIR or GIT_CONFIG_* would make the scan describe, or the
// init judge, a repository other than the one it was given.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { SafeInitService, buildCanonicalInitFiles, scanWorkspace } from "../../packages/workspace/src/index.ts";
import { cleanupScannerRoots, git, initRepository, scannerRoot } from "../helpers/workspace-scanner-fixture.mjs";

afterEach(cleanupScannerRoots);

const files = () =>
  buildCanonicalInitFiles({
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab",
    displayName: "Environment Fixture",
    placementMode: "centralized",
    generatorVersion: "1.0.0"
  });

// hazard: the fixture's own git calls inherit this process's environment, so
// they all run before the overrides and only product code runs inside them.
async function withEnvironment(overrides, callback) {
  const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
  Object.assign(process.env, overrides);
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function repositoryWithRemote(prefix, url) {
  const root = await scannerRoot(prefix);
  await initRepository(root);
  git(root, "remote", "add", "origin", url);
  return root;
}

test("a hostile GIT_DIR and GIT_CONFIG_* do not change what the scanner reports", async () => {
  const own = await repositoryWithRemote("verchestra-own-", "https://example.invalid/own.git");
  const other = await repositoryWithRemote("verchestra-other-", "https://example.invalid/other.git");
  const expected = await scanWorkspace({ controlRoot: own });
  const observed = await withEnvironment(
    {
      GIT_DIR: join(other, ".git"),
      GIT_WORK_TREE: other,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "remote.origin.url",
      GIT_CONFIG_VALUE_0: "https://example.invalid/hostile.git"
    },
    () => scanWorkspace({ controlRoot: own })
  );
  assert.equal(observed.repositories.length, 1);
  assert.equal(observed.repositories[0].remoteFingerprint, expected.repositories[0].remoteFingerprint);
  assert.equal(observed.fingerprint, expected.fingerprint);
});

test("a hostile GIT_CONFIG_* excludes file does not make init refuse its own targets", async () => {
  const root = await scannerRoot();
  await initRepository(root);
  const excludes = join(await scannerRoot("verchestra-excludes-"), "ignore-everything");
  await writeFile(excludes, "*\n");
  const service = new SafeInitService();
  const preview = await withEnvironment(
    { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesFile", GIT_CONFIG_VALUE_0: excludes },
    () => service.preview({ controlRoot: root, files: files() })
  );
  assert.ok(preview.changes.length > 0, "init plans its targets");
});
