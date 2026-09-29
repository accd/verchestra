// invariant: a child `vestra` in a gate test never reaches a real keychain
// (#379). Preloaded with `node --import`, this installs the deny guard from
// deny-keychain-spawn.mjs and then answers `/usr/bin/security` spawns itself,
// from a JSON store the test names in VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE, with
// the exit codes and output conventions measured for #379 (0 found, 44 not
// found, `-g` prints `password: "..."` on stderr). No process is spawned for
// `security`; every other spawn passes through the deny guard unchanged.
import "./deny-keychain-spawn.mjs";

import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";

const STORE = process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE;
const NOT_FOUND = "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n";

function answer(args) {
  const items = STORE === undefined ? {} : JSON.parse(readFileSync(STORE, "utf8")).items;
  const service = args[args.indexOf("-s") + 1];
  const account = args[args.indexOf("-a") + 1];
  const value = items[`${service}|${account}`];
  if (STORE !== undefined) appendFileSync(`${STORE}.log`, `${JSON.stringify({ command: args[0], account })}\n`);
  if (args[0] !== "find-generic-password") return { code: 1, stdout: "", stderr: "unsupported fake command\n" };
  if (value === undefined) return { code: 44, stdout: "", stderr: NOT_FOUND };
  const stderr = args.includes("-g") ? `password: "${value}"\n` : "";
  return { code: 0, stdout: `keychain: "fake"\nattributes:\n    "acct"<blob>="${account}"\n`, stderr };
}

function fakeChild(args) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 0;
  child.kill = () => true;
  const result = answer(args);
  setImmediate(() => {
    child.stdout.end(result.stdout);
    child.stderr.end(result.stderr);
    setImmediate(() => child.emit("close", result.code, null));
  });
  return child;
}

const guarded = childProcess.spawn;
childProcess.spawn = function spawn(file, args, ...rest) {
  if (file === "/usr/bin/security") return fakeChild(Array.isArray(args) ? args : []);
  return guarded.call(this, file, args, ...rest);
};
syncBuiltinESMExports();

export const FAKE_KEYCHAIN_SPAWN = new URL(import.meta.url);
