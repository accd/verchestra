// invariant: gate suites never reach a real OS credential store (#379).
// Importing this module — in process, or as `node --import` in a child
// `vestra` — makes every child_process entry point throw before spawning the
// macOS `security` tool, libsecret's `secret-tool`, `dbus-send` (the Secret
// Service presence query), or Windows PowerShell and `cmdkey` (the Credential
// Manager programs), so a test that forgot its fake
// runner fails loudly instead of touching the user's keychain, keyring, or
// Credential Manager, or raising a prompt. Real-store evidence lives only in
// the standalone `pnpm qualify:keychain` suite (spikes/os-secret-store).
import childProcess from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { basename } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);

const CREDENTIAL_TOOL =
  /(?:^|[\\/])(?:security|secret-tool|dbus-send|cmdkey(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/iu;
const CREDENTIAL_COMMAND =
  /^\s*"?(?:[^\s"]*[\\/])?(?:security|secret-tool|dbus-send|cmdkey(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)"?(?:\s|$)/iu;

function refuse(target) {
  throw new Error(`a gate test attempted to run ${target}; use a fake or spy runner instead`);
}

function scriptText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

// invariant: the one PowerShell the guard lets through is the bridge's pipe
// helper (AD-074): the pinned PowerShell 7, the pinned flags, and the constant
// helper script, read back from the very file it is about to run, whose only
// argument is a pipe name of the pinned shape. It reads no credential store,
// and a Windows task journey cannot reach its bridge without it.
// why: the transport's constants are loaded only when a PowerShell 7 start is
// checked, so importing the guard loads no product module before it patches.
export function pipeHelperInvocation(file, args) {
  if (typeof file !== "string" || !/[\\/]pwsh\.exe$/iu.test(file)) return false;
  const {
    PIPE_HELPER_SCRIPT,
    PIPE_NAME,
    POWERSHELL_7_EXECUTABLE,
    POWERSHELL_HELPER_FLAGS
  } = require("../../packages/platform-node/src/windows-pipe-transport.ts");
  const flags = POWERSHELL_HELPER_FLAGS.length;
  if (file !== POWERSHELL_7_EXECUTABLE || !Array.isArray(args) || args.length !== flags + 2) return false;
  if (POWERSHELL_HELPER_FLAGS.some((flag, index) => args[index] !== flag)) return false;
  const [script, name] = args.slice(flags);
  return (
    typeof script === "string" &&
    typeof name === "string" &&
    basename(script) === "pipe-helper.ps1" &&
    PIPE_NAME.test(name) &&
    scriptText(script) === PIPE_HELPER_SCRIPT
  );
}

function guard(name, check) {
  const original = childProcess[name];
  const wrap = (target) =>
    function guarded(first, ...rest) {
      check(first, rest[0]);
      return target.call(this, first, ...rest);
    };
  const guarded = wrap(original);
  // why: exec and execFile carry a custom promisify implementation that
  // resolves { stdout, stderr }; dropping it would break every
  // promisify(execFile) caller in the product.
  const custom = original[promisify.custom];
  if (typeof custom === "function") Object.defineProperty(guarded, promisify.custom, { value: wrap(custom) });
  childProcess[name] = guarded;
}

const checkFile = (file, args) => {
  if (typeof file === "string" && CREDENTIAL_TOOL.test(file) && !pipeHelperInvocation(file, args)) refuse(file);
};
const checkCommand = (command) => {
  if (typeof command === "string" && CREDENTIAL_COMMAND.test(command)) refuse(command.trim().split(/\s/u)[0]);
};

for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) guard(name, checkFile);
for (const name of ["exec", "execSync"]) guard(name, checkCommand);

syncBuiltinESMExports();

export const DENY_KEYCHAIN_SPAWN = new URL(import.meta.url);
