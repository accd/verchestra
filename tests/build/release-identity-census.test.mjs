import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

import { resolveReleaseIdentity } from "../../apps/vestra-cli/src/release-manifest.ts";

test("source mode has no verified release-manifest digest", () => {
  assert.equal(resolveReleaseIdentity().releaseDigest, null);
});

test("tracked fixtures and evidence do not pin a V1 release-manifest digest", () => {
  const listed = spawnSync("git", ["ls-files", "--", "tests", "docs/qualification", ".specs/features"], {
    encoding: "utf8"
  });
  assert.equal(listed.status, 0, listed.stderr);

  const pinnedDigest = /(?:["']?releaseDigest["']?\s*[:=]\s*["'`])sha256:[a-f0-9]{64}/u;
  const matches = listed.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((path) => pinnedDigest.test(readFileSync(path, "utf8")));

  assert.deepEqual(matches, []);
});
