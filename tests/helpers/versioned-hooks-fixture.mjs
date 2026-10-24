// invariant: a repository whose hooks are versioned content, the way husky
// keeps them: `.githooks/` is committed and `core.hooksPath` names it, so a
// worktree checked out from it carries the hooks, and a model writing in that
// worktree can change them. Each hook leaves a sentinel file named after
// itself when it runs.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const SENTINEL_HOOKS = Object.freeze(["post-checkout", "post-commit", "reference-transaction"]);

// why: hooks run under Git's own sh on every platform, which reads a path with
// forward slashes on Windows too.
const shellPath = (path) => path.replaceAll("\\", "/");

export async function versionHooks(repositoryRoot, sentinelRoot, git) {
  await mkdir(join(repositoryRoot, ".githooks"), { recursive: true });
  await mkdir(sentinelRoot, { recursive: true });
  for (const hook of SENTINEL_HOOKS) {
    await writeFile(
      join(repositoryRoot, ".githooks", hook),
      `#!/bin/sh\necho ran > "${shellPath(join(sentinelRoot, hook))}"\n`,
      { mode: 0o755 }
    );
  }
  git(repositoryRoot, "add", ".githooks");
  git(repositoryRoot, "commit", "--quiet", "-m", "version the hooks");
  git(repositoryRoot, "config", "core.hooksPath", ".githooks");
  return git(repositoryRoot, "rev-parse", "HEAD");
}

export async function ranHooks(sentinelRoot) {
  return (await readdir(sentinelRoot)).sort();
}
