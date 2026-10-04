import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
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

const LOGIN_FILE = "auth.json";
// why: a Codex login file holds a few tokens; one past this size is no login.
const MAXIMUM_LOGIN_BYTES = 1024 * 1024;
const LOGIN_SECRETS = Object.freeze(["access_token", "refresh_token", "id_token", "account_id"]);
const API_KEY_FIELD = /api[_-]?key/iu;
// why: the claims of an ID token that name the account, its user, its
// organizations, or its sign-in session; plan, issuer, audience, and times
// name no one, and withholding a common word would refuse ordinary results.
const IDENTITY_CLAIMS = new Set(["sub", "sid", "email", "id"]);

// hazard: neither the file's text nor a parser's message, which quotes it,
// may reach the error, so the refusal carries no cause.
function unreadableLogin() {
  return notConfigured("codex-login", "The Codex login file of the Workspace identity directory is not readable");
}

async function loginText(path: string): Promise<string | undefined> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if ((error as { readonly code?: unknown }).code === "ENOENT") return undefined;
    throw unreadableLogin();
  }
  if (size > MAXIMUM_LOGIN_BYTES) throw unreadableLogin();
  return readFile(path, "utf8").catch(() => {
    throw unreadableLogin();
  });
}

function loginRecord(text: string): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw unreadableLogin();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw unreadableLogin();
  return parsed as Readonly<Record<string, unknown>>;
}

function isIdentityClaim(name: string): boolean {
  return IDENTITY_CLAIMS.has(name) || name.endsWith("_id");
}

// why: walked breadth-first without recursion, so no nesting depth in the
// payload can exhaust the stack.
function identityClaims(payload: unknown): readonly unknown[] {
  const claims: unknown[] = [];
  const pending: unknown[] = [payload];
  for (let index = 0; index < pending.length; index += 1) {
    const value = pending[index];
    if (value === null || typeof value !== "object") continue;
    for (const [name, member] of Object.entries(value)) {
      if (typeof member !== "string") pending.push(member);
      else if (isIdentityClaim(name)) claims.push(member);
    }
  }
  return claims;
}

// invariant: SSI-49 and SSI-53. An ID token is a JWT whose payload anyone can
// decode, so a model can copy the account's identifiers out of it decoded;
// they are withheld as values of their own.
// hazard: a parser's message quotes the payload, so it is dropped; a token
// whose payload is not JSON names nothing decoded and is withheld whole.
function idTokenClaims(idToken: unknown): readonly unknown[] {
  if (typeof idToken !== "string") return [];
  const payload = idToken.split(".")[1];
  if (payload === undefined) return [];
  try {
    return identityClaims(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  } catch {
    return [];
  }
}

// invariant: SSI-49. The secret values of the Workspace's Codex login, which
// every Codex session of a run can read from its CODEX_HOME: the access,
// refresh, and ID tokens and the account id of a ChatGPT login, the account
// identifiers its ID token carries, and any API key field. They are read only
// to be withheld from node results, never logged, persisted, or placed in an
// error; a directory with no login file has none.
export async function codexLoginSecrets(directory: string): Promise<readonly string[]> {
  const text = await loginText(join(directory, LOGIN_FILE));
  if (text === undefined) return [];
  const login = loginRecord(text);
  const field = login["tokens"];
  const tokens: Readonly<Record<string, unknown>> =
    field !== null && typeof field === "object" ? (field as Readonly<Record<string, unknown>>) : {};
  const keyValues = Object.entries(login)
    .filter(([name]) => API_KEY_FIELD.test(name))
    .map(([, value]) => value);
  const secrets = [...LOGIN_SECRETS.map((name) => tokens[name]), ...keyValues, ...idTokenClaims(tokens["id_token"])];
  return [...new Set(secrets.filter((value): value is string => typeof value === "string" && value !== ""))];
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
