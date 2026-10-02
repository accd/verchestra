// invariant: a disposable Git repository in a named object format, created
// with the fixed system git. The SHA-256 cases exist to prove that no task
// worktree operation assumes a 40-digit object ID, so a repository that is not
// in the requested format must fail the test instead of passing as SHA-1.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { systemGit } from "./system-git.mjs";

export const OBJECT_FORMATS = Object.freeze([
  Object.freeze({ objectFormat: "sha1", objectIdLength: 40 }),
  Object.freeze({ objectFormat: "sha256", objectIdLength: 64 })
]);

const roots = [];

export function git(cwd, ...args) {
  return execFileSync(systemGit(), args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function initialize(repositoryRoot, objectFormat) {
  try {
    git(repositoryRoot, "init", "--quiet", `--object-format=${objectFormat}`, "-b", "main");
  } catch (error) {
    assert.fail(
      `the installed git (${git(repositoryRoot, "--version")}) cannot create a ${objectFormat} repository; ` +
        `git 2.29 or newer is required and this test does not pass without it: ${String(error.stderr ?? error)}`
    );
  }
  assert.equal(
    git(repositoryRoot, "rev-parse", "--show-object-format"),
    objectFormat,
    `the fixture repository is not in the ${objectFormat} object format`
  );
}

export async function objectFormatRepository({ objectFormat, objectIdLength }) {
  const root = await mkdtemp(join(tmpdir(), `verchestra-git-${objectFormat}-`));
  roots.push(root);
  const repositoryRoot = join(root, "repository");
  await mkdir(join(repositoryRoot, "src"), { recursive: true });
  await writeFile(join(repositoryRoot, "src", "value.txt"), "base\n");
  initialize(repositoryRoot, objectFormat);
  // why: a Windows runner converts LF to CRLF on checkout by default, so the
  // worktree would not hold the committed bytes the assertions compare.
  git(repositoryRoot, "config", "core.autocrlf", "false");
  git(repositoryRoot, "config", "user.email", "qualification@verchestra.invalid");
  git(repositoryRoot, "config", "user.name", "Verchestra Qualification");
  git(repositoryRoot, "config", "commit.gpgsign", "false");
  git(repositoryRoot, "add", ".");
  git(repositoryRoot, "commit", "--quiet", "-m", "base");
  const baseCommit = git(repositoryRoot, "rev-parse", "HEAD");
  assert.equal(baseCommit.length, objectIdLength, `a ${objectFormat} commit ID has ${objectIdLength} digits`);
  return { root, repositoryRoot, worktreesRoot: join(root, "worktrees"), baseCommit };
}

export async function cleanupObjectFormatRepositories() {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
}
