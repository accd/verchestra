import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

export const scannerRoots = [];

export async function scannerRoot(prefix = "verchestra-workspace-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  scannerRoots.push(root);
  return root;
}

export function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

export async function initRepository(root, files = { "package.json": '{"name":"fixture","private":true}\n' }) {
  await mkdir(root, { recursive: true });
  git(root, "init", "--quiet", "--initial-branch=main");
  git(root, "config", "user.name", "Verchestra Fixture");
  git(root, "config", "user.email", "fixture@invalid.example");
  for (const [path, content] of Object.entries(files)) {
    const destination = join(root, ...path.split("/"));
    await mkdir(join(destination, ".."), { recursive: true });
    await writeFile(destination, content);
  }
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}

async function filesUnder(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else files.push(path);
  }
  return files;
}

export async function byteSnapshot(root) {
  const entries = [];
  for (const path of await filesUnder(root)) {
    const relativePath = relative(root, path).replaceAll("\\", "/");
    // Git may create and remove this lock while a fixture snapshot walks the
    // repository. It is maintenance state, not user-controlled repository
    // content, so including it would make an otherwise deterministic snapshot
    // race with Git's background maintenance.
    if (relativePath === ".git/objects/maintenance.lock") continue;
    const bytes = await readFile(path);
    entries.push([relativePath, createHash("sha256").update(bytes).digest("hex")]);
  }
  return entries.sort(([left], [right]) => left.localeCompare(right));
}

export async function cleanupScannerRoots() {
  await Promise.all(scannerRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
