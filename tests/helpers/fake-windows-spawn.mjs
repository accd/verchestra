// invariant: a child `vestra` in the Windows task journey never reaches the
// user's Credential Manager and never starts a provider CLI (#379). Preloaded
// with `node --import`, this installs the deny guard from
// deny-keychain-spawn.mjs and then answers the two Credential Manager programs
// the Windows backend runs itself, from the JSON store the test names in
// VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE: `cmdkey /list:<target>` (presence) and
// the Windows PowerShell `Read` program on stdin, with the output conventions
// measured for #379 (docs/qualification/os-secret-backend-windows.md). It
// starts the labeled DETERMINISTIC FAKE `claude` and `codex` of
// tests/helpers/task-cli-fakes for the `claude.exe` and `codex.exe`
// placeholders in VERCHESTRA_TEST_FAKE_PROVIDERS, as the POSIX wrappers of
// task-cli-fixture.mjs do, and names every Git command of the task path that
// fails. Every other spawn passes through the deny guard unchanged; the
// bridge's pipe helper is the one PowerShell the guard lets by.
import "./deny-keychain-spawn.mjs";

import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { appendFileSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const STORE = process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE;
const PROVIDERS = process.env.VERCHESTRA_TEST_FAKE_PROVIDERS;
const PROVIDER_LOG = process.env.VERCHESTRA_TEST_FAKE_PROVIDER_LOG;
const FAKES = fileURLToPath(new URL("./task-cli-fakes/", import.meta.url));
const WITNESS = fileURLToPath(new URL("./provider-witness.mjs", import.meta.url));
const SCRIPTS = Object.freeze({ "claude.exe": "fake-claude-task.mjs", "codex.exe": "fake-codex-task.mjs" });

// why: the absolute paths the Windows backend starts, derived as it derives
// them, so nothing else under these names is ever answered.
const systemRoot = () => (process.env.SystemRoot ?? "C:\\Windows").replace(/\\+$/u, "");
const cmdkeyPath = () => `${systemRoot()}\\System32\\cmdkey.exe`;
const windowsPowerShellPath = () => `${systemRoot()}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const samePath = (left, right) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();

// invariant: a target is `verchestra/<workspace>/<logical name>`; the store
// keys an item `<service>|<account>` as the macOS fake does, so one store file
// serves the fakes on every platform.
function stored(target) {
  const cut = target.lastIndexOf("/");
  const items = STORE === undefined ? {} : JSON.parse(readFileSync(STORE, "utf8")).items;
  return items[`${target.slice(0, cut)}|${target.slice(cut + 1)}`];
}

function record(command, target) {
  if (STORE !== undefined)
    appendFileSync(
      `${STORE}.log`,
      `${JSON.stringify({ command, account: target.slice(target.lastIndexOf("/") + 1) })}\n`
    );
}

// why: `cmdkey /list:<target>` echoes the query on a header line ending in a
// colon and prints a `Target: <target>` line only for a stored credential.
function cmdkeyAnswer(args) {
  const target = /^\/list:(.+)$/u.exec(args[0] ?? "")?.[1];
  if (target === undefined || args.length !== 1) return { code: 1, stdout: "" };
  record("cmdkey", target);
  const header = `\r\nCurrently stored credentials for ${target}:\r\n\r\n`;
  const body = stored(target) === undefined ? "* NONE *\r\n" : `    Target: ${target}\r\n    Type: Generic \r\n`;
  return { code: 0, stdout: `${header}${body}` };
}

// why: the backend's Read program names its target once and expects one
// marker line back; a program that writes or deletes is no part of a task.
function readAnswer(program) {
  const target = /::Read\('([^']+)'\)/u.exec(program)?.[1];
  if (target === undefined) return { code: 0, stdout: "verchestra-credential:error:unsupported\r\n" };
  record("Read", target);
  const value = stored(target);
  const line = value === undefined ? "absent" : `value:${Buffer.from(value, "utf8").toString("base64")}`;
  return { code: 0, stdout: `verchestra-credential:${line}\r\n` };
}

function fakeChild(answer) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.pid = 0;
  child.kill = () => true;
  let input = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk) => (input += chunk));
  child.stdin.on("end", () => {
    const result = answer(input);
    setImmediate(() => {
      child.stdout.end(result.stdout);
      child.stderr.end("");
      setImmediate(() => child.emit("close", result.code, null));
    });
  });
  return child;
}

// invariant: a placeholder starts its fake with this Node executable, the
// fixture's private log directory, and its store ahead of the provider
// arguments, exactly as the POSIX wrapper scripts do, under the provider
// witness, which writes `<placeholder>.witness.log` in that log directory.
function providerCommand(file, args) {
  if (PROVIDERS === undefined || typeof file !== "string" || !samePath(dirname(file), PROVIDERS)) return undefined;
  const placeholder = basename(file).toLowerCase();
  const script = SCRIPTS[placeholder];
  if (script === undefined) return undefined;
  const log = PROVIDER_LOG ?? "";
  const witness = [WITNESS, "--witness", join(log, `${placeholder}.witness.log`), "--as", file];
  const prefix = [join(FAKES, script), "--fixture-log", log, "--fixture-store", STORE ?? ""];
  return [process.execPath, [...witness, ...prefix, ...(Array.isArray(args) ? args : [])]];
}

const guardedSpawn = childProcess.spawn;
childProcess.spawn = function spawn(file, args, ...rest) {
  if (samePath(file, cmdkeyPath())) return fakeChild(() => cmdkeyAnswer(Array.isArray(args) ? args : []));
  if (samePath(file, windowsPowerShellPath())) return fakeChild((program) => readAnswer(program));
  const provider = providerCommand(file, args);
  if (provider === undefined) return guardedSpawn.call(this, file, args, ...rest);
  return guardedSpawn.call(this, provider[0], provider[1], ...rest);
};

const GIT = new Set(["git", "git.exe"]);
const GIT_STDERR_TAIL = 2048;

// why: the task path runs Git through promisify(execFile) and keeps none of
// its output in a record. A Git command that fails is named here, in the
// fixture's log directory, with its arguments, working directory, exit code,
// and standard error tail, so a run that ends VES_GIT_WORKTREE_COMMAND_FAILED on the Windows
// runner says which command failed and why. The promise is returned as it is.
function witnessGit(file, args, options, promise) {
  if (PROVIDER_LOG === undefined || typeof file !== "string" || !GIT.has(basename(file).toLowerCase())) return promise;
  promise.then(undefined, (error) => {
    const line = {
      args: Array.isArray(args) ? args : [],
      cwd: options?.cwd ?? null,
      code: error?.code ?? null,
      signal: error?.signal ?? null,
      stderrTail: String(error?.stderr ?? "").slice(-GIT_STDERR_TAIL)
    };
    // hazard: a witness that cannot write must not turn into an unhandled
    // rejection of its own; the caller still sees the command's failure.
    try {
      appendFileSync(join(PROVIDER_LOG, "git-witness.log"), `${JSON.stringify(line)}\n`);
    } catch {
      // why: nothing to report to; the run reports the failure itself.
    }
  });
  return promise;
}

const guardedExecFile = childProcess.execFile;
const redirected = (target) =>
  function execFile(file, args, ...rest) {
    const provider = providerCommand(file, args);
    if (provider === undefined) return target.call(this, file, args, ...rest);
    return target.call(this, provider[0], provider[1], ...rest);
  };
const witnessed = (target) =>
  function execFile(file, args, ...rest) {
    const provider = providerCommand(file, args);
    if (provider !== undefined) return target.call(this, provider[0], provider[1], ...rest);
    return witnessGit(file, args, rest[0], target.call(this, file, args, ...rest));
  };
const execFile = redirected(guardedExecFile);
// why: the drivers, the Codex status check, and the Git runner call
// promisify(execFile), which takes this custom form; without it they would
// bypass the placeholders and the Git witness.
Object.defineProperty(execFile, promisify.custom, { value: witnessed(guardedExecFile[promisify.custom]) });
childProcess.execFile = execFile;
syncBuiltinESMExports();

export const FAKE_WINDOWS_SPAWN = new URL(import.meta.url);
