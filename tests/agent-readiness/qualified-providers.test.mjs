// invariant: the provider CLIs the fleet qualifies the drivers against are
// installed from a committed lockfile that pins the sha512 of every package,
// the platform binary packages included, at the versions each workflow
// verifies (#596).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { admits } from "../../scripts/verify-provider-install.mjs";

const directory = new URL("../../.github/qualified-providers/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("package.json", directory), "utf8"));
const lock = JSON.parse(readFileSync(new URL("package-lock.json", directory), "utf8"));
const entries = Object.entries(lock.packages).filter(([key]) => key !== "");
const workflow = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8");

const CLAUDE = "@anthropic-ai/claude-code";
const CODEX = "@openai/codex";
// The fleet's five targets (platform-matrix.yml, t76-candidate-build.yml).
const FLEET = Object.freeze([
  ["linux", "x64"],
  ["linux", "arm64"],
  ["darwin", "x64"],
  ["darwin", "arm64"],
  ["win32", "x64"]
]);

test("the manifest is private and pins exactly the two providers to exact versions", () => {
  assert.equal(manifest.private, true);
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [CLAUDE, CODEX]);
  for (const version of Object.values(manifest.dependencies)) assert.match(version, /^\d+\.\d+\.\d+$/u);
  assert.equal(manifest.scripts, undefined);
});

test("the lockfile is the manifest's own", () => {
  // npm ci refuses a lockfile that disagrees with its manifest; this says so
  // before a runner does.
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
  assert.equal(lock.packages[`node_modules/${CLAUDE}`].version, manifest.dependencies[CLAUDE]);
  assert.equal(lock.packages[`node_modules/${CODEX}`].version, manifest.dependencies[CODEX]);
});

test("every locked package carries a sha512 integrity and a registry tarball", () => {
  assert.ok(entries.length > 2, "the platform binary packages must be locked too");
  for (const [key, entry] of entries) {
    assert.match(entry.integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/u, key);
    assert.match(
      entry.resolved ?? "",
      /^https:\/\/registry\.npmjs\.org\/@[a-z0-9-]+\/[a-z0-9-]+\/-\/[^/]+\.tgz$/u,
      key
    );
  }
});

test("every platform package a provider declares is locked", () => {
  for (const provider of [CLAUDE, CODEX]) {
    const declared = Object.keys(lock.packages[`node_modules/${provider}`].optionalDependencies ?? {});
    assert.ok(declared.length > 0, `${provider} declares its platform packages`);
    for (const name of declared) assert.ok(lock.packages[`node_modules/${name}`], `${name} is locked`);
  }
});

test("only Claude Code has an install script, and it is the one rebuilt by name", () => {
  const scripted = entries.filter(([, entry]) => entry.hasInstallScript).map(([key]) => key);
  assert.deepEqual(scripted, [`node_modules/${CLAUDE}`]);
});

test("the install check decides each fleet target's platform packages", () => {
  // The check reads os and cpu only; a package that also narrows by libc would
  // be demanded where npm skips it, so it must be reviewed first.
  for (const [key, entry] of entries) assert.equal(entry.libc, undefined, key);
  for (const [platform, arch] of FLEET) {
    const demanded = entries
      .filter(([, entry]) => entry.optional && admits(entry.os, platform) && admits(entry.cpu, arch))
      .map(([key]) => key);
    assert.ok(
      demanded.some((key) => key.startsWith(`node_modules/${CLAUDE}-`)),
      `${platform}-${arch} Claude Code binary`
    );
    assert.ok(
      demanded.some((key) => key.startsWith(`node_modules/${CODEX}-`)),
      `${platform}-${arch} Codex binary`
    );
  }
});

for (const name of ["ci.yml", "full-validation.yml", "platform-matrix.yml", "t76-candidate-build.yml"]) {
  test(`${name} verifies the versions the manifest pins`, () => {
    // A bump moves the manifest, the lockfile and these checks together.
    const text = workflow(name);
    const claude = manifest.dependencies[CLAUDE].replaceAll(".", "\\.");
    const codex = manifest.dependencies[CODEX].replaceAll(".", "\\.");
    assert.match(text, new RegExp(`"${claude}"\\|"${claude} "\\*\\)`, "u"));
    assert.match(text, new RegExp(`"codex-cli ${codex}"\\|"codex-cli ${codex} "\\*\\)`, "u"));
    assert.doesNotMatch(text, /@anthropic-ai\/claude-code@|@openai\/codex@/u);
  });
}
