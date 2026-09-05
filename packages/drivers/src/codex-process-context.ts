import { isAbsolute } from "node:path";
import { DriverProtocolError } from "./index.ts";

/** Machine-local composition input, never a portable driver request or event. */
export interface CodexProcessContext {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
}

// libuv's Windows process launcher fills omitted required_vars from its parent.
// Suppress identity/search/temp fallback. SYSTEMROOT, SYSTEMDRIVE and WINDIR are
// left to the platform loader: blanking SYSTEMROOT breaks Node's CSPRNG startup.
// This does not provide OS isolation; the composition still owns its sandbox.
const WINDOWS_DEFAULTS = Object.freeze({
  HOMEDRIVE: "",
  HOMEPATH: "",
  LOGONSERVER: "",
  PATH: "",
  TEMP: "",
  USERDOMAIN: "",
  USERNAME: "",
  USERPROFILE: ""
});

function invalidContext(): never {
  throw new DriverProtocolError("VES_CODEX_PROCESS_CONTEXT_INVALID", "Codex process context is invalid");
}

function absolutePath(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value) || value.includes("\0")) invalidContext();
  return value;
}

function assertIdentityDirectories(environment: Readonly<Record<string, string>>): void {
  for (const key of ["HOME", "USERPROFILE", "CODEX_HOME"]) absolutePath(environment[key]);
}

export function codexProcessEnvironment(
  context: CodexProcessContext,
  explicit: Readonly<Record<string, string>>
): Record<string, string> {
  const merged = { ...context.environment, ...snapshotEnvironment(explicit) };
  assertIdentityDirectories(merged);
  return merged;
}

function snapshotEnvironment(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalidContext();
  const result: Record<string, string> = Object.create(null);
  const names = new Set<string>();
  for (const [key, entry] of Object.entries(value)) {
    const name = process.platform === "win32" ? key.toUpperCase() : key;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof entry !== "string" || entry.includes("\0")) invalidContext();
    if (names.has(name)) invalidContext();
    names.add(name);
    result[name] = entry;
  }
  return Object.freeze(result);
}

export function snapshotCodexProcessContext(
  context: CodexProcessContext,
  executable: string | undefined
): CodexProcessContext {
  if (context === null || typeof context !== "object" || Array.isArray(context)) invalidContext();
  const cwd = absolutePath(context.cwd);
  absolutePath(executable);
  const environment = snapshotEnvironment(context.environment);
  assertIdentityDirectories(environment);
  return Object.freeze({
    cwd,
    environment: Object.freeze({ ...(process.platform === "win32" ? WINDOWS_DEFAULTS : {}), ...environment })
  });
}
