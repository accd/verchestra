import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { INSPECTION_CHILD_BOUND } from "@verchestra/application";
import { normalizeDeclaredSet } from "@verchestra/domain";

import { gitInspectionEnvironment, resolveGitExecutable } from "../git-executable.ts";

import {
  WorkspaceScanError,
  buildInventoryFingerprintV2,
  detectProjectMarker,
  parseGitFile,
  sanitizeRemoteUrl,
  type ProjectMarker
} from "./scanner-primitives.ts";

const execute = promisify(execFile);
const PRUNED_DIRECTORIES = new Set([".git", ".svn", ".hg", "node_modules"]);

export interface RepositoryInventory {
  readonly repositoryId: string;
  readonly logicalPath: string;
  readonly relation: "control" | "nested" | "submodule" | "worktree" | "placeholder";
  readonly status: "active" | "broken";
  readonly gitDirKind: "directory" | "file";
  readonly ignoredByControl: boolean;
  readonly sparseCheckout: boolean;
  readonly remoteFingerprint?: string;
  readonly brokenReason?: "gitdir-missing" | "gitdir-not-directory";
}

export interface ProjectInventory {
  readonly discoveryKey: string;
  readonly logicalPath: string;
  readonly marker: ProjectMarker;
  readonly gitOwnerId: string | null;
  readonly ignoredByControl: boolean;
}

export interface LinkInventory {
  readonly logicalPath: string;
  readonly kind: "symlink" | "junction";
  readonly boundary: "inside" | "outside" | "broken";
}

export interface WorkspaceInventory {
  readonly schemaVersion: 1;
  readonly repositories: readonly RepositoryInventory[];
  readonly projects: readonly ProjectInventory[];
  readonly links: readonly LinkInventory[];
  readonly fingerprint: string;
}

interface GitResult {
  readonly status: number;
  readonly stdout: string;
}

async function git(cwd: string, args: readonly string[]): Promise<GitResult> {
  try {
    const result = await execute(resolveGitExecutable(), ["-c", "core.fsmonitor=false", ...args], {
      cwd,
      encoding: "utf8",
      env: gitInspectionEnvironment(),
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      ...INSPECTION_CHILD_BOUND
    });
    return { status: 0, stdout: result.stdout.trim() };
  } catch (error) {
    // why: a child killed at its bound has no exit status, so a timeout is
    // never read as status 1; it fails the scan like any other Git failure.
    const failure = error as { readonly code?: unknown; readonly stdout?: unknown };
    const status = typeof failure.code === "number" ? failure.code : -1;
    if (status === 1) return { status, stdout: typeof failure.stdout === "string" ? failure.stdout.trim() : "" };
    throw new WorkspaceScanError("VES_WORKSPACE_GIT_FAILED", "Read-only Git inspection failed", { cause: error });
  }
}

function comparable(path: string): string {
  return process.platform === "win32" ? path.toLowerCase() : path;
}

function within(root: string, candidate: string): boolean {
  const value = relative(comparable(root), comparable(candidate));
  return value === "" || (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value));
}

function logical(controlRoot: string, path: string): string {
  const value = relative(controlRoot, path).replaceAll("\\", "/");
  if (value === "") return ".";
  if (value === ".." || value.startsWith("../") || value.includes("\0")) {
    throw new WorkspaceScanError("VES_WORKSPACE_PATH_OUTSIDE_CONTROL", "Inventory path is outside the control root");
  }
  return value;
}

function relationFromGitFile(gitDir: string): RepositoryInventory["relation"] {
  const normalized = gitDir.replaceAll("\\", "/");
  if (normalized.includes("/.git/modules/") || normalized.includes(".git/modules/")) return "submodule";
  if (normalized.includes("/.git/worktrees/") || normalized.includes(".git/worktrees/")) return "worktree";
  return "nested";
}

async function ignoredByControl(controlRoot: string, logicalPath: string): Promise<boolean> {
  if (logicalPath === ".") return false;
  return (await git(controlRoot, ["check-ignore", "-q", "--", logicalPath])).status === 0;
}

async function remoteFingerprint(repositoryRoot: string): Promise<string | undefined> {
  const result = await git(repositoryRoot, ["config", "--get", "remote.origin.url"]);
  if (result.status !== 0 || result.stdout.length === 0) return undefined;
  try {
    return buildInventoryFingerprintV2({ remote: sanitizeRemoteUrl(result.stdout) });
  } catch (error) {
    if (error instanceof WorkspaceScanError && error.code === "VES_WORKSPACE_REMOTE_INVALID") return undefined;
    throw error;
  }
}

async function activeRepository(
  controlRoot: string,
  repositoryRoot: string,
  relation: RepositoryInventory["relation"],
  gitDirKind: RepositoryInventory["gitDirKind"]
): Promise<RepositoryInventory> {
  const logicalPath = logical(controlRoot, repositoryRoot);
  const remote = await remoteFingerprint(repositoryRoot);
  const sparse = await git(repositoryRoot, ["config", "--bool", "core.sparseCheckout"]);
  return Object.freeze({
    repositoryId: buildInventoryFingerprintV2({ schemaVersion: 1, logicalPath, remoteFingerprint: remote ?? null }),
    logicalPath,
    relation,
    status: "active",
    gitDirKind,
    ignoredByControl: await ignoredByControl(controlRoot, logicalPath),
    sparseCheckout: sparse.status === 0 && sparse.stdout === "true",
    ...(remote === undefined ? {} : { remoteFingerprint: remote })
  });
}

async function brokenRepository(
  controlRoot: string,
  repositoryRoot: string,
  brokenReason: "gitdir-missing" | "gitdir-not-directory"
): Promise<RepositoryInventory> {
  const logicalPath = logical(controlRoot, repositoryRoot);
  return Object.freeze({
    repositoryId: buildInventoryFingerprintV2({ schemaVersion: 1, logicalPath, status: "broken", brokenReason }),
    logicalPath,
    relation: "placeholder",
    status: "broken",
    gitDirKind: "file",
    ignoredByControl: await ignoredByControl(controlRoot, logicalPath),
    sparseCheckout: false,
    brokenReason
  });
}

function filesystemErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function resolveGitDir(
  directory: string,
  declaredGitDir: string
): Promise<
  | Readonly<{ readonly status: "active"; readonly gitDir: string }>
  | Readonly<{ readonly status: "broken"; readonly reason: "gitdir-missing" | "gitdir-not-directory" }>
> {
  let gitDir: string;
  try {
    gitDir = await realpath(resolve(directory, declaredGitDir));
  } catch (error) {
    if (filesystemErrorCode(error) === "ENOENT") return Object.freeze({ status: "broken", reason: "gitdir-missing" });
    throw new WorkspaceScanError("VES_WORKSPACE_GIT_FAILED", "Git directory cannot be inspected", { cause: error });
  }
  try {
    if (!(await stat(gitDir)).isDirectory()) return Object.freeze({ status: "broken", reason: "gitdir-not-directory" });
  } catch (error) {
    if (filesystemErrorCode(error) === "ENOENT") return Object.freeze({ status: "broken", reason: "gitdir-missing" });
    throw new WorkspaceScanError("VES_WORKSPACE_GIT_FAILED", "Git directory cannot be inspected", { cause: error });
  }
  return Object.freeze({ status: "active", gitDir });
}

async function gitBoundaryOwner(
  controlRoot: string,
  directory: string,
  gitEntry: Dirent,
  owner: RepositoryInventory | null
): Promise<RepositoryInventory> {
  let effectiveOwner = owner;
  if (gitEntry.isDirectory()) {
    effectiveOwner = await activeRepository(controlRoot, directory, "nested", "directory");
  } else if (gitEntry.isFile()) {
    const parsed = parseGitFile(await readFile(join(directory, ".git"), "utf8"));
    const resolvedGitDir = await resolveGitDir(directory, parsed.gitDir);
    effectiveOwner =
      resolvedGitDir.status === "active"
        ? await activeRepository(controlRoot, directory, relationFromGitFile(resolvedGitDir.gitDir), "file")
        : await brokenRepository(controlRoot, directory, resolvedGitDir.reason);
  }
  if (effectiveOwner === null) {
    throw new WorkspaceScanError("VES_WORKSPACE_OWNER_AMBIGUOUS", "Git boundary has no resolved owner");
  }
  return effectiveOwner;
}

async function projectInventory(
  controlRoot: string,
  directory: string,
  marker: ProjectMarker,
  owner: RepositoryInventory | null
): Promise<ProjectInventory> {
  const logicalPath = logical(controlRoot, directory);
  return Object.freeze({
    discoveryKey: buildInventoryFingerprintV2({
      schemaVersion: 1,
      logicalPath,
      marker,
      gitOwnerId: owner?.status === "active" ? owner.repositoryId : null
    }),
    logicalPath,
    marker,
    gitOwnerId: owner?.status === "active" ? owner.repositoryId : null,
    ignoredByControl: await ignoredByControl(controlRoot, logicalPath)
  });
}

async function linkInventory(controlRoot: string, path: string): Promise<LinkInventory> {
  let boundary: LinkInventory["boundary"] = "broken";
  try {
    boundary = within(controlRoot, await realpath(path)) ? "inside" : "outside";
  } catch {
    // A broken link is inventory, not a traversal target.
  }
  return Object.freeze({
    logicalPath: logical(controlRoot, path),
    kind: process.platform === "win32" ? "junction" : "symlink",
    boundary
  });
}

interface ScanLimits {
  readonly maxDirectories: number;
  readonly maxEntries: number;
  readonly maxDepth: number;
}

export async function scanWorkspace(options: {
  readonly controlRoot: string;
  readonly limits?: Partial<ScanLimits>;
}): Promise<WorkspaceInventory> {
  const limits: ScanLimits = {
    maxDirectories: options.limits?.maxDirectories ?? 20_000,
    maxEntries: options.limits?.maxEntries ?? 100_000,
    maxDepth: options.limits?.maxDepth ?? 64
  };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new WorkspaceScanError("VES_WORKSPACE_SCAN_LIMIT", "Workspace scan limits must be positive safe integers");
  }
  const requestedRoot = await realpath(options.controlRoot);
  const topLevel = await git(requestedRoot, ["rev-parse", "--show-toplevel"]);
  if (topLevel.status !== 0 || comparable(await realpath(topLevel.stdout)) !== comparable(requestedRoot)) {
    throw new WorkspaceScanError("VES_WORKSPACE_CONTROL_ROOT_INVALID", "Path is not the exact Git control root");
  }

  const repositories: RepositoryInventory[] = [
    await activeRepository(requestedRoot, requestedRoot, "control", "directory")
  ];
  const projects: ProjectInventory[] = [];
  const links: LinkInventory[] = [];
  let directoryCount = 0;
  let entryCount = 0;

  async function walk(directory: string, owner: RepositoryInventory | null, depth: number): Promise<void> {
    directoryCount += 1;
    if (directoryCount > limits.maxDirectories || depth > limits.maxDepth) {
      throw new WorkspaceScanError("VES_WORKSPACE_SCAN_LIMIT", "Workspace directory or depth limit exceeded");
    }
    const entries = await readdir(directory, { withFileTypes: true });
    entryCount += entries.length;
    if (entryCount > limits.maxEntries) {
      throw new WorkspaceScanError("VES_WORKSPACE_SCAN_LIMIT", "Workspace entry limit exceeded");
    }
    const names = entries.map((entry) => entry.name);
    let effectiveOwner = owner;
    const gitEntry = entries.find((entry) => entry.name === ".git");
    if (directory !== requestedRoot && gitEntry !== undefined) {
      effectiveOwner = await gitBoundaryOwner(requestedRoot, directory, gitEntry, owner);
      repositories.push(effectiveOwner);
    }

    const marker = detectProjectMarker(names);
    if (marker !== undefined) projects.push(await projectInventory(requestedRoot, directory, marker, effectiveOwner));

    // Directory entries are a declared set for traversal purposes: walk order
    // must be deterministic and locale-independent, not semantically ordered.
    for (const entry of normalizeDeclaredSet(entries, (candidate) => candidate.name)) {
      if (PRUNED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        links.push(await linkInventory(requestedRoot, path));
      } else if (entry.isDirectory()) {
        await walk(path, effectiveOwner, depth + 1);
      }
    }
  }

  await walk(requestedRoot, repositories[0] as RepositoryInventory, 0);
  // Repositories, projects, and links are each a declared set keyed by
  // logicalPath: the inventory's identity must not depend on discovery
  // (walk) order, so each collection is normalized explicitly before it
  // becomes V2 digest input (design.md: V2 preserves array order, unlike V1).
  const sortedRepositories = Object.freeze(normalizeDeclaredSet(repositories, (entry) => entry.logicalPath));
  const sortedProjects = Object.freeze(normalizeDeclaredSet(projects, (entry) => entry.logicalPath));
  const sortedLinks = Object.freeze(normalizeDeclaredSet(links, (entry) => entry.logicalPath));
  const portable = Object.freeze({
    schemaVersion: 1 as const,
    repositories: sortedRepositories,
    projects: sortedProjects,
    links: sortedLinks
  });
  return Object.freeze({ ...portable, fingerprint: buildInventoryFingerprintV2(portable) });
}
