import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// invariant: every git call the task composition makes itself goes through
// here: an argument vector (never a shell), a bounded buffer, and the
// repository as the working directory.
export async function git(cwd: string, args: readonly string[], maxBuffer = 16 * 1024 * 1024): Promise<string> {
  return (await execFileAsync("git", [...args], { cwd, encoding: "utf8", maxBuffer, windowsHide: true })).stdout;
}

export async function gitBuffer(cwd: string, args: readonly string[], maxBuffer: number): Promise<Buffer> {
  return (await execFileAsync("git", [...args], { cwd, encoding: "buffer", maxBuffer, windowsHide: true })).stdout;
}

export async function refTarget(repositoryRoot: string, ref: string): Promise<string | undefined> {
  const listed = await git(repositoryRoot, ["for-each-ref", "--format=%(refname) %(objectname)", ref]);
  for (const line of listed.split(/\r?\n/u)) {
    const [name, objectId] = line.split(" ");
    if (name === ref) return objectId;
  }
  return undefined;
}

export function taskBranch(runId: string, taskId: string): string {
  return `refs/heads/vestra/${runId}/${taskId}`;
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
