// Ephemeral, non-authoritative build inputs for the publishable `vestra`
// package, plus a dependency-free reader for the tarball npm produces.
//
// These bytes are a test fixture and are deliberately never tracked and never
// published: a fixture trust root is not release authority. They exist only so
// the artifact contract - allowlist, manifest shape, forbidden content - can be
// verified before T76 supplies the reviewed inputs.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";

const execute = promisify(execFile);
const roots = [];

export const FIXTURE_SEMANTIC_VERSION = "1.0.0";

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function fixtureTrustRoot() {
  return `${JSON.stringify({
    signatures: [{ keyid: "0".repeat(64), sig: "00".repeat(64) }],
    signed: {
      _type: "root",
      spec_version: "1.0.0",
      version: 1,
      expires: "2035-01-01T00:00:00Z",
      keys: {},
      roles: {},
      consistent_snapshot: true
    }
  })}\n`;
}

// The schemaVersion-2 pinned source is a per-host map: one published tarball
// must resolve every fleet platform. Every key gets a distinct URL pair so a
// selection test can detect one host aliasing another host's locations.
export const FLEET_TARGET_KEYS = Object.freeze(["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"]);

export function fixtureTargets(keys = FLEET_TARGET_KEYS) {
  return Object.fromEntries(
    keys.map((key) => [
      key,
      {
        metadataBaseUrl: `https://releases.example.invalid/${key}/metadata/`,
        targetBaseUrl: `https://releases.example.invalid/${key}/targets/`
      }
    ])
  );
}

export function fixtureReleaseSource(overrides = {}) {
  return {
    schemaVersion: 2,
    sourceId: "source:offline:fixture",
    releaseId: "release:verchestra:fixture",
    semanticVersion: FIXTURE_SEMANTIC_VERSION,
    rootDigest: digestOf(fixtureTrustRoot()),
    targets: fixtureTargets(),
    ...overrides
  };
}

/** Writes a pinned-input directory and returns its path. */
export async function pinnedInputDirectory(options = {}) {
  const root = await mkdtemp(join(tmpdir(), "verchestra-launcher-inputs-"));
  roots.push(root);
  const trustedRoot = options.trustedRoot ?? fixtureTrustRoot();
  const source = options.source ?? fixtureReleaseSource(options.sourceOverrides ?? {});
  if (options.omitRoot !== true) await writeFile(join(root, "root.json"), trustedRoot);
  if (options.omitSource !== true)
    await writeFile(join(root, "release-source.json"), `${JSON.stringify(source, null, 2)}\n`);
  return root;
}

/** A fresh, never-created output directory path inside a disposable root. */
export async function outputDirectory() {
  return join(await disposableDirectory(), "package");
}

/** An existing disposable directory, for tools that require their target to exist. */
export async function disposableDirectory() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-launcher-out-"));
  roots.push(root);
  return root;
}

export async function disposeLauncherFixtures() {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

function npmCli() {
  const candidates = [
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined)
    throw new Error(`npm is not reachable from this Node installation: ${candidates.join(", ")}`);
  return found;
}

/**
 * Runs npm through its own JavaScript entry point rather than a `.cmd` shim, so
 * no shell is involved on any platform.
 */
export async function runNpm(cwd, args) {
  const result = await execute(process.execPath, [npmCli(), ...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false" }
  });
  return result.stdout;
}

/** Lists the regular-file entries of a gzipped tar archive. */
export function listTarEntries(archive) {
  const tar = gunzipSync(archive);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/su, "");
    const size = Number.parseInt(header.subarray(124, 136).toString("utf8").replace(/\0.*$/su, "").trim(), 8) || 0;
    const typeflag = String.fromCharCode(header[156]);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (typeflag === "0" || typeflag === "\0") entries.push({ name, size });
  }
  return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
}
