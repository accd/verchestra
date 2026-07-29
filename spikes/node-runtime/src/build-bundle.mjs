import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));

async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

export function renderWindowsLauncher() {
  return '@echo off\r\nsetlocal\r\n"%~dp0runtime\\node.exe" "%~dp0app\\bootstrap.cjs" %*\r\nexit /b %errorlevel%\r\n';
}

export function renderUnixLauncher() {
  return '#!/bin/sh\nset -eu\ncase "$0" in\n  */*) SELF_DIR=${0%/*} ;;\n  *) SELF_DIR=. ;;\nesac\ncd "$SELF_DIR"\nSELF_DIR=$PWD\nexec "$SELF_DIR/runtime/node" "$SELF_DIR/app/bootstrap.cjs" "$@"\n';
}

export async function buildBundle(outputRoot) {
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
  if (process.platform !== "win32") await fs.chmod(runtimePath, 0o755);

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
  await fs.writeFile(path.join(outputRoot, "vestra"), unix, { mode: 0o755 });
  await fs.writeFile(path.join(outputRoot, "verchestra"), unix, { mode: 0o755 });

  return { outputRoot, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputRoot = path.resolve(process.argv[2] ?? path.join(sourceRoot, "..", ".bundle"));
  await buildBundle(outputRoot);
  process.stdout.write(`${outputRoot}\n`);
}
