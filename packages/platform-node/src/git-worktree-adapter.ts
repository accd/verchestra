import { createHash } from "node:crypto";
import { lstat, readFile, readlink, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import type { ExecutionWorktreePort } from "@verchestra/application";
import { isTaskPath } from "@verchestra/domain";

import {
  assertWorktreeDirectory,
  encodeWorktreeHandle,
  isGitObjectId,
  isTaskBranchComponent,
  parseTaskCommitTrailers,
  parseWorktreeHandle,
  qualifiedWorktreeRoots,
  refTarget,
  registeredWorktrees,
  resolveWorktreeHandle,
  runGit,
  taskBranchRef,
  worktreeDirectory,
  WorktreeRefusalError,
  type GitOutput,
  type GitRunner,
  type ResolvedWorktree,
  type WorktreeRefusal,
  type WorktreeRoots,
  worktreeDirectoryFits
} from "./task-worktree.ts";

export type GitWorktreeErrorCode =
  | "VES_GIT_WORKTREE_INPUT_INVALID"
  | "VES_GIT_WORKTREE_COMMAND_FAILED"
  | "VES_GIT_WORKTREE_CONFLICT"
  | "VES_GIT_WORKTREE_ESCAPE"
  | "VES_GIT_WORKTREE_NOT_FOUND"
  | "VES_GIT_WORKTREE_PATH_TOO_LONG";

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

// invariant: the worktree module decides; this adapter answers each refusal
// with the code its callers have always read.
const REFUSAL_CODES: Readonly<Record<WorktreeRefusal, GitWorktreeErrorCode>> = Object.freeze({
  handle: "VES_GIT_WORKTREE_INPUT_INVALID",
  repository: "VES_GIT_WORKTREE_INPUT_INVALID",
  root: "VES_GIT_WORKTREE_ESCAPE",
  escape: "VES_GIT_WORKTREE_ESCAPE",
  unregistered: "VES_GIT_WORKTREE_NOT_FOUND",
  missing: "VES_GIT_WORKTREE_NOT_FOUND"
});

function answer(error: unknown): never {
  if (error instanceof WorktreeRefusalError) fail(REFUSAL_CODES[error.refusal], error.message, { cause: error });
  throw error;
}

async function answered<T>(operation: () => T | Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    answer(error);
  }
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

// why: Git would die mid-checkout on a directory past its GIT_DIR limit;
// refusing first names the cause and leaves nothing half-added.
function requireFits(directory: string): void {
  if (!worktreeDirectoryFits(directory))
    fail("VES_GIT_WORKTREE_PATH_TOO_LONG", "Worktree directory is too long for Git on this platform");
}

function handleFor(id: string, baseCommit: string): string {
  return (
    encodeWorktreeHandle({ id, baseCommit }) ??
    fail("VES_GIT_WORKTREE_INPUT_INVALID", "Worktree handle cannot be encoded")
  );
}

export interface ScratchCheckout {
  // invariant: a real directory directly below the adapter's canonical root.
  readonly directory: string;
  // why: the gate runner accepts only a handle; the owner of the encoding
  // issues it for the checkout, so no caller knows how a handle names one.
  readonly worktreeRef: string;
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class NodeGitWorktreeAdapter implements ExecutionWorktreePort {
  readonly #repositoryRoot: string;
  readonly #worktreesRoot: string;
  readonly #runGit: GitRunner;
  readonly #anchorTaskCommits: boolean;
  readonly #gitRunner: GitRunner = (cwd, args) => this.#git(cwd, args);

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
    const { repositoryRoot, worktreesRoot } = await this.#qualifiedRoots();
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
    const target = await answered(() => worktreeDirectory(worktreesRoot, id));

    const entries = registeredWorktrees((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (entries.has(target)) {
      await answered(() => assertWorktreeDirectory(target, worktreesRoot));
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
    requireFits(target);
    await this.#git(repositoryRoot, ["worktree", "add", "--detach", "--", target, baseCommit]);
    await answered(() => assertWorktreeDirectory(target, worktreesRoot));
    return Object.freeze({ worktreeRef, baseCommit });
  }

  async inspect(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<{
    readonly changedPaths: readonly string[];
    readonly changeDigest: string;
    readonly commitCountSinceBase: number;
  }> {
    const target = (await this.#resolve(handle.worktreeRef, handle.baseCommit)).directory;
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

  // invariant: a handle Git no longer lists is already cleaned up; a listed
  // worktree whose directory is gone is VES_GIT_WORKTREE_NOT_FOUND.
  async cleanup(handle: { readonly worktreeRef: string; readonly baseCommit: string }): Promise<void> {
    let resolved: ResolvedWorktree;
    try {
      resolved = await resolveWorktreeHandle(this.#roots(), handle.worktreeRef, {
        baseCommit: handle.baseCommit,
        git: this.#gitRunner
      });
    } catch (error) {
      if (error instanceof WorktreeRefusalError && error.refusal === "unregistered") return;
      answer(error);
    }
    const { repositoryRoot, directory } = resolved;
    if (this.#anchorTaskCommits) await this.#anchorTaskCommit(repositoryRoot, directory, handle.baseCommit);
    await this.#git(repositoryRoot, ["worktree", "remove", "--force", "--", directory]);
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
    const { repositoryRoot, worktreesRoot } = await this.#qualifiedRoots();
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
    return (await this.#resolve(worktreeRef)).directory;
  }

  // why: verification checks a commit out where the user's checkout cannot
  // see it, changes it, and runs gates there. The name only has to be stable
  // for one checkout: one a killed verification left under the same name is
  // replaced, never reused.
  // invariant: the checkout is removed whether `use` succeeds or fails, and a
  // removal that leaves it behind is reported. When both fail, the removal is
  // what is reported: a verification can be run again, while a checkout left
  // registered in the user's repository needs a person.
  async withScratchCheckout<T>(
    checkout: { readonly name: string; readonly commitId: string },
    use: (checkout: ScratchCheckout) => Promise<T>
  ): Promise<T> {
    if (!isGitObjectId(checkout.commitId))
      fail("VES_GIT_WORKTREE_INPUT_INVALID", "Scratch commit must be a complete Git object ID");
    const roots = await this.#qualifiedRoots();
    const id = createHash("sha256").update(checkout.name).digest("hex").slice(0, 32);
    const directory = await answered(() => worktreeDirectory(roots.worktreesRoot, id));
    requireFits(directory);
    await this.#removeScratch(roots.repositoryRoot, directory);
    try {
      await this.#git(roots.repositoryRoot, ["worktree", "add", "--detach", "--", directory, checkout.commitId]);
      await answered(() => assertWorktreeDirectory(directory, roots.worktreesRoot));
      return await use(Object.freeze({ directory, worktreeRef: handleFor(id, checkout.commitId) }));
    } finally {
      await this.#removeScratch(roots.repositoryRoot, directory);
    }
  }

  // invariant: when this returns, neither the scratch directory nor Git's
  // registration of it remains; anything left behind is a refusal.
  // hazard: a link in the checkout's place is refused before the recursive
  // delete could follow it out of the scratch root.
  async #removeScratch(repositoryRoot: string, directory: string): Promise<void> {
    if (await isLink(directory)) fail("VES_GIT_WORKTREE_ESCAPE", "Worktree target is not a real directory");
    let removal: unknown;
    // why: Git refuses a directory it does not list, and on Windows a file a
    // gate process still holds open; the delete below retries, so only what
    // remains afterwards is a failure.
    await this.#git(repositoryRoot, ["worktree", "remove", "--force", "--", directory]).catch((error: unknown) => {
      removal = error;
    });
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
    await this.#git(repositoryRoot, ["worktree", "prune"]);
    const listed = registeredWorktrees((await this.#git(repositoryRoot, ["worktree", "list", "--porcelain"])).stdout);
    if (listed.has(directory))
      fail("VES_GIT_WORKTREE_COMMAND_FAILED", "Scratch checkout is still registered after its removal", {
        cause: removal
      });
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
    return refTarget(repositoryRoot, ref, this.#gitRunner);
  }

  #roots(): WorktreeRoots {
    return { repositoryRoot: this.#repositoryRoot, worktreesRoot: this.#worktreesRoot };
  }

  #qualifiedRoots(): Promise<WorktreeRoots> {
    return answered(() => qualifiedWorktreeRoots(this.#roots(), this.#gitRunner));
  }

  #resolve(worktreeRef: string, baseCommit?: string): Promise<ResolvedWorktree> {
    return answered(() =>
      resolveWorktreeHandle(this.#roots(), worktreeRef, {
        ...(baseCommit === undefined ? {} : { baseCommit }),
        git: this.#gitRunner
      })
    );
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
