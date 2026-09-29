// invariant: gate suites never spawn a real OS credential-store program
// (#379): the macOS `security` tool, libsecret's `secret-tool`, `dbus-send`
// (the Secret Service presence query), or the Windows PowerShell and `cmdkey`
// that reach Credential Manager. A call from a gate can
// raise a dialog, hang an unattended run, or touch the owner's keychain,
// keyring, or Credential Manager, and a CI machine or a locked session makes
// even a read fragile. Real-store evidence belongs to the standalone
// `pnpm qualify:keychain` suite (spikes/os-secret-store), which no gate runs.
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
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
  /\b(?:createOsCredentialStore|DarwinKeychainBackend|LinuxSecretServiceBackend|WindowsCredentialManagerBackend|executeSecretCommand|composeDoctorSecretProbe)\b|secret-composition/u;
const CLI_LAUNCH = /apps\/vestra-cli\/bin\/|spawnSealed/u;
const KEYCHAIN_COMMAND = /"(?:doctor|secret|task)"/u;

// invariant: each exemption is reviewed. The staged sealed layout runs doctor
// from a project with no Workspace, so no credential lookup can happen.
const REVIEWED_EXEMPTIONS = Object.freeze(new Set(["tests/build/sealed-launcher-closure.test.mjs"]));

test("no gate test references a real credential-tool runner", () => {
  for (const { path, source } of files.filter(
    ({ path }) => path !== "tests/architecture/no-keychain-spawn-in-tests.test.mjs"
  ))
    assert.doesNotMatch(
      source,
      /\b(?:nodeSecurityRunner|nodeSecretServiceRunner|nodeCredentialManagerRunner|spawnCredentialTool)\b/u,
      `${path} names a real credential-tool runner`
    );
});

test("no gate test spawns a credential tool directly", () => {
  const direct =
    /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync)\(\s*(?:["'`](?:\/usr\/bin\/)?(?:security|secret-tool|dbus-send)["'`]|["'`][^"'`]*(?:powershell|pwsh|cmdkey)(?:\.exe)?["'`]|SECURITY(?:_EXECUTABLE)?\b|SECRET_TOOL(?:_EXECUTABLE)?\b|DBUS_SEND(?:_EXECUTABLE)?\b|powershellExecutable\b|cmdkeyExecutable\b)/iu;
  for (const { path, source } of files) assert.doesNotMatch(source, direct, `${path} spawns a credential tool`);
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

test("the spawn guard refuses every credential tool in process", () => {
  for (const tool of [
    "/nonexistent/security",
    "/nonexistent/secret-tool",
    "/nonexistent/dbus-send",
    "C:\\nonexistent\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\nonexistent\\PowerShell.EXE",
    "/nonexistent/pwsh",
    "C:\\nonexistent\\System32\\cmdkey.exe"
  ])
    assert.throws(() => spawnSync(tool, ["-Command", "-"]), /use a fake or spy runner/u, tool);
  for (const command of ["secret-tool lookup a b", '"C:\\x\\powershell.exe" -Command -', "/usr/bin/security help"])
    assert.throws(() => execSync(command), /use a fake or spy runner/u, command);
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
