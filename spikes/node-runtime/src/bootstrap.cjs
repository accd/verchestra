"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function fail(message) {
  process.stderr.write(`VES_RUNTIME_INTEGRITY_FAILED: ${message}\n`);
  process.exitCode = 70;
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const manifestPath = path.join(root, "release.json");
  const appPath = path.join(root, "app", "cli.mjs");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (manifest.schemaVersion !== 1) return fail("unsupported release schema");
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return fail("platform mismatch");
  if (manifest.nodeVersion !== process.versions.node) return fail("node version mismatch");
  if (manifest.runtimeSha256 !== sha256(process.execPath)) return fail("runtime digest mismatch");
  if (manifest.appSha256 !== sha256(appPath)) return fail("application digest mismatch");

  process.env.VERCHESTRA_RELEASE_DIGEST = sha256(manifestPath);
  const { run } = await import(pathToFileURL(appPath).href);
  process.exitCode = await run(process.argv.slice(2));
}

main().catch((error) => fail(error instanceof Error ? error.message : "unknown bootstrap failure"));

