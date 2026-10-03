import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readlink, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ExecutionWorktreePort } from "@verchestra/application";
import { isTaskPath } from "@verchestra/domain";

import {
  encodeWorktreeHandle,
  isGitObjectId,
  isTaskBranchComponent,
  parseTaskCommitTrailers,
  parseWorktreeHandle,
  refTarget,
  registeredWorktrees,
  runGit,
  taskBranchRef,
  type GitOutput,
  type GitRunner
} from "./task-worktree.ts";

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

export interface NodeGitWorktreeAdapterOptions {
  readonly repositoryRoot: string;
  readonly worktreesRoot: string;
  readonly runGit?: GitRunner;
  // why: the gate commit lives only in the detached worktree; removing the
  // worktree leaves it unreachable. When enabled, cleanup first anchors it on
  // refs/heads/vestra/<runId>/<taskId>. Off by default for existing callers.
  readonly anchorTaskCommits?: boolean;
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
      if (!isTaskPath(normalized)) fail("VES_GIT_WORKTREE_ESCAPE", "Git returned an unsafe logical path");
      return normalized;
    });
}

function handleFor(id: string, baseCommit: string): string {
  return (
    encodeWorktreeHandle({ id, baseCommit }) ??
    fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree handle cannot be encoded")
  );
}

// why: verification registers its own scratch checkout of a commit under a root
// it owns and runs gates there. The gate runner accepts only a handle, so the
// owner of the encoding issues one for the checkout directory named `id`.
export function scratchWorktreeHandle(checkout: { readonly id: string; readonly commitId: string }): string {
  return handleFor(checkout.id, checkout.commitId);
}

export class NodeGitWorktreeAdapter implements ExecutionWorktreePort {
  readonly #repositoryRoot: string;
  readonly #worktreesRoot: string;
  readonly #runGit: GitRunner;
  readonly #anchorTaskCommits: boolean;

  constructor(options: NodeGitWorktreeAdapterOptions) {
    if (!isAbsolute(options.repositoryRoot) || !isAbsolute(options.worktreesRoot))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Git worktree roots must be absolute");
    this.#repositoryRoot = resolve(options.repositoryRoot);
    this.#worktreesRoot = resolve(options.worktreesRoot);
    this.#anchorTaskCommits = options.anchorTaskCommits === true;
    this.#runGit = options.runGit ?? runGit;
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
    if (!isGitObjectId(input.sourceRevision))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Source revision must be a complete Git object ID");
    await this.#assertAnchorable(input.runId, input.taskId);
    const repositoryRoot = await this.#qualifiedRepositoryRoot();
    const worktreesRoot = await this.#qualifiedWorktreesRoot(repositoryRoot);
    const baseCommit = (
      await this.#git(repositoryRoot, ["rev-parse", "--verify", `${input.sourceRevision}^{commit}`])
    ).stdout.trim();
    if (!isGitObjectId(baseCommit) || baseCommit !== input.sourceRevision)
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
    const worktreeRef = handleFor(id, baseCommit);
    const target = join(worktreesRoot, id);
    if (!within(worktreesRoot, target)) fail("VES_GIT_WORKTREE_ESCAPE", "Derived worktree escaped its protected root");

    const entries = registeredWorktrees((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
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
    const entries = registeredWorktrees((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (!entries.has(target)) return;
    await this.#assertRegisteredTarget(target, worktreesRoot);
    if (this.#anchorTaskCommits) await this.#anchorTaskCommit(repositoryRoot, target, handle.baseCommit);
    await this.#git(repositoryRoot, ["worktree", "remove", "--force", "--", target]);
    await this.#git(repositoryRoot, ["worktree", "prune"]);
  }

  // why: a caller that kept only the handle (a durable marker of an idle run)
  // cleans up without taking the handle apart to find its base commit.
  async cleanupHandle(worktreeRef: string): Promise<void> {
    const baseCommit = parseWorktreeHandle(worktreeRef)?.baseCommit;
    if (baseCommit === undefined) fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree reference is invalid");
    await this.cleanup({ worktreeRef, baseCommit });
  }

  // why: after a crash between the task commit and its record, the commit ID is
  // the only durable fact; the worktree that holds it is found by its
  // registered HEAD and cleaned up (anchoring the commit first when enabled).
  // invariant: the root compared against Git's listing is the canonical one, so
  // a state root reached through a link still finds its worktree.
  async cleanupAtCommit(commit: { readonly commitId: string; readonly baseCommit: string }): Promise<boolean> {
    if (!isGitObjectId(commit.commitId) || !isGitObjectId(commit.baseCommit))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Commit and base must be complete Git object IDs");
    const repositoryRoot = await this.#qualifiedRepositoryRoot();
    const worktreesRoot = await this.#qualifiedWorktreesRoot(repositoryRoot);
    const entries = registeredWorktrees((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    for (const [path, head] of entries) {
      const worktreeRef = encodeWorktreeHandle({ id: basename(path), baseCommit: commit.baseCommit });
      if (head !== commit.commitId || dirname(path) !== worktreesRoot || worktreeRef === undefined) continue;
      await this.cleanup({ worktreeRef, baseCommit: commit.baseCommit });
      return true;
    }
    return false;
  }

  // The real, Git-registered directory behind a worktree handle, for adapters
  // that must confine their own effects to it.
  async resolvePath(worktreeRef: string): Promise<string> {
    const baseCommit = parseWorktreeHandle(worktreeRef)?.baseCommit;
    if (baseCommit === undefined) fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree reference is invalid");
    return (await this.#resolveHandle({ worktreeRef, baseCommit })).target;
  }

  async #assertAnchorable(runId: string, taskId: string): Promise<void> {
    if (!this.#anchorTaskCommits) return;
    if (!isTaskBranchComponent(runId) || !isTaskBranchComponent(taskId))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Run and task IDs must be valid task-branch components");
    await this.#git(this.#repositoryRoot, ["check-ref-format", taskBranchRef(runId, taskId)]);
  }

  // Anchors the one verified task commit before its worktree is removed. Any
  // other history keeps the worktree in place: losing an unexplained commit is
  // worse than leaving a directory for reconciliation.
  async #anchorTaskCommit(repositoryRoot: string, target: string, baseCommit: string): Promise<void> {
    const head = (await this.#git(target, ["rev-parse", "HEAD"])).stdout.trim();
    if (head === baseCommit) return;
    const ref = await this.#verifiedTaskBranch(target, head, baseCommit);
    const current = await this.#refTarget(repositoryRoot, ref);
    if (current !== undefined && current !== head)
      fail("VES_GIT_WORKTREE_CONFLICT", "Task branch already points at another commit");
    if (current === undefined)
      await this.#git(repositoryRoot, [
        "update-ref",
        "-m",
        "verchestra: anchor task commit",
        ref,
        head,
        "0".repeat(head.length)
      ]);
    if ((await this.#refTarget(repositoryRoot, ref)) !== head)
      fail("VES_GIT_WORKTREE_CONFLICT", "Task branch was not anchored on the task commit");
  }

  // The task branch named by a single commit on the base whose trailers are
  // the ones NodeAtomicGitCommitAdapter writes; anything else is refused.
  async #verifiedTaskBranch(target: string, head: string, baseCommit: string): Promise<string> {
    const lineage = (await this.#git(target, ["rev-list", "--parents", "-n", "1", "HEAD"])).stdout.trim().split(/\s+/u);
    if (lineage.length !== 2 || lineage[0] !== head || lineage[1] !== baseCommit || !isGitObjectId(head))
      fail("VES_GIT_WORKTREE_CONFLICT", "Worktree history is not a single task commit on its base");
    const { runId, taskId, idempotencyKey } = parseTaskCommitTrailers(
      (await this.#git(target, ["show", "-s", "--format=%B", "HEAD"])).stdout
    );
    const verified =
      /^sha256:[a-f0-9]{64}$/u.test(idempotencyKey) && isTaskBranchComponent(runId) && isTaskBranchComponent(taskId);
    if (!verified) fail("VES_GIT_WORKTREE_CONFLICT", "Worktree commit is not a verified task commit");
    return taskBranchRef(runId, taskId);
  }

  #refTarget(repositoryRoot: string, ref: string): Promise<string | undefined> {
    return refTarget(repositoryRoot, ref, (cwd, args) => this.#git(cwd, args));
  }

  async #resolveHandle(handle: {
    readonly worktreeRef: string;
    readonly baseCommit: string;
  }): Promise<{ target: string }> {
    if (!isGitObjectId(handle.baseCommit)) fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree base commit is invalid");
    const repositoryRoot = await this.#qualifiedRepositoryRoot();
    const worktreesRoot = await this.#qualifiedWorktreesRoot(repositoryRoot);
    const target = this.#targetFromRef(handle.worktreeRef, worktreesRoot, handle.baseCommit);
    const entries = registeredWorktrees((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (!entries.has(target)) fail("VES_GIT_WORKTREE_NOT_FOUND", "Worktree handle is not registered by Git");
    await this.#assertExistingTarget(target, worktreesRoot);
    return { target };
  }

  #targetFromRef(worktreeRef: string, worktreesRoot: string, expectedBaseCommit: string): string {
    const handle = parseWorktreeHandle(worktreeRef);
    if (handle?.baseCommit !== expectedBaseCommit)
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree reference is invalid");
    const target = join(worktreesRoot, handle.id);
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
    // Canonicalize rather than reject. A configured root legitimately reaches its
    // real location through platform path aliases: macOS temp dirs resolve
    // /var -> /private/var, and Windows hands back 8.3 short names such as
    // RUNNER~1 -> runneradmin. realpath resolves those to the real directory, and
    // every downstream guard (the non-bare check below, and worktree containment
    // in #assertExistingTarget) runs against this canonical root, so a benign
    // alias is safe while a symlink pointing at a non-repository is still caught.
    const bare = (await this.#git(root, ["rev-parse", "--is-bare-repository"])).stdout.trim();
    if (bare !== "false") fail("VES_GIT_WORKTREE_INPUT_INVALID", "Repository root is not a non-bare Git repository");
    return root;
  }

  async #qualifiedWorktreesRoot(repositoryRoot: string): Promise<string> {
    await mkdir(this.#worktreesRoot, { recursive: true });
    const metadata = await lstat(this.#worktreesRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree root is not a real directory");
    // Same canonicalization as the repository root: the lstat above already
    // refused a worktree root whose own final component is a link, so realpath
    // here only collapses benign parent aliases (/private, RUNNER~1). All
    // containment checks downstream use this canonical root.
    const root = await realpath(this.#worktreesRoot);
    if (root === repositoryRoot) fail("VES_GIT_WORKTREE_ESCAPE", "Worktree root cannot equal repository root");
    return root;
  }

  // why: Git keeps listing a worktree whose directory was deleted by hand.
  // Nothing is left there to anchor or remove, and a caller can tell that
  // apart from a refusal by its code.
  async #assertRegisteredTarget(target: string, root: string): Promise<void> {
    try {
      await this.#assertExistingTarget(target, root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      fail("VES_GIT_WORKTREE_NOT_FOUND", "Registered worktree directory no longer exists", { cause: error });
    }
  }

  async #assertExistingTarget(target: string, root: string): Promise<void> {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink() || !metadata.isDirectory())
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree target is not a real directory");
    const actual = await realpath(target);
    if (relative(target, actual) !== "" || !within(root, actual))
      fail("VES_GIT_WORKTREE_ESCAPE", "Worktree target escaped its protected root");
  }

  async #git(cwd: string, args: readonly string[]): Promise<GitOutput> {
    try {
      return await this.#runGit(cwd, args);
    } catch (error) {
      if (error instanceof GitWorktreeError) throw error;
      fail("VES_GIT_WORKTREE_COMMAND_FAILED", "Git worktree command failed", { cause: error });
    }
  }
}
