import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, repositoryRoot), "utf8");
}

test("keeps the qualified Pi runtime on one exact package version", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.devDependencies["@earendil-works/pi-agent-core"], "0.82.1");
  assert.equal(manifest.devDependencies["@earendil-works/pi-ai"], "0.82.1");

  const packageVersions = new Set(
    [...read("pnpm-lock.yaml").matchAll(/^\s{2}'(@earendil-works\/pi-(?:agent-core|ai))@(\d+\.\d+\.\d+)/gmu)].map(
      (match) => `${match[1]}@${match[2]}`
    )
  );
  assert.deepEqual([...packageVersions], ["@earendil-works/pi-agent-core@0.82.1", "@earendil-works/pi-ai@0.82.1"]);
});

test("keeps the qualified OpenCode driver on one exact package version", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.devDependencies["opencode-ai"], "1.18.7");
  assert.equal(manifest.devDependencies["@opencode-ai/sdk"], "1.18.7");

  const packageVersions = new Set(
    [...read("pnpm-lock.yaml").matchAll(/^\s{2}'?(opencode-ai|@opencode-ai\/sdk)@(\d+\.\d+\.\d+)/gmu)].map(
      (match) => `${match[1]}@${match[2]}`
    )
  );
  assert.deepEqual([...packageVersions].sort(), ["@opencode-ai/sdk@1.18.7", "opencode-ai@1.18.7"]);
});

test("groups Pi and OpenCode updates and suppresses runtime-incompatible major proposals", () => {
  const policy = read(".github/dependabot.yml");
  assert.match(policy, /groups:\s*\n\s+pi-runtime:\s*\n\s+patterns:\s*\n\s+- "@earendil-works\/pi-\*"/u);
  assert.match(policy, /opencode-driver:\s*\n\s+patterns:\s*\n\s+- opencode-ai\s*\n\s+- "@opencode-ai\/\*"/u);
  assert.match(policy, /dependency-name: tuf-js\s*\n\s+update-types:\s*\n\s+- version-update:semver-major/u);
  assert.match(policy, /dependency-name: "@types\/node"\s*\n\s+update-types:\s*\n\s+- version-update:semver-major/u);
});
