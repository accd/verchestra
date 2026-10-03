// invariant: the one process boundary every OS credential backend crosses
// (#379). A credential value reaches a child only on stdin and comes back only
// on a captured stream; no backend places it in argv or in the child
// environment, and no captured text ever reaches an error. The policy every
// backend applies at that boundary lives here too, not in one platform's
// adapter: how long a child may run, which value may be stored, and the write
// interface the credential store drives.
import { spawn } from "node:child_process";

import { StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "../platform-security-errors.ts";
import { type OsSecretLocator, isValidLogicalSecretName } from "../secret-broker.ts";

const MAX_CAPTURED_OUTPUT = 1024 * 1024;

export interface CredentialToolInvocation {
  // invariant: which of a backend's fixed programs runs, for a backend that
  // has more than one; its runner maps the name to an absolute path and
  // refuses any other. Omitted, the backend's primary program runs.
  readonly tool?: string;
  readonly args: readonly string[];
  readonly stdin?: Uint8Array;
  readonly timeoutMs: number;
}

export interface CredentialToolResult {
  // invariant: null when the child was killed (timeout) or ended by a signal.
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  // invariant: true only when the runner killed the child at its timeout.
  readonly timedOut?: boolean;
}

export type CredentialToolRunner = (invocation: CredentialToolInvocation) => Promise<CredentialToolResult>;

// why: a presence lookup must finish inside deep doctor's 5 s probe budget so
// the backend, not the doctor's timer, kills a hung child.
export const PRESENCE_TIMEOUT_MS = 4_000;
// why: a read may legitimately wait for the user to approve a prompt from the
// store; the timeout bounds that wait instead of hanging.
export const READ_TIMEOUT_MS = 30_000;
export const WRITE_TIMEOUT_MS = 15_000;

export interface CredentialProvisioner {
  store(locator: Readonly<OsSecretLocator>, value: Uint8Array): Promise<void>;
  delete(locator: Readonly<OsSecretLocator>): Promise<boolean>;
}

// why: an executable missing from its fixed path means the platform store is
// not installed here; that is "not configured", distinct from a failure of a
// store that is present.
export class CredentialToolUnavailableError extends Error {
  constructor() {
    super("the credential tool could not be started");
    this.name = "CredentialToolUnavailableError";
  }
}

export function spawnCredentialTool(executable: string, environment: () => NodeJS.ProcessEnv): CredentialToolRunner {
  return (invocation) =>
    new Promise((resolveResult, rejectResult) => {
      const child = spawn(executable, [...invocation.args], {
        env: environment(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let captured = 0;
      const collect = (sink: Buffer[]) => (chunk: Buffer) => {
        captured += chunk.length;
        if (captured <= MAX_CAPTURED_OUTPUT) sink.push(chunk);
        else chunk.fill(0);
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
        rejectResult(new CredentialToolUnavailableError());
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
}

export function pickEnvironment(keys: readonly string[], fixed: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...fixed };
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export function backendFailure(message: string, exitCode?: number | null): PlatformSecurityError {
  // invariant: no stdout or stderr text reaches an error — either stream may
  // carry the value or an encoding of it.
  return new PlatformSecurityError("VES_SECRET_BACKEND_FAILURE", message, { exitStatus: exitStatus(exitCode) });
}

function exitStatus(exitCode: number | null | undefined): string {
  if (exitCode === undefined) return "none";
  if (exitCode === null) return "killed";
  return String(exitCode);
}

export function interactionRequired(): PlatformSecurityError {
  return new PlatformSecurityError(
    "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED",
    "The credential store did not answer in time; it is locked or waiting for approval"
  );
}

export function storeUnavailable(cause?: unknown): PlatformSecurityError {
  return new PlatformSecurityError(
    "VES_SECRET_STORE_UNAVAILABLE",
    "The platform credential store is not available in this session",
    {},
    cause === undefined ? undefined : { cause }
  );
}

// invariant: every spawn is bounded. A child killed at its timeout is, by
// default, a store waiting for a person (locked, or an approval prompt nobody
// answered); a backend whose store never prompts names its own timeout error.
// A tool that cannot be started is a store that is not installed. Neither is
// ever reported as a hang.
export async function runBounded(
  runner: CredentialToolRunner,
  invocation: CredentialToolInvocation,
  onTimeout: () => PlatformSecurityError = interactionRequired
): Promise<CredentialToolResult> {
  let result: CredentialToolResult;
  try {
    result = await runner(invocation);
  } catch (error) {
    if (error instanceof CredentialToolUnavailableError) throw storeUnavailable(error);
    throw error;
  }
  if (result.timedOut === true) throw onTimeout();
  return result;
}

export function assertLocator(locator: Readonly<OsSecretLocator>): void {
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
    throw new PlatformSecurityError("VES_SECRET_BINDING_INVALID", "Credential locator is not a canonical binding");
  }
}

// why: one limit on every platform, so a credential that binds on one binds on
// all. It is the largest value macOS's `security -i` line can carry, which
// darwin-keychain.ts derives as KEYCHAIN_VALUE_BUDGET_BYTES;
// tests/unit/os-secret-backend-policy.test.mjs holds the two equal. Every
// reader of a credential sizes its input from this definition.
export const MAX_CREDENTIAL_VALUE_BYTES = 1416;

// why: printable ASCII without whitespace (0x21-0x7e) covers every provider
// API key and makes stray whitespace from a paste an error, not a credential.
export function isValidCredentialValue(value: Uint8Array): boolean {
  if (!(value instanceof Uint8Array) || value.length === 0 || value.length > MAX_CREDENTIAL_VALUE_BYTES) return false;
  for (const byte of value) if (byte < 0x21 || byte > 0x7e) return false;
  return true;
}

// invariant: every backend's write starts here, so an invalid value or locator
// is refused before any platform spawns anything.
export function assertStorable(locator: Readonly<OsSecretLocator>, value: Uint8Array): void {
  if (!isValidCredentialValue(value)) {
    throw new PlatformSecurityError(
      "VES_SECRET_VALUE_INVALID",
      "Credential value is empty, oversize, or not printable"
    );
  }
  assertLocator(locator);
}
