// A sealed replica of the current repository state, for tests that drive the
// real T76 candidate builder (scripts/t76-build-candidate.mjs).
//
// The builder refuses to bundle from anything but a clean tree at the exact
// sealed revision (VES_T76_BUILD_TREE_DIRTY), because the launcher bundles
// are compiled from the working tree. A development checkout mid-change can
// never satisfy that, and committing in the developer's repository from a
// test would be destructive - so tests seal what the developer is actually
// working on: every tracked and untracked-but-not-ignored file of the current
// tree is copied into a fresh repository and committed there with a fixed
// identity and timestamp. The replica's single commit IS the sealed revision,
// so the builder's clean-tree guarantee holds by construction while the
// bundle still contains the real, current sources under test.
//
// Module resolution inside the replica is self-contained: `node_modules/`
// links point each workspace package name at the replica's own copy, and the
// three third-party names the CLI graph imports (ajv, jose, canonicalize) at
// the exact lockfile-installed store directories of the host repository.
// Directory junctions are used so no Windows privilege is required, and
// `node_modules/` is git-ignored by the replica's own copied .gitignore, so
// the links never dirty its status.

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const THIRD_PARTY_ANCHORS = Object.freeze({
  ajv: "packages/contracts",
  canonicalize: "packages/evidence",
  jose: "packages/evidence"
});
const FIXED_INSTANT = "2026-08-26T00:00:00Z";

// The same hermetic-Git discipline as packages/self-test/src/git-fixtures.ts:
// no system or operator config can reach the replica, so no ambient hook,
// template, or signing setting can alter or observe it.
const hermeticGitEnv = (home) => ({
  ...process.env,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(home, "gitconfig-sealed-empty"),
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_ASKPASS: "",
  GIT_AUTHOR_DATE: FIXED_INSTANT,
  GIT_COMMITTER_DATE: FIXED_INSTANT
});

const git = (repository, env, args) =>
  execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", windowsHide: true, env });

function currentTreeFiles() {
  return execFileSync("git", ["-C", REPOSITORY_ROOT, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    encoding: "utf8",
    windowsHide: true
  })
    .split("\0")
    .filter((path) => path.length > 0 && !path.startsWith(".tmp-"))
    .sort();
}

async function copyTree(replica, files) {
  for (const path of files) {
    const source = join(REPOSITORY_ROOT, ...path.split("/"));
    const target = join(replica, ...path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    // A file deleted from the working tree can still be listed by the index;
    // the replica seals the working tree, so it is simply absent.
    await copyFile(source, target).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function linkWorkspacePackages(replica) {
  const scopeRoot = join(replica, "node_modules", "@verchestra");
  await mkdir(scopeRoot, { recursive: true });
  for (const entry of await readdir(join(replica, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(replica, "packages", entry.name, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8").catch(() => "null"));
    if (typeof manifest?.name !== "string" || !manifest.name.startsWith("@verchestra/")) continue;
    await symlink(
      join(replica, "packages", entry.name),
      join(scopeRoot, manifest.name.slice("@verchestra/".length)),
      "junction"
    );
  }
}

// Each third-party name links to the lockfile-installed store directory the
// anchor workspace package genuinely resolves it from (pnpm materializes that
// as `<anchor>/node_modules/<name>`). The link target is the store's real
// directory, so the package's own relative imports resolve against its true
// store siblings.
async function linkThirdPartyPackages(replica) {
  for (const [name, anchor] of Object.entries(THIRD_PARTY_ANCHORS)) {
    const root = await realpath(join(REPOSITORY_ROOT, ...anchor.split("/"), "node_modules", name));
    await symlink(root, join(replica, "node_modules", name), "junction");
  }
}

/**
 * Seals the current repository state into a fresh single-commit replica.
 * Returns its root, its HEAD revision, and a disposer.
 */
export async function createSealedRepositoryReplica() {
  const parent = await mkdtemp(join(tmpdir(), "verchestra-sealed-replica-"));
  const repository = join(parent, "replica");
  const env = hermeticGitEnv(parent);
  await mkdir(repository);
  try {
    await copyTree(repository, currentTreeFiles());
    git(repository, env, ["init", "--quiet", "--initial-branch", "sealed"]);
    git(repository, env, ["config", "user.name", "Verchestra Sealed Fixture"]);
    git(repository, env, ["config", "user.email", "sealed-fixture@invalid.example"]);
    git(repository, env, ["add", "--all"]);
    git(repository, env, ["commit", "--quiet", "--message", "sealed replica"]);
    await linkWorkspacePackages(repository);
    await linkThirdPartyPackages(repository);
    const revision = git(repository, env, ["rev-parse", "HEAD"]).trim();
    return {
      repository,
      revision,
      dispose: () => rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    };
  } catch (error) {
    await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    throw error;
  }
}
