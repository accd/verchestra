import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { notConfigured } from "./task-errors.ts";
import { passThroughEnvironment } from "./task-implementer.ts";

const execFileAsync = promisify(execFile);
const STATUS_TIMEOUT_MS = 15_000;
const STATUS_OUTPUT_BYTES = 64 * 1024;
const CHATGPT_LOGIN = "Logged in using ChatGPT";

// invariant: the verifier's subscription identity lives in this one directory
// under the Workspace's machine-local state root. It is the only CODEX_HOME a
// subscription verifier ever gets, and it is never `~/.codex`.
export const CODEX_IDENTITY_DIRECTORY = "codex-identity";

// invariant: the file store keeps the Codex credential in `auth.json` inside
// the identity directory and out of the OS credential store, whose value
// limit it exceeds; the forced method makes an API-key login there count as
// not logged in, so a billed key can never stand in for the subscription.
export const CODEX_IDENTITY_CONFIG = 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n';

export function codexIdentityDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, CODEX_IDENTITY_DIRECTORY);
}

function shellQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// why: the one command the owner runs once; the path is machine-local, so it
// is shown on the terminal and never placed in a public error or a record.
export function codexLoginCommand(directory: string): string {
  return `CODEX_HOME=${shellQuoted(directory)} codex login`;
}

// invariant: `config.toml` is rewritten whole before every use, so nothing a
// previous session or another process left there steers the next one, and the
// directory is a real directory private to the user, never a link.
export async function ensureCodexIdentity(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory())
    throw notConfigured("codex-identity", "The Codex identity directory is not a real directory");
  await chmod(directory, 0o700);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, CODEX_IDENTITY_CONFIG, { mode: 0o600, flag: "wx", flush: true });
    await rename(temporary, join(directory, "config.toml"));
  } finally {
    await rm(temporary, { force: true });
  }
}

export interface CodexLoginStatusOptions {
  readonly command: readonly string[];
  readonly directory: string;
  readonly home: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs?: number;
}

// invariant: only the exact ChatGPT line with exit code 0 counts. An API-key
// login, an access token, an error, a timeout, and any unrecognized answer are
// all "not configured", never a pass. The stored credential is never read.
export async function codexSubscriptionLoggedIn(options: CodexLoginStatusOptions): Promise<boolean> {
  const [executable, ...prefix] = options.command;
  try {
    const { stdout, stderr } = await execFileAsync(executable as string, [...prefix, "login", "status"], {
      // why: the status check runs from the disposable home, so no project
      // configuration in the invoking directory is in reach.
      cwd: options.home,
      env: {
        ...passThroughEnvironment(options.env),
        HOME: options.home,
        USERPROFILE: options.home,
        CODEX_HOME: options.directory
      },
      encoding: "utf8",
      // hazard: every spawn is bounded; a hung status check is not a login.
      timeout: options.timeoutMs ?? STATUS_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: STATUS_OUTPUT_BYTES,
      windowsHide: true
    });
    return `${stdout}\n${stderr}`.split(/\r?\n/u).some((line) => line.trim() === CHATGPT_LOGIN);
  } catch {
    return false;
  }
}

export interface CodexSubscriptionOptions {
  readonly workspaceRoot: string;
  readonly sessionsRoot: string;
  readonly command: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stderr: (value: string) => void;
  readonly timeoutMs?: number;
}

// why: proven before the first workflow transition, so a missing login is
// `not configured` with nothing to clean up, and the owner is told the exact
// one-time command instead of a generic failure.
export async function requireCodexSubscription(options: CodexSubscriptionOptions): Promise<string> {
  const directory = codexIdentityDirectory(options.workspaceRoot);
  await ensureCodexIdentity(directory);
  await mkdir(options.sessionsRoot, { recursive: true, mode: 0o700 });
  const home = await mkdtemp(join(options.sessionsRoot, "codex-status-"));
  let loggedIn: boolean;
  try {
    loggedIn = await codexSubscriptionLoggedIn({
      command: options.command,
      directory,
      home,
      env: options.env,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
  if (loggedIn) return directory;
  options.stderr(
    `Codex is not signed in with a ChatGPT plan for this Workspace. Run once:\n  ${codexLoginCommand(directory)}\n`
  );
  throw notConfigured("codex-login", "Codex is not signed in with a ChatGPT plan in the Workspace identity directory");
}
