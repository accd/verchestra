import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { codexLoginCommand } from "../../apps/vestra-cli/src/task/task-codex-identity.ts";
import {
  CLAUDE_WINDOWS_POLICY_DIRECTORY,
  CLAUDE_WINDOWS_POLICY_KEYS
} from "../../packages/drivers/src/claude-code-driver.ts";
import {
  LOGGING_POLICY_GUARD,
  cmdkeyExecutable,
  powershellChildEnvironment,
  powershellExecutable,
  systemRoot
} from "../../packages/platform-node/src/os-secret-backends/windows-credential-manager.ts";
import { taskkillExecutable } from "../../packages/platform-node/src/process-tree-terminator.ts";
import { POWERSHELL_7_EXECUTABLE, helperEnvironment } from "../../packages/platform-node/src/windows-pipe-transport.ts";
import { regExecutable } from "../../packages/platform-node/src/windows-registry.ts";

// SonarCloud S7780 (T8): strings that escaped every backslash are now
// String.raw literals. The expected values below are spelled with ordinary
// escapes, so they pin that each path and pattern kept every byte.

const saved = process.env["SystemRoot"];
afterEach(() => {
  if (saved === undefined) delete process.env["SystemRoot"];
  else process.env["SystemRoot"] = saved;
});

test("Windows program paths stay under the system root, byte for byte", () => {
  process.env["SystemRoot"] = "D:\\Win";
  assert.equal(systemRoot(), "D:\\Win");
  assert.equal(powershellExecutable(), "D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
  assert.equal(cmdkeyExecutable(), "D:\\Win\\System32\\cmdkey.exe");
  assert.equal(taskkillExecutable(), "D:\\Win\\System32\\taskkill.exe");
  assert.equal(regExecutable(), "D:\\Win\\System32\\reg.exe");
  assert.equal(
    powershellChildEnvironment().PATH,
    "D:\\Win\\System32;D:\\Win;D:\\Win\\System32\\WindowsPowerShell\\v1.0"
  );
  assert.equal(helperEnvironment({}, "D:\\Win").PATH, "D:\\Win\\System32;D:\\Win");
});

test("an unusable system root falls back to C:\\Windows", () => {
  delete process.env["SystemRoot"];
  assert.equal(systemRoot(), "C:\\Windows");
  process.env["SystemRoot"] = "relative\\path";
  assert.equal(systemRoot(), "C:\\Windows");
});

test("fixed Windows locations keep their exact spelling", () => {
  assert.equal(CLAUDE_WINDOWS_POLICY_DIRECTORY, "C:\\Program Files\\ClaudeCode");
  assert.deepEqual(CLAUDE_WINDOWS_POLICY_KEYS, [
    "HKLM\\SOFTWARE\\Policies\\ClaudeCode",
    "HKCU\\SOFTWARE\\Policies\\ClaudeCode"
  ]);
  assert.equal(POWERSHELL_7_EXECUTABLE, "C:\\Program Files\\PowerShell\\7\\pwsh.exe");
  assert.ok(
    LOGGING_POLICY_GUARD.includes(
      '$verchestraSetting = [Microsoft.Win32.Registry]::GetValue("$verchestraHive\\SOFTWARE\\Policies\\Microsoft\\Windows\\PowerShell\\$($verchestraPolicy[0])", $verchestraPolicy[1], $null);'
    )
  );
});

test("a POSIX login command quotes a single quote in the directory", () => {
  assert.equal(codexLoginCommand("/home/o'neil/.codex", "linux"), "CODEX_HOME='/home/o'\\''neil/.codex' codex login");
});
