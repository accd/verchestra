// invariant: gate suites never reach a real keychain (#379). Importing this
// module — in process, or as `node --import` in a child `vestra` — makes every
// child_process entry point throw before spawning `security`, so a test that
// forgot its fake runner fails loudly instead of touching the user's keychain
// or raising a keychain dialog. Real-keychain evidence lives only in the
// standalone `pnpm qualify:keychain` suite (spikes/os-secret-store).
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { promisify } from "node:util";

const SECURITY_TOOL = /(?:^|\/)security$/u;
const SECURITY_COMMAND = /^\s*(?:\S*\/)?security(?:\s|$)/u;

function refuse(target) {
  throw new Error(`a gate test attempted to run ${target}; use a fake or spy runner instead`);
}

function guard(name, check) {
  const original = childProcess[name];
  const wrap = (target) =>
    function guarded(first, ...rest) {
      check(first);
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

const checkFile = (file) => {
  if (typeof file === "string" && SECURITY_TOOL.test(file)) refuse(file);
};
const checkCommand = (command) => {
  if (typeof command === "string" && SECURITY_COMMAND.test(command)) refuse(command.trim().split(/\s/u)[0]);
};

for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) guard(name, checkFile);
for (const name of ["exec", "execSync"]) guard(name, checkCommand);

syncBuiltinESMExports();

export const DENY_KEYCHAIN_SPAWN = new URL(import.meta.url);
