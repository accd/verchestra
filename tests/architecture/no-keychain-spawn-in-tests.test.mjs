// invariant: gate suites never spawn the real macOS `security` tool (#379).
// A keychain call from a gate can raise a dialog, hang an unattended run, or
// touch the owner's login keychain, and a CI machine or a locked session makes
// even a read fragile. Real-keychain evidence belongs to the standalone
// `pnpm qualify:keychain` suite (spikes/os-secret-store), which no gate runs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import "../helpers/deny-keychain-spawn.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const testsRoot = join(repoRoot, "tests");

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".mjs") ? [path] : [];
  });
}

const files = testFiles(testsRoot).map((path) => ({
  path: relative(repoRoot, path).replaceAll("\\", "/"),
  source: readFileSync(path, "utf8")
}));

// why: the credential-store surfaces through which a test could reach the
// default runner, and the CLI commands whose child process could.
const CREDENTIAL_SURFACE =
  /\b(?:createOsCredentialStore|DarwinKeychainBackend|executeSecretCommand|composeDoctorSecretProbe)\b|secret-composition/u;
const CLI_LAUNCH = /apps\/vestra-cli\/bin\/|spawnSealed/u;
const KEYCHAIN_COMMAND = /"(?:doctor|secret)"/u;

// invariant: each exemption is reviewed. The staged sealed layout runs doctor
// from a project with no Workspace, so no credential lookup can happen.
const REVIEWED_EXEMPTIONS = Object.freeze(new Set(["tests/build/sealed-launcher-closure.test.mjs"]));

test("no gate test references the real security runner", () => {
  for (const { path, source } of files)
    assert.doesNotMatch(source, /\bnodeSecurityRunner\b/u, `${path} names the real security runner`);
});

test("no gate test spawns the security tool directly", () => {
  const direct =
    /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*(?:["'`](?:\/usr\/bin\/)?security["'`]|SECURITY(?:_EXECUTABLE)?\b)/u;
  for (const { path, source } of files) assert.doesNotMatch(source, direct, `${path} spawns security`);
});

test("every gate test that can reach a credential store installs the spawn guard", () => {
  const guarded = [];
  for (const { path, source } of files) {
    if (
      path === "tests/helpers/deny-keychain-spawn.mjs" ||
      path === "tests/architecture/no-keychain-spawn-in-tests.test.mjs"
    )
      continue;
    const reaches = CREDENTIAL_SURFACE.test(source) || (CLI_LAUNCH.test(source) && KEYCHAIN_COMMAND.test(source));
    if (!reaches || REVIEWED_EXEMPTIONS.has(path)) continue;
    assert.match(source, /deny-keychain-spawn\.mjs/u, `${path} can reach a credential store without the spawn guard`);
    guarded.push(path);
  }
  assert.ok(guarded.length >= 5, `expected the credential suites to be found, found ${guarded.length}`);
});

test("the spawn guard refuses the security tool in process", () => {
  assert.throws(() => spawnSync("/nonexistent/security", ["help"]), /use a fake or spy runner/u);
  assert.equal(spawnSync(process.execPath, ["--version"], { encoding: "utf8" }).status, 0);
});

test("the real-keychain suite is standalone and outside every gate", () => {
  const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  assert.equal(manifest.scripts["qualify:keychain"], "node --test spikes/os-secret-store/test/*.test.mjs");
  for (const [name, command] of Object.entries(manifest.scripts)) {
    if (name === "qualify:keychain") continue;
    assert.equal(command.includes("os-secret-store"), false, `${name} runs the real-keychain suite`);
  }
});
