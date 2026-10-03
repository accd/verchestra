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
