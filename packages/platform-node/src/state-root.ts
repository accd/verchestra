import { mkdir, realpath } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, sep, win32 } from "node:path";

import { StableId } from "@verchestra/domain";

import { PlatformSecurityError } from "./platform-security-errors.ts";

type SupportedPlatform = "win32" | "darwin" | "linux";

interface StateRootOptions {
  readonly platform: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  readonly override?: string;
}

function paths(platform: string): typeof win32 | typeof posix {
  return platform === "win32" ? win32 : posix;
}

function assertSupportedPlatform(platform: string): asserts platform is SupportedPlatform {
  if (!new Set(["win32", "darwin", "linux"]).has(platform)) {
    throw new PlatformSecurityError("VES_STATE_PLATFORM_UNSUPPORTED", "Platform has no qualified state-root layout");
  }
}

function requireAbsolute(value: string, platform: string): string {
  const api = paths(platform);
  if (value.includes("\0") || !api.isAbsolute(value)) {
    throw new PlatformSecurityError("VES_STATE_ROOT_INVALID", "State root must be an absolute OS-native path");
  }
  return api.normalize(value);
}

export function resolveStateRoot(options: StateRootOptions): string {
  assertSupportedPlatform(options.platform);
  const platform = options.platform as SupportedPlatform;
  if (options.override !== undefined) return requireAbsolute(options.override, platform);
  const api = paths(platform);
  const home = requireAbsolute(options.homeDirectory, platform);
  if (platform === "win32") {
    const configured = options.env["LOCALAPPDATA"];
    const local = configured === undefined || configured.length === 0 ? api.join(home, "AppData", "Local") : configured;
    return api.join(requireAbsolute(local, platform), "Verchestra", "state");
  }
  if (platform === "darwin") return api.join(home, "Library", "Application Support", "Verchestra", "state");
  const xdg = options.env["XDG_STATE_HOME"];
  return xdg === undefined || xdg.length === 0
    ? api.join(home, ".local", "state", "verchestra")
    : api.join(requireAbsolute(xdg, platform), "verchestra");
}

export interface WorkspaceStateLayout {
  readonly workspaceId: string;
  readonly stateRoot: string;
  readonly workspaceRoot: string;
  readonly runtimeRoot: string;
  readonly runtimeDatabase: string;
  readonly memoryRoot: string;
  readonly memoryDatabase: string;
  readonly backupsRoot: string;
  readonly locksRoot: string;
  readonly cacheRoot: string;
  readonly sessionsRoot: string;
  readonly worktreesRoot: string;
  readonly logsRoot: string;
  readonly secretsNamespace: string;
}

export function resolveWorkspaceState(options: {
  readonly stateRoot: string;
  readonly workspaceId: string;
  readonly platform: string;
}): WorkspaceStateLayout {
  assertSupportedPlatform(options.platform);
  try {
    StableId.parse(options.workspaceId, "workspace");
  } catch (error) {
    throw new PlatformSecurityError("VES_WORKSPACE_ID_INVALID", "Workspace ID is invalid", {}, { cause: error });
  }
  const api = paths(options.platform);
  const stateRoot = requireAbsolute(options.stateRoot, options.platform);
  const workspaceRoot = api.join(stateRoot, "workspaces", options.workspaceId);
  const runtimeRoot = api.join(workspaceRoot, "runtime");
  const memoryRoot = api.join(workspaceRoot, "memory");
  return Object.freeze({
    workspaceId: options.workspaceId,
    stateRoot,
    workspaceRoot,
    runtimeRoot,
    runtimeDatabase: api.join(runtimeRoot, "runtime.sqlite"),
    memoryRoot,
    memoryDatabase: api.join(memoryRoot, "memory.sqlite"),
    backupsRoot: api.join(workspaceRoot, "backups"),
    locksRoot: api.join(workspaceRoot, "locks"),
    cacheRoot: api.join(workspaceRoot, "cache"),
    sessionsRoot: api.join(workspaceRoot, "sessions"),
    worktreesRoot: api.join(workspaceRoot, "worktrees"),
    logsRoot: api.join(workspaceRoot, "logs"),
    secretsNamespace: `verchestra/${options.workspaceId}`
  });
}

export async function ensureWorkspaceState(layout: WorkspaceStateLayout): Promise<{
  readonly workspaceRoot: string;
  readonly verifiedRealRoot: string;
}> {
  const comparable = (path: string): string => (process.platform === "win32" ? path.toLowerCase() : path);
  const requireWithin = (root: string, candidate: string): void => {
    const value = relative(comparable(root), comparable(candidate));
    if (value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))) return;
    throw new PlatformSecurityError("VES_STATE_ROOT_ESCAPE", "Workspace state path resolves outside its owner");
  };
  await mkdir(layout.stateRoot, { recursive: true, mode: 0o700 });
  const stateReal = await realpath(layout.stateRoot);
  const workspacesRoot = dirname(layout.workspaceRoot);
  await mkdir(workspacesRoot, { recursive: true, mode: 0o700 });
  const workspacesReal = await realpath(workspacesRoot);
  requireWithin(stateReal, workspacesReal);
  await mkdir(layout.workspaceRoot, { recursive: true, mode: 0o700 });
  const workspaceReal = await realpath(layout.workspaceRoot);
  requireWithin(workspacesReal, workspaceReal);
  const directories = [
    layout.runtimeRoot,
    layout.memoryRoot,
    layout.backupsRoot,
    layout.locksRoot,
    layout.cacheRoot,
    layout.sessionsRoot,
    layout.worktreesRoot,
    layout.logsRoot
  ];
  for (const directory of directories) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    requireWithin(workspaceReal, await realpath(directory));
  }
  return Object.freeze({ workspaceRoot: layout.workspaceRoot, verifiedRealRoot: workspaceReal });
}
