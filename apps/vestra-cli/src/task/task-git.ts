import { rm } from "node:fs/promises";

import { runGit, runGitBytes } from "@verchestra/platform-node";

// invariant: every git call the task composition makes itself goes through
// the task worktree module's one runner: an argument vector (never a shell), a
// bounded buffer, and the repository as the working directory.
export async function git(cwd: string, args: readonly string[]): Promise<string> {
  return (await runGit(cwd, args)).stdout;
}

export async function gitBuffer(cwd: string, args: readonly string[], maxBuffer: number): Promise<Buffer> {
  return runGitBytes(cwd, args, maxBuffer);
}

// why: the scratch worktrees verification uses are registered in the user's
// repository like task worktrees, so they are removed the same way and never
// left behind as stray checkouts.
// hazard: callers pass only paths under the Workspace's own verification
// root; this deletes the directory.
export async function removeWorktree(repositoryRoot: string, path: string): Promise<void> {
  await git(repositoryRoot, ["worktree", "remove", "--force", "--", path]).catch(() => undefined);
  await rm(path, { recursive: true, force: true, maxRetries: 3 });
  await git(repositoryRoot, ["worktree", "prune"]).catch(() => undefined);
}

export async function addDetachedWorktree(repositoryRoot: string, path: string, commitId: string): Promise<void> {
  await removeWorktree(repositoryRoot, path);
  await git(repositoryRoot, ["worktree", "add", "--detach", "--", path, commitId]);
}
