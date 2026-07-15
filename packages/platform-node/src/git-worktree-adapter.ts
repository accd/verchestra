import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readlink, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import type { ExecutionWorktreePort } from "@verchestra/application";

const execFileAsync = promisify(execFile);
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const WORKTREE_REF = /^worktree:([a-f0-9]{32}):([a-f0-9]{40}|[a-f0-9]{64})$/u;
const LOGICAL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;

export type GitWorktreeErrorCode =
  | "VES_GIT_WORKTREE_INPUT_INVALID"
  | "VES_GIT_WORKTREE_COMMAND_FAILED"
  | "VES_GIT_WORKTREE_CONFLICT"
  | "VES_GIT_WORKTREE_ESCAPE"
  | "VES_GIT_WORKTREE_NOT_FOUND";

export class GitWorktreeError extends Error {
  readonly code: GitWorktreeErrorCode;

  constructor(code: GitWorktreeErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GitWorktreeError";
    this.code = code;
  }
}

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface NodeGitWorktreeAdapterOptions {
  readonly repositoryRoot: string;
  readonly worktreesRoot: string;
  readonly runGit?: (cwd: string, args: readonly string[]) => Promise<GitResult>;
}

function fail(code: GitWorktreeErrorCode, message: string, options?: ErrorOptions): never {
  throw new GitWorktreeError(code, message, options);
}

function within(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function nulList(value: string): readonly string[] {
  return value
    .split("\0")
    .filter(Boolean)
    .map((entry) => {
      const normalized = entry.replaceAll("\\", "/");
      if (!LOGICAL_PATH.test(normalized)) fail("VES_GIT_WORKTREE_ESCAPE", "Git returned an unsafe logical path");
      return normalized;
    });
}

function worktreeEntries(porcelain: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  let path: string | undefined;
  for (const line of porcelain.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) path = resolve(line.slice("worktree ".length));
    if (path !== undefined && line.startsWith("HEAD ")) {
      entries.set(path, line.slice("HEAD ".length));
      path = undefined;
    }
  }
  return entries;
}

export class NodeGitWorktreeAdapter implements ExecutionWorktreePort {
  readonly #repositoryRoot: string;
  readonly #worktreesRoot: string;
  readonly #runGit: (cwd: string, args: readonly string[]) => Promise<GitResult>;

  constructor(options: NodeGitWorktreeAdapterOptions) {
    if (!isAbsolute(options.repositoryRoot) || !isAbsolute(options.worktreesRoot))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Git worktree roots must be absolute");
    this.#repositoryRoot = resolve(options.repositoryRoot);
    this.#worktreesRoot = resolve(options.worktreesRoot);
    this.#runGit =
      options.runGit ??
      (async (cwd, args) => {
        try {
          return await execFileAsync("git", [...args], {
            cwd,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true
          });
        } catch (error) {
          fail("VES_GIT_WORKTREE_COMMAND_FAILED", "Git worktree command failed", { cause: error });
        }
      });
  }

  async create(input: {
    readonly workspaceId: string;
    readonly runId: string;
    readonly taskId: string;
    readonly sourceStateDigest: `sha256:${string}`;
    readonly sourceRevision: string;
    readonly changeScope: readonly string[];
    readonly protectedPaths: readonly string[];
  }): Promise<{ readonly worktreeRef: string; readonly baseCommit: string }> {
    if (!OBJECT_ID.test(input.sourceRevision))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Source revision must be a complete Git object ID");
    const repositoryRoot = await this.#qualifiedRepositoryRoot();
    const worktreesRoot = await this.#qualifiedWorktreesRoot(repositoryRoot);
    const baseCommit = (
      await this.#git(repositoryRoot, ["rev-parse", "--verify", `${input.sourceRevision}^{commit}`])
    ).stdout.trim();
    if (!OBJECT_ID.test(baseCommit) || baseCommit !== input.sourceRevision)
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Source revision does not resolve exactly");

    const id = createHash("sha256")
      .update(
        JSON.stringify([
          input.workspaceId,
          input.runId,
          input.taskId,
          input.sourceStateDigest,
          input.sourceRevision,
          [...input.changeScope],
          [...input.protectedPaths]
        ])
      )
      .digest("hex")
      .slice(0, 32);
    const worktreeRef = `worktree:${id}:${baseCommit}` as const;
    const target = join(worktreesRoot, id);
    if (!within(worktreesRoot, target)) fail("VES_GIT_WORKTREE_ESCAPE", "Derived worktree escaped its protected root");

    const entries = worktreeEntries((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (entries.has(target)) {
      await this.#assertExistingTarget(target, worktreesRoot);
      if (entries.get(target) !== baseCommit)
        fail("VES_GIT_WORKTREE_CONFLICT", "Existing worktree is bound to another revision");
      return Object.freeze({ worktreeRef, baseCommit });
    }
    try {
      await lstat(target);
      fail("VES_GIT_WORKTREE_CONFLICT", "Worktree target already exists outside Git ownership");
    } catch (error) {
      if (error instanceof GitWorktreeError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.#git(repositoryRoot, ["worktree", "add", "--detach", "--", target, baseCommit]);
    await this.#assertExistingTarget(target, worktreesRoot);
    return Object.freeze({ worktreeRef, baseCommit });
  }

  async inspect(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<{
    readonly changedPaths: readonly string[];
    readonly changeDigest: string;
    readonly commitCountSinceBase: number;
  }> {
    const { target } = await this.#resolveHandle(handle);
    const tracked = nulList((await this.#git(target, ["diff", "--name-only", "-z", handle.baseCommit, "--"])).stdout);
    const untracked = nulList((await this.#git(target, ["ls-files", "--others", "--exclude-standard", "-z"])).stdout);
    const changedPaths = Object.freeze([...new Set([...tracked, ...untracked])].sort());
    const manifest: Array<readonly [string, string]> = [];
    for (const path of changedPaths) {
      try {
        const candidate = join(target, ...path.split("/"));
        const metadata = await lstat(candidate);
        if (metadata.isSymbolicLink()) {
          const linkTarget = await readlink(candidate, "buffer");
          manifest.push([path, `symlink:${createHash("sha256").update(linkTarget).digest("hex")}`]);
        } else if (metadata.isFile()) {
          const contents = await readFile(candidate);
          manifest.push([path, createHash("sha256").update(contents).digest("hex")]);
        } else {
          fail("VES_GIT_WORKTREE_ESCAPE", "Changed path is not a regular file or symbolic link");
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        manifest.push([path, "deleted"]);
      }
    }
    const commitCountText = (
      await this.#git(target, ["rev-list", "--count", `${handle.baseCommit}..HEAD`])
    ).stdout.trim();
    if (!/^[0-9]+$/u.test(commitCountText))
      fail("VES_GIT_WORKTREE_COMMAND_FAILED", "Git returned an invalid commit count");
    return Object.freeze({
      changedPaths,
      changeDigest: `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`,
      commitCountSinceBase: Number.parseInt(commitCountText, 10)
    });
  }

  async cleanup(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<void> {
    const repositoryRoot = await this.#qualifiedRepositoryRoot();
    const worktreesRoot = await this.#qualifiedWorktreesRoot(repositoryRoot);
    const target = this.#targetFromRef(handle.worktreeRef, worktreesRoot, handle.baseCommit);
    const entries = worktreeEntries((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (!entries.has(target)) return;
    await this.#assertExistingTarget(target, worktreesRoot);
    await this.#git(repositoryRoot, ["worktree", "remove", "--force", "--", target]);
    await this.#git(repositoryRoot, ["worktree", "prune"]);
  }

  async #resolveHandle(handle: {
    readonly worktreeRef: string;
    readonly baseCommit: string;
  }): Promise<{ target: string }> {
    if (!OBJECT_ID.test(handle.baseCommit)) fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree base commit is invalid");
    const repositoryRoot = await this.#qualifiedRepositoryRoot();
    const worktreesRoot = await this.#qualifiedWorktreesRoot(repositoryRoot);
    const target = this.#targetFromRef(handle.worktreeRef, worktreesRoot, handle.baseCommit);
    const entries = worktreeEntries((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (!entries.has(target)) fail("VES_GIT_WORKTREE_NOT_FOUND", "Worktree handle is not registered by Git");
    await this.#assertExistingTarget(target, worktreesRoot);
    return { target };
  }

  #targetFromRef(worktreeRef: string, worktreesRoot: string, expectedBaseCommit: string): string {
    const match = WORKTREE_REF.exec(worktreeRef);
    if (match?.[1] === undefined || match[2] !== expectedBaseCommit)
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree reference is invalid");
    const target = join(worktreesRoot, match[1]);
    if (!within(worktreesRoot, target))
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree reference escaped its protected root");
    return target;
  }

  async #qualifiedRepositoryRoot(): Promise<string> {
    let root: string;
    try {
      root = await realpath(this.#repositoryRoot);
    } catch (error) {
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Repository root does not exist", { cause: error });
    }
    if (relative(this.#repositoryRoot, root) !== "")
      fail("VES_GIT_WORKTREE_ESCAPE", "Repository root resolves through a symbolic path");
    const bare = (await this.#git(root, ["rev-parse", "--is-bare-repository"])).stdout.trim();
    if (bare !== "false") fail("VES_GIT_WORKTREE_INPUT_INVALID", "Repository root is not a non-bare Git repository");
    return root;
  }

  async #qualifiedWorktreesRoot(repositoryRoot: string): Promise<string> {
    await mkdir(this.#worktreesRoot, { recursive: true });
    const metadata = await lstat(this.#worktreesRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree root is not a real directory");
    const root = await realpath(this.#worktreesRoot);
    if (relative(this.#worktreesRoot, root) !== "")
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree root resolves through a symbolic path");
    if (root === repositoryRoot) fail("VES_GIT_WORKTREE_ESCAPE", "Worktree root cannot equal repository root");
    return root;
  }

  async #assertExistingTarget(target: string, root: string): Promise<void> {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree target is not a real directory");
    const actual = await realpath(target);
    if (relative(target, actual) !== "" || !within(root, actual))
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree target escaped its protected root");
  }

  async #git(cwd: string, args: readonly string[]): Promise<GitResult> {
    try {
      return await this.#runGit(cwd, args);
    } catch (error) {
      if (error instanceof GitWorktreeError) throw error;
      fail("VES_GIT_WORKTREE_COMMAND_FAILED", "Git worktree command failed", { cause: error });
    }
  }
}
