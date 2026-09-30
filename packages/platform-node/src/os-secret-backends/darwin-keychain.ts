// invariant: the value crosses a process boundary only on stdin (writes, hex
// encoded, via `security -i`) or on the child's captured stderr (reads), and
// never in any argv or environment (#379, AD-034). Presence is an
// attribute-only lookup that never retrieves the value.
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "../platform-security-errors.ts";
import { type OsSecretBackend, type OsSecretLocator, isValidLogicalSecretName } from "../secret-broker.ts";

export const SECURITY_EXECUTABLE = "/usr/bin/security";

// hazard: `security -i` reads each command into a fixed 4096-byte buffer. A
// longer line is split, the tail is executed as a separate command and echoed
// verbatim to stderr, and the truncated head loses its trailing keychain
// argument, so it lands in the default keychain. Every interactive line this
// module writes, newline excluded, must fit in 4095 bytes.
export const SECURITY_INTERACTIVE_LINE_LIMIT = 4095;

// why: security(1) exits 44 when no item matches; any other nonzero exit is a failure.
const ITEM_NOT_FOUND = 44;
const MAX_KEYCHAIN_PATH_LENGTH = 1024;
const KEYCHAIN_PATH = /^\/[A-Za-z0-9._/+-]+$/u;
const KEYCHAIN_MAGIC = "kych";
const MAX_CAPTURED_OUTPUT = 1024 * 1024;

// why: a presence lookup must finish inside deep doctor's 5 s probe budget so
// this module, not the doctor's timer, kills a hung `security` child.
export const PRESENCE_TIMEOUT_MS = 4_000;
// why: a read of the default keychain may legitimately wait for the user to
// approve a keychain prompt; the timeout bounds that wait instead of hanging.
export const READ_TIMEOUT_MS = 30_000;
export const WRITE_TIMEOUT_MS = 15_000;

export interface SecurityInvocation {
  readonly args: readonly string[];
  readonly stdin?: Uint8Array;
  readonly timeoutMs: number;
}

export interface SecurityResult {
  // invariant: null when the child was killed (timeout) or ended by a signal.
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  // invariant: true only when the runner killed the child at its timeout.
  readonly timedOut?: boolean;
}

export type SecurityRunner = (invocation: SecurityInvocation) => Promise<SecurityResult>;

export function securityChildEnvironment(): NodeJS.ProcessEnv {
  // invariant: the child inherits no ambient variable beyond what `security`
  // needs to locate the invoking user's keychains, and never a credential.
  const environment: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };
  for (const key of ["HOME", "USER", "LOGNAME"]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export const nodeSecurityRunner: SecurityRunner = (invocation) =>
  new Promise((resolveResult, rejectResult) => {
    const child = spawn(SECURITY_EXECUTABLE, [...invocation.args], {
      env: securityChildEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let captured = 0;
    const collect = (sink: Buffer[]) => (chunk: Buffer) => {
      captured += chunk.length;
      if (captured <= MAX_CAPTURED_OUTPUT) sink.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, invocation.timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      rejectResult(new Error("the security executable could not be started"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const result = {
        exitCode: code,
        timedOut,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      };
      for (const chunk of [...stdout, ...stderr]) chunk.fill(0);
      resolveResult(result);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(invocation.stdin);
  });

function failure(message: string, exitCode?: number | null): PlatformSecurityError {
  // invariant: no stdout or stderr text reaches an error — either stream may
  // carry the value or, for an oversize line, its hex encoding.
  return new PlatformSecurityError("VES_SECRET_BACKEND_FAILURE", message, { exitStatus: exitStatus(exitCode) });
}

function exitStatus(exitCode: number | null | undefined): string {
  if (exitCode === undefined) return "none";
  if (exitCode === null) return "killed";
  return String(exitCode);
}

function assertLocator(locator: Readonly<OsSecretLocator>): void {
  const prefix = "verchestra/";
  let workspaceValid = false;
  if (typeof locator?.namespace === "string" && locator.namespace.startsWith(prefix)) {
    try {
      StableId.parse(locator.namespace.slice(prefix.length), "workspace");
      workspaceValid = true;
    } catch {
      workspaceValid = false;
    }
  }
  if (!workspaceValid || !isValidLogicalSecretName(locator.logicalName)) {
    throw new PlatformSecurityError("VES_SECRET_BINDING_INVALID", "Keychain locator is not a canonical binding");
  }
}

export function assertKeychainPathSyntax(path: string): void {
  if (
    typeof path !== "string" ||
    path.length > MAX_KEYCHAIN_PATH_LENGTH ||
    !KEYCHAIN_PATH.test(path) ||
    path.endsWith("/") ||
    path.split("/").some((segment, index) => index > 0 && (segment === "" || segment === "." || segment === ".."))
  ) {
    throw new PlatformSecurityError("VES_SECRET_KEYCHAIN_INVALID", "Keychain path is not an absolute canonical path");
  }
}

// why: printable ASCII without whitespace (0x21-0x7e) covers every provider
// API key and makes stray whitespace from a paste an error, not a credential.
export function isValidCredentialValue(value: Uint8Array): boolean {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > MAX_CREDENTIAL_VALUE_BYTES) return false;
  for (const byte of value) if (byte < 0x21 || byte > 0x7e) return false;
  return true;
}

function addCommandPrefix(locator: Readonly<OsSecretLocator>): string {
  return `add-generic-password -s ${locator.namespace} -a ${locator.logicalName} -T ${SECURITY_EXECUTABLE} -X `;
}

function keychainSuffix(keychainPath: string | undefined): string {
  return keychainPath === undefined ? "" : ` ${keychainPath}`;
}

// invariant: the value budget is derived from the line limit, not chosen —
// the longest namespace, logical name, and keychain path accepted here leave
// this many hex characters, and each value byte costs two.
const WORST_CASE_OVERHEAD =
  addCommandPrefix({
    namespace: `verchestra/workspace_${"0".repeat(36)}`,
    logicalName: "a".repeat(128)
  }).length + keychainSuffix(`/${"a".repeat(MAX_KEYCHAIN_PATH_LENGTH - 1)}`).length;

export const MAX_CREDENTIAL_VALUE_BYTES = Math.floor((SECURITY_INTERACTIVE_LINE_LIMIT - WORST_CASE_OVERHEAD) / 2);

const PASSWORD_LINE = /^password: (?:"([\x20\x21\x23-\x5b\x5d-\x7e]*)"|0x((?:[0-9A-F]{2})*)(?: {2}"[^\n]*")?)$/mu;

function parsePassword(stderr: string): Uint8Array {
  const match = PASSWORD_LINE.exec(stderr);
  if (match === null) throw failure("Keychain returned an unrecognized password record");
  if (match[1] !== undefined) return Uint8Array.from(Buffer.from(match[1], "latin1"));
  return Uint8Array.from(Buffer.from(match[2] ?? "", "hex"));
}

async function isUserKeychainFile(path: string): Promise<boolean> {
  let handle;
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    if (typeof process.getuid === "function" && stats.uid !== process.getuid()) return false;
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const header = Buffer.alloc(KEYCHAIN_MAGIC.length);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.toString("latin1") === KEYCHAIN_MAGIC;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

export interface CredentialProvisioner {
  store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void>;
  delete(locator: Readonly<OsSecretLocator>): Promise<boolean>;
}

export class DarwinKeychainBackend implements OsSecretBackend, CredentialProvisioner {
  readonly #runner: SecurityRunner;
  readonly #keychainPath: string | undefined;

  constructor(options: { readonly runner?: SecurityRunner; readonly keychainPath?: string } = {}) {
    if (options.keychainPath !== undefined) assertKeychainPathSyntax(options.keychainPath);
    this.#runner = options.runner ?? nodeSecurityRunner;
    this.#keychainPath = options.keychainPath;
  }

  get keychain(): "default" | "explicit" {
    return this.#keychainPath === undefined ? "default" : "explicit";
  }

  // hazard: `security add-generic-password` given a missing, non-keychain, or
  // directory path silently writes to the default (login) keychain instead.
  // Every operation re-proves the named file is a real keychain the invoking
  // user owns, without calling `security` on it (which raises an unlock
  // dialog when that keychain is locked).
  async verifyKeychain(): Promise<void> {
    if (this.#keychainPath === undefined) return;
    if (!(await isUserKeychainFile(this.#keychainPath)))
      throw new PlatformSecurityError(
        "VES_SECRET_KEYCHAIN_INVALID",
        "Keychain path does not name a usable keychain file"
      );
  }

  #lookupArgs(command: string, locator: Readonly<OsSecretLocator>, extra: readonly string[] = []): string[] {
    return [
      command,
      "-s",
      locator.namespace,
      "-a",
      locator.logicalName,
      ...extra,
      ...(this.#keychainPath === undefined ? [] : [this.#keychainPath])
    ];
  }

  // invariant: every spawn is bounded, and a child killed by its timeout is
  // reported as "keychain interaction required" — a locked keychain or an
  // approval dialog nobody answered — never as a hang or a generic failure.
  async #run(invocation: SecurityInvocation): Promise<SecurityResult> {
    const result = await this.#runner(invocation);
    if (result.timedOut === true) {
      throw new PlatformSecurityError(
        "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED",
        "Keychain did not answer in time; it is locked or waiting for approval"
      );
    }
    return result;
  }

  async has(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    assertLocator(locator);
    await this.verifyKeychain();
    const result = await this.#run({
      args: this.#lookupArgs("find-generic-password", locator),
      timeoutMs: PRESENCE_TIMEOUT_MS
    });
    if (result.exitCode === 0) return true;
    if (result.exitCode === ITEM_NOT_FOUND) return false;
    throw failure("Keychain presence lookup failed", result.exitCode);
  }

  async read(locator: Readonly<OsSecretLocator>): Promise<Uint8Array | undefined> {
    assertLocator(locator);
    await this.verifyKeychain();
    // why: `-g` rather than `-w`. `-w` prints printable values raw but
    // hex-encodes any value holding a non-printable byte, with no marker, so
    // "41ff" could be either. `-g` prefixes the hex form with 0x.
    const result = await this.#run({
      args: this.#lookupArgs("find-generic-password", locator, ["-g"]),
      timeoutMs: READ_TIMEOUT_MS
    });
    if (result.exitCode === ITEM_NOT_FOUND) return undefined;
    if (result.exitCode !== 0) throw failure("Keychain read failed", result.exitCode);
    return parsePassword(result.stderr);
  }

  async store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void> {
    if (!isValidCredentialValue(value)) {
      throw new PlatformSecurityError(
        "VES_SECRET_VALUE_INVALID",
        "Credential value is empty, oversize, or not printable"
      );
    }
    assertLocator(locator);
    await this.verifyKeychain();
    const prefix = Buffer.from(addCommandPrefix(locator), "latin1");
    const suffix = Buffer.from(`${keychainSuffix(this.#keychainPath)}\n`, "latin1");
    const hex = Buffer.from(Buffer.from(value).toString("hex"), "latin1");
    const line = Buffer.concat([prefix, hex, suffix]);
    hex.fill(0);
    let replaced = false;
    try {
      // invariant: never hand `security -i` a line it would split.
      if (line.length - 1 > SECURITY_INTERACTIVE_LINE_LIMIT) {
        throw new PlatformSecurityError(
          "VES_SECRET_VALUE_INVALID",
          "Credential value exceeds the keychain line budget"
        );
      }
      // hazard: updating an existing item in place (`-U`) together with `-T`
      // rewrites its access list, which raises a keychain approval dialog. A
      // rotation therefore deletes the old item and adds a fresh one, so it is
      // not atomic: a failure after the delete leaves the credential absent,
      // and that state gets its own error telling the user to run it again.
      if (await this.has(locator)) replaced = await this.delete(locator);
      const result = await this.#run({ args: ["-i"], stdin: line, timeoutMs: WRITE_TIMEOUT_MS });
      if (result.exitCode !== 0) throw failure("Keychain write failed", result.exitCode);
      if (!(await this.has(locator))) throw failure("Keychain write did not land in the selected keychain");
    } catch (error) {
      if (!replaced) throw error;
      throw new PlatformSecurityError(
        "VES_SECRET_ROTATION_INCOMPLETE",
        "The previous credential was removed and the new one was not stored",
        {},
        { cause: error }
      );
    } finally {
      line.fill(0);
    }
  }

  async delete(locator: Readonly<OsSecretLocator>): Promise<boolean> {
    assertLocator(locator);
    await this.verifyKeychain();
    const result = await this.#run({
      args: this.#lookupArgs("delete-generic-password", locator),
      timeoutMs: WRITE_TIMEOUT_MS
    });
    if (result.exitCode === 0) return true;
    if (result.exitCode === ITEM_NOT_FOUND) return false;
    throw failure("Keychain delete failed", result.exitCode);
  }
}
