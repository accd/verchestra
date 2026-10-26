import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const OWNER_EXECUTABLE = 0o700;

async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

export function renderWindowsLauncher() {
  return '@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0app\\bootstrap.cjs" %*\r\nexit /b %errorlevel%\r\n';
}

export function renderUnixLauncher() {
  return '#!/bin/sh\nset -eu\ncase "$0" in\n  */*) SELF_DIR=${0%/*} ;;\n  *) SELF_DIR=. ;;\nesac\ncd "$SELF_DIR"\nSELF_DIR=$PWD\nexec "$SELF_DIR/runtime/node" "$SELF_DIR/app/bootstrap.cjs" "$@"\n';
}

// invariant: the build replaces only what it owns. An existing output root is
// cleared only when it is empty or holds a bundle this script wrote, so a wrong
// path is refused instead of being deleted recursively.
async function assertReplaceable(outputRoot) {
  const entries = await fs.readdir(outputRoot).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  if (entries.length === 0) return;
  const manifest = await fs
    .readFile(path.join(outputRoot, "release.json"), "utf8")
    .then(JSON.parse)
    .catch(() => undefined);
  if (manifest?.product !== "Verchestra" || manifest?.schemaVersion !== 1)
    throw new Error(`refusing to replace ${outputRoot}: it is not empty and holds no Verchestra bundle`);
}

export async function buildBundle(outputRoot) {
  await assertReplaceable(outputRoot);
  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(outputRoot, "runtime"), { recursive: true });
  await fs.mkdir(path.join(outputRoot, "app"), { recursive: true });

  const runtimeName = process.platform === "win32" ? "node.exe" : "node";
  const runtimePath = path.join(outputRoot, "runtime", runtimeName);
  const appPath = path.join(outputRoot, "app", "cli.mjs");
  const bootstrapPath = path.join(outputRoot, "app", "bootstrap.cjs");

  await fs.copyFile(process.execPath, runtimePath);
  await fs.copyFile(path.join(sourceRoot, "cli.mjs"), appPath);
  await fs.copyFile(path.join(sourceRoot, "bootstrap.cjs"), bootstrapPath);
  // why: the bundle is built by and for the current user, so its executables
  // are owner-only; nothing grants other users read or execute.
  if (process.platform !== "win32") await fs.chmod(runtimePath, OWNER_EXECUTABLE);

  const manifest = {
    schemaVersion: 1,
    product: "Verchestra",
    canonicalCommand: "vestra",
    compatibilityAliases: ["verchestra"],
    version: "0.0.0-qualification",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.versions.node,
    runtimeSha256: await sha256(runtimePath),
    appSha256: await sha256(appPath)
  };
  await fs.writeFile(path.join(outputRoot, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const windows = renderWindowsLauncher();
  const unix = renderUnixLauncher();
  await fs.writeFile(path.join(outputRoot, "vestra.cmd"), windows);
  await fs.writeFile(path.join(outputRoot, "verchestra.cmd"), windows);
  await fs.writeFile(path.join(outputRoot, "vestra"), unix, { mode: OWNER_EXECUTABLE });
  await fs.writeFile(path.join(outputRoot, "verchestra"), unix, { mode: OWNER_EXECUTABLE });

  return { outputRoot, manifest };
}

// why: the command line names no path. The bundle always lands in the ignored
// `.bundle` beside this spike, so no caller-supplied text reaches a recursive
// removal; tests and other callers pass their own root to buildBundle.
export const DEFAULT_BUNDLE_ROOT = path.join(sourceRoot, "..", ".bundle");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    process.stderr.write(`build-bundle takes no arguments; it writes ${DEFAULT_BUNDLE_ROOT}\n`);
    process.exit(2);
  }
  await buildBundle(DEFAULT_BUNDLE_ROOT);
  process.stdout.write(`${DEFAULT_BUNDLE_ROOT}\n`);
}
