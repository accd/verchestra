// invariant: a child `vestra` in a gate test never reaches a real keychain or
// keyring (#379). Preloaded with `node --import`, this installs the deny guard
// from deny-keychain-spawn.mjs and then answers, from a JSON store the test
// names in VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE, the programs the POSIX
// credential backends run: on macOS `/usr/bin/security`, with the exit codes
// and output conventions measured for #379 (0 found, 44 not found, `-g` prints
// `password: "..."` on stderr); on Linux the Secret Service's
// `/usr/bin/dbus-send` attribute search and `/usr/bin/secret-tool lookup`, with
// the conventions docs/qualification/os-secret-backend-linux.md measured. No
// process is spawned for any of them; every other spawn passes through the
// deny guard unchanged. One store serves every platform: an item is keyed
// `<service>|<account>`.
import "./deny-keychain-spawn.mjs";

import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";

const STORE = process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE;
const NOT_FOUND = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n";
const UNSUPPORTED = Object.freeze({ code: 1, stdout: "", stderr: "unsupported fake command\n" });

const stored = (service, account) =>
  (STORE === undefined ? {} : JSON.parse(readFileSync(STORE, "utf8")).items)[`${service}|${account}`];

function record(command, account) {
  if (STORE !== undefined) appendFileSync(`${STORE}.log`, `${JSON.stringify({ command, account })}\n`);
}

function securityAnswer(args) {
  const account = args[args.indexOf("-a") + 1];
  const value = stored(args[args.indexOf("-s") + 1], account);
  record(args[0], account);
  if (args[0] !== "find-generic-password") return UNSUPPORTED;
  if (value === undefined) return { code: 44, stdout: "", stderr: NOT_FOUND };
  const stderr = args.includes("-g") ? `password: "${value}"\n` : "";
  return { code: 0, stdout: `keychain: "fake"\nattributes:\n    "acct"<blob>="${account}"\n`, stderr };
}

// invariant: a piped `secret-tool lookup` prints exactly the value and exits
// 0; one that matches nothing exits 1 and prints nothing. A task only reads,
// so a store or a clear is refused, as an unknown command is.
function secretToolAnswer(args) {
  const [command, serviceName, service, accountName, account] = args;
  record(command, account);
  if (command !== "lookup" || serviceName !== "service" || accountName !== "account" || args.length !== 5)
    return UNSUPPORTED;
  const value = stored(service, account);
  return value === undefined ? { code: 1, stdout: "", stderr: "" } : { code: 0, stdout: value, stderr: "" };
}

// invariant: SearchItems replies with the unlocked item paths, then the locked
// ones, and never a value. Every fake item is unlocked.
function searchAnswer(args) {
  const query = /^dict:string:string:service,([^,]+),account,([^,]+)$/u.exec(args.at(-1) ?? "");
  if (!args.includes("org.freedesktop.Secret.Service.SearchItems") || query === null) return UNSUPPORTED;
  const [, service, account] = query;
  record("SearchItems", account);
  const found =
    stored(service, account) === undefined ? "" : '      object path "/org/freedesktop/secrets/collection/login/1"\n';
  const reply = "method return time=1.0 sender=:1.1 -> destination=:1.2 serial=7 reply_serial=2\n";
  return { code: 0, stdout: `${reply}   array [\n${found}   ]\n   array [\n   ]\n`, stderr: "" };
}

// why: the absolute paths the backends run, never a PATH lookup, so nothing
// else under these names is ever answered.
const ANSWERS = new Map([
  ["/usr/bin/security", securityAnswer],
  ["/usr/bin/secret-tool", secretToolAnswer],
  ["/usr/bin/dbus-send", searchAnswer]
]);

function fakeChild(result) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 0;
  child.kill = () => true;
  setImmediate(() => {
    child.stdout.end(result.stdout);
    child.stderr.end(result.stderr);
    setImmediate(() => child.emit("close", result.code, null));
  });
  return child;
}

const guarded = childProcess.spawn;
childProcess.spawn = function spawn(file, args, ...rest) {
  const answer = ANSWERS.get(file);
  if (answer !== undefined) return fakeChild(answer(Array.isArray(args) ? args : []));
  return guarded.call(this, file, args, ...rest);
};
syncBuiltinESMExports();

export const FAKE_KEYCHAIN_SPAWN = new URL(import.meta.url);
