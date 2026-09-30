// invariant: the one process boundary every OS credential backend crosses
// (#379). A credential value reaches a child only on stdin and comes back only
// on a captured stream; no backend places it in argv or in the child
// environment, and no captured text ever reaches an error.
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

// invariant: every spawn is bounded. A child killed at its timeout is a store
// waiting for a person (locked, or an approval prompt nobody answered), and a
// tool that cannot be started is a store that is not installed; neither is
// ever reported as a hang or as a generic failure.
export async function runBounded(
  runner: CredentialToolRunner,
  invocation: CredentialToolInvocation
): Promise<CredentialToolResult> {
  let result: CredentialToolResult;
  try {
    result = await runner(invocation);
  } catch (error) {
    if (error instanceof CredentialToolUnavailableError) throw storeUnavailable(error);
    throw error;
  }
  if (result.timedOut === true) throw interactionRequired();
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
