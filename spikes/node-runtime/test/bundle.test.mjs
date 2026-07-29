import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { buildBundle, renderUnixLauncher, renderWindowsLauncher } from "../src/build-bundle.mjs";

let tempRoot;
let bundleRoot;

function hash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function launcher(name, args = [], env = process.env) {
  const executable = path.join(bundleRoot, process.platform === "win32" ? `${name}.cmd` : name);
  if (process.platform === "win32") {
    const quote = (value) => `"${value.replaceAll('"', '""')}"`;
    const command = `${quote(executable)} ${args.map(quote).join(" ")}`;
    return spawnSync(command, { encoding: "utf8", env, shell: process.env.ComSpec });
  }
  return spawnSync(executable, args, { encoding: "utf8", env });
}

before(async () => {
  tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "verchestra-node-qualification-"));
  bundleRoot = path.join(tempRoot, "bundle");
  await buildBundle(bundleRoot);
});

after(async () => {
  await fsp.rm(tempRoot, { recursive: true, force: true });
});

test("pins the qualified Node patch", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.engines.node, "24.14.0");
  assert.equal(process.versions.node, pkg.engines.node);
});

test("pins the qualified pnpm release", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.packageManager, "pnpm@10.34.5");
});

test("records platform and architecture in the release manifest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, "release.json"), "utf8"));
  assert.equal(manifest.platform, process.platform);
  assert.equal(manifest.arch, process.arch);
});

test("records the canonical command and compatibility alias", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, "release.json"), "utf8"));
  assert.equal(manifest.canonicalCommand, "vestra");
  assert.deepEqual(manifest.compatibilityAliases, ["verchestra"]);
});

test("renders behavior-identical Windows launcher bodies", () => {
  assert.equal(fs.readFileSync(path.join(bundleRoot, "vestra.cmd"), "utf8"), renderWindowsLauncher());
  assert.equal(fs.readFileSync(path.join(bundleRoot, "verchestra.cmd"), "utf8"), renderWindowsLauncher());
});

test("renders behavior-identical Unix launcher bodies", () => {
  const launcher = '#!/bin/sh\nset -eu\ncase "$0" in\n  */*) SELF_DIR=${0%/*} ;;\n  *) SELF_DIR=. ;;\nesac\ncd "$SELF_DIR"\nSELF_DIR=$PWD\nexec "$SELF_DIR/runtime/node" "$SELF_DIR/app/bootstrap.cjs" "$@"\n';
  assert.equal(renderUnixLauncher(), launcher);
  assert.equal(fs.readFileSync(path.join(bundleRoot, "vestra"), "utf8"), launcher);
  assert.equal(fs.readFileSync(path.join(bundleRoot, "verchestra"), "utf8"), launcher);
});

test("returns identical human version output from both names", () => {
  const canonical = launcher("vestra", ["--version"]);
  const alias = launcher("verchestra", ["--version"]);
  assert.equal(canonical.status, 0);
  assert.equal(alias.status, 0);
  assert.equal(alias.stdout, canonical.stdout);
  assert.equal(alias.stderr, canonical.stderr);
});

test("returns identical JSON output from both names", () => {
  const canonical = launcher("vestra", ["--version", "--output", "json"]);
  const alias = launcher("verchestra", ["--version", "--output", "json"]);
  assert.equal(canonical.status, 0);
  assert.deepEqual(JSON.parse(alias.stdout), JSON.parse(canonical.stdout));
});

test("returns identical help from both names", () => {
  const canonical = launcher("vestra", ["--help"]);
  const alias = launcher("verchestra", ["--help"]);
  assert.equal(canonical.status, 0);
  assert.equal(alias.stdout, canonical.stdout);
});

test("returns stable usage failure from both names", () => {
  const canonical = launcher("vestra", ["unknown"]);
  const alias = launcher("verchestra", ["unknown"]);
  assert.equal(canonical.status, 64);
  assert.equal(alias.status, 64);
  assert.equal(alias.stderr, canonical.stderr);
});

test("runs with an empty PATH using only its bundled runtime", () => {
  const env = process.platform === "win32" ? { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec, PATH: "" } : { PATH: "" };
  const result = launcher("vestra", ["--version"], env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Verchestra 0\.0\.0-qualification/);
});

test("rejects an application whose digest changed", async () => {
  const app = path.join(bundleRoot, "app", "cli.mjs");
  const original = await fsp.readFile(app);
  await fsp.appendFile(app, "\n// tampered\n");
  const result = launcher("vestra", ["--version"]);
  assert.equal(result.status, 70);
  assert.match(result.stderr, /VES_RUNTIME_INTEGRITY_FAILED: application digest mismatch/);
  await fsp.writeFile(app, original);
});

test("rejects a bundle for another platform", async () => {
  const manifestPath = path.join(bundleRoot, "release.json");
  const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  await fsp.writeFile(manifestPath, `${JSON.stringify({ ...manifest, platform: "unsupported-test-platform" }, null, 2)}\n`);
  const result = launcher("vestra", ["--version"]);
  assert.equal(result.status, 70);
  assert.match(result.stderr, /VES_RUNTIME_INTEGRITY_FAILED: platform mismatch/);
  await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
});

test("reports the exact release-manifest digest", () => {
  const result = launcher("vestra", ["--version", "--output", "json"]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).releaseDigest, hash(path.join(bundleRoot, "release.json")));
});

test("records the exact bundled runtime digest", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, "release.json"), "utf8"));
  const runtime = path.join(bundleRoot, "runtime", process.platform === "win32" ? "node.exe" : "node");
  assert.equal(manifest.runtimeSha256, hash(runtime));
});

test("contains no node_modules or ambient package dependency", () => {
  const entries = execFileSync(process.execPath, ["-e", "const fs=require('fs');console.log(JSON.stringify(fs.readdirSync(process.argv[1],{recursive:true})))", bundleRoot], { encoding: "utf8" });
  const paths = JSON.parse(entries);
  assert.equal(paths.some((entry) => String(entry).includes("node_modules")), false);
});
