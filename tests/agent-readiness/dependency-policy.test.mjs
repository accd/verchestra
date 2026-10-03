import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const repositoryRoot = new URL("../../", import.meta.url);

function read(path) {
  return fs.readFileSync(new URL(path, repositoryRoot), "utf8");
}

test("keeps the qualified Pi runtime on one exact package version", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.devDependencies["@earendil-works/pi-agent-core"], "0.99.1");
  assert.equal(manifest.devDependencies["@earendil-works/pi-ai"], "0.99.1");

  const packageVersions = new Set(
    [...read("pnpm-lock.yaml").matchAll(/^\s{2}'(@earendil-works\/pi-(?:agent-core|ai))@(\d+\.\d+\.\d+)/gmu)].map(
      (match) => `${match[1]}@${match[2]}`
    )
  );
  assert.deepEqual([...packageVersions], ["@earendil-works/pi-agent-core@0.99.1", "@earendil-works/pi-ai@0.99.1"]);
});

test("does not retain the vulnerable extract-zip package in the lockfile", () => {
  assert.doesNotMatch(read("pnpm-lock.yaml"), /^\s{2}extract-zip@/mu);
});

test("keeps the qualified OpenCode driver on one exact package version", () => {
  const manifest = JSON.parse(read("package.json"));
  assert.equal(manifest.devDependencies["opencode-ai"], "1.18.33");
  assert.equal(manifest.devDependencies["@opencode-ai/sdk"], "1.18.33");

  const packageVersions = new Set(
    [...read("pnpm-lock.yaml").matchAll(/^\s{2}'?(opencode-ai|@opencode-ai\/sdk)@(\d+\.\d+\.\d+)/gmu)].map(
      (match) => `${match[1]}@${match[2]}`
    )
  );
  assert.deepEqual([...packageVersions].sort(), ["@opencode-ai/sdk@1.18.33", "opencode-ai@1.18.33"]);
});

// invariant: decision D1. The Strands SDK, Zod, and the SDK's two required
// peers are dependencies of packages/agent-runtime alone, at exact versions,
// and the lockfile resolves exactly those; no optional provider SDK is added.
const STRANDS_PINS = Object.freeze({
  "@modelcontextprotocol/sdk": "1.32.0",
  "@opentelemetry/api": "1.9.1",
  "@strands-agents/sdk": "1.19.0",
  zod: "4.6.5"
});

test("pins the Strands SDK, Zod, and the SDK's required peers exactly, in agent-runtime only", () => {
  const manifest = JSON.parse(read("packages/agent-runtime/package.json"));
  assert.deepEqual(manifest.dependencies, {
    ...STRANDS_PINS,
    "@verchestra/application": "workspace:0.0.0",
    "@verchestra/domain": "workspace:0.0.0"
  });
  const manifests = ["package.json"];
  for (const root of ["apps", "packages"])
    for (const entry of fs.readdirSync(new URL(`${root}/`, repositoryRoot), { withFileTypes: true }))
      if (entry.isDirectory() && entry.name !== "agent-runtime") manifests.push(`${root}/${entry.name}/package.json`);
  for (const path of manifests) {
    const { dependencies, devDependencies, optionalDependencies } = JSON.parse(read(path));
    const names = Object.keys({ ...dependencies, ...devDependencies, ...optionalDependencies });
    assert.deepEqual(
      names.filter((name) => Object.hasOwn(STRANDS_PINS, name)),
      [],
      path
    );
  }
});

test("locks the Strands SDK and its required peers at exactly the pinned versions", () => {
  const lockfile = read("pnpm-lock.yaml");
  const start = lockfile.indexOf("\n  packages/agent-runtime:\n");
  const importer = lockfile.slice(start, lockfile.indexOf("\n\n", start + 1));
  for (const [name, version] of Object.entries(STRANDS_PINS)) {
    const key = name.startsWith("@") ? `'${name}'` : name;
    assert.ok(importer.includes(`\n      ${key}:\n        specifier: ${version}\n        version: ${version}`), name);
  }
  const locked = (name) =>
    new Set(
      [...lockfile.matchAll(/^\s{2}'?(@?[a-z0-9/.-]+)@(\d+\.\d+\.\d+)'?:/gmu)]
        .filter((match) => match[1] === name)
        .map((match) => match[2])
    );
  assert.deepEqual([...locked("@strands-agents/sdk")], ["1.19.0"]);
  assert.deepEqual([...locked("@modelcontextprotocol/sdk")], ["1.32.0"]);
  assert.ok(locked("zod").has("4.6.5"));
  const snapshot = lockfile.slice(lockfile.indexOf("\n  '@strands-agents/sdk@1.19.0("));
  const resolved = snapshot.slice(0, snapshot.indexOf("\n\n", 1));
  for (const entry of ["'@modelcontextprotocol/sdk': 1.32.0(zod@4.6.5)", "'@opentelemetry/api': 1.9.1", "zod: 4.6.5"])
    assert.ok(resolved.includes(`\n      ${entry}\n`), entry);
});

test("installs the pinned Strands release, whose only required peers are the pinned ones", () => {
  const sdk = JSON.parse(read("packages/agent-runtime/node_modules/@strands-agents/sdk/package.json"));
  assert.equal(sdk.version, "1.19.0");
  assert.equal(sdk.license, "Apache-2.0");
  const required = Object.keys(sdk.peerDependencies)
    .filter((name) => sdk.peerDependenciesMeta?.[name]?.optional !== true)
    .sort((left, right) => Number(left > right) - Number(left < right));
  assert.deepEqual(required, ["@modelcontextprotocol/sdk", "@opentelemetry/api", "zod"]);
  for (const hook of ["preinstall", "install", "postinstall"]) assert.equal(sdk.scripts?.[hook], undefined, hook);
});

test("groups Pi and OpenCode updates and suppresses runtime-incompatible major proposals", () => {
  const policy = read(".github/dependabot.yml");
  assert.match(policy, /groups:\s*\n\s+pi-runtime:\s*\n\s+patterns:\s*\n\s+- "@earendil-works\/pi-\*"/u);
  assert.match(policy, /opencode-driver:\s*\n\s+patterns:\s*\n\s+- opencode-ai\s*\n\s+- "@opencode-ai\/\*"/u);
  assert.match(policy, /site-framework:\s*\n\s+patterns:\s*\n\s+- astro\s*\n\s+- "@astrojs\/\*"/u);
  assert.match(policy, /security-fixes:\s*\n\s+applies-to: security-updates\s*\n\s+patterns:\s*\n\s+- "\*"/u);
  assert.match(policy, /dependency-name: tuf-js\s*\n\s+update-types:\s*\n\s+- version-update:semver-major/u);
  assert.match(policy, /dependency-name: "@types\/node"\s*\n\s+update-types:\s*\n\s+- version-update:semver-major/u);
});
