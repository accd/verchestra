// Deterministic build of the publishable `verchestra` npm package (NPX-01,
// NPX-02,
// NPX-08, NPX-10).
//
// The tarball is assembled, never scraped: this script typechecks
// `apps/vestra-launcher`, bundles its bootstrap into one self-contained ESM
// module, copies the tracked bin shim, license, and user documentation, renders
// the tracked publish manifest, and installs the reviewed pinned release
// inputs. It then proves the emitted tree is exactly the declared allowlist and
// that nothing in it reaches a workspace package, a TypeScript source, an
// install script, a dependency-resolution path, or a machine-local path.
//
// Bundling is what lets the published package carry the qualified TUF and
// activation closure while declaring no dependency at all: `apps/vestra-launcher`
// may not import a workspace package, so the closure is inlined here, at build
// time, from repository sources. Nothing is downloaded when a user runs
// `npx verchestra`.
//
// The build is deterministic by construction. esbuild is invoked with a fixed
// option vector, no source map, and no timestamp; the working directory is the
// repository root, so no absolute path can reach the output; and minification
// removes the per-module provenance comments that would otherwise embed
// dependency-resolution paths. Two builds from identical inputs emit
// byte-identical files, which `tests/build/vestra-launcher-package.test.mjs`
// asserts.
//
// The pinned release inputs are required. A fixture trust root is not release
// authority, so a build without reviewed inputs fails closed rather than
// emitting something that looks publishable.
//
// This script never publishes. `npm publish` stays a human step.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build as esbuild } from "esbuild";

const execute = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PACKAGE_ROOT = join(ROOT, "apps", "vestra-launcher");
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const NODE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/** The exact set of paths a published `verchestra` tarball may contain. */
export const PUBLISHED_FILE_ALLOWLIST = Object.freeze([
  "LICENSE",
  "README.md",
  "bin/verchestra.mjs",
  "bin/vestra.mjs",
  "config/release-source.json",
  "config/root.json",
  "lib/bootstrap.js",
  "package.json"
]);

/**
 * The bundle's fail-closed CommonJS shim. Bundled CommonJS dependencies call
 * `require` for Node built-ins, and an ES module has none, so one is supplied —
 * but it resolves built-ins only. A published tarball can therefore never
 * resolve a package from disk, even if a future dependency tried to.
 */
export const BUNDLE_REQUIRE_GUARD = [
  'import { createRequire as __vestraCreateRequire, isBuiltin as __vestraIsBuiltin } from "node:module";',
  "const __vestraNodeRequire = __vestraCreateRequire(import.meta.url);",
  "var require = (id) => {",
  '  if (!__vestraIsBuiltin(id)) throw new Error("vestra refuses a runtime module resolution");',
  "  return __vestraNodeRequire(id);",
  "};"
].join("\n");

/** Content that must never appear in a published file. */
const FORBIDDEN_CONTENT = Object.freeze([
  [/@verchestra\//u, "a workspace package reference"],
  [/from\s+["'][^"']+\.ts["']/u, "a TypeScript source import"],
  [/\bnode_modules\b/u, "a dependency-resolution path"],
  [/[A-Za-z]:\\\\?Users\\|\/(?:home|Users)\/[A-Za-z0-9._-]+\//u, "a machine-local path"]
]);

export class VestraLauncherBuildError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "VestraLauncherBuildError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new VestraLauncherBuildError(code, message, cause === undefined ? undefined : { cause });
};

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const absent = async (path) => {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
};

async function writeStaged(stagingRoot, relativePath, bytes) {
  const target = resolve(stagingRoot, ...relativePath.split("/"));
  const child = relative(stagingRoot, target);
  if (child.length === 0 || child.startsWith(`..${sep}`))
    fail("VES_VESTRA_BUILD_INPUT_INVALID", `output path ${relativePath} escapes the staging root`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
}

async function walk(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(root, path)));
    else files.push(relative(root, path).replaceAll("\\", "/"));
  }
  return files.sort();
}

async function readPinnedInputs(directory) {
  const inputs = {};
  for (const name of ["release-source.json", "root.json"]) {
    try {
      inputs[name] = await readFile(join(directory, name));
    } catch (error) {
      fail(
        "VES_VESTRA_BUILD_INPUTS_MISSING",
        `the reviewed pinned release input ${name} is required and was not supplied`,
        error
      );
    }
  }
  let source;
  try {
    source = JSON.parse(inputs["release-source.json"].toString("utf8"));
  } catch (error) {
    return fail("VES_VESTRA_BUILD_INPUT_INVALID", "the pinned release source is not JSON", error);
  }
  if (source === null || typeof source !== "object" || typeof source.semanticVersion !== "string")
    fail("VES_VESTRA_BUILD_INPUT_INVALID", "the pinned release source declares no semantic version");
  if (!SEMVER.test(source.semanticVersion))
    fail("VES_VESTRA_BUILD_INPUT_INVALID", "the pinned release semantic version is invalid");
  if (source.rootDigest !== digestOf(inputs["root.json"]))
    fail("VES_VESTRA_BUILD_INPUT_INVALID", "the pinned trust root does not match the pinned release source");
  return { bytes: inputs, semanticVersion: source.semanticVersion };
}

async function typecheck() {
  try {
    await execute(
      process.execPath,
      [join(ROOT, "node_modules", "typescript", "bin", "tsc"), "-p", join(PACKAGE_ROOT, "tsconfig.build.json")],
      { cwd: ROOT, windowsHide: true }
    );
  } catch (error) {
    fail("VES_VESTRA_BUILD_COMPILE_FAILED", "the launcher bootstrap did not typecheck", error);
  }
}

/** The exact Node the repository pins; the bundle may target nothing else. */
async function pinnedNodeTarget() {
  const manifest = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const version = manifest?.engines?.node;
  if (typeof version !== "string" || !NODE_VERSION.test(version))
    fail("VES_VESTRA_BUILD_INPUT_INVALID", "the repository pins no exact Node version to target");
  return `node${version}`;
}

/**
 * Bundles the bootstrap and its whole activation closure into one ESM module.
 * Every option here is fixed, and no source map, metafile, or timestamp option
 * is passed — esbuild emits none by default, and a source map would embed
 * build-machine paths. `cwd` is the repository root, so no absolute path can be
 * recorded either. Minification is not a size choice — it is what removes esbuild's
 * per-module provenance comments, which would otherwise embed
 * dependency-resolution paths in a published file. `--keep-names` is kept so
 * class and function identity survives into stack traces and any `name`-based
 * behavior in the qualified code the bundle carries.
 */
async function bundle(stagingRoot) {
  const target = await pinnedNodeTarget();
  // esbuild's JS API, not its `bin/esbuild`. That path is a JS shim on Windows
  // but the native executable itself on Linux and macOS, so spawning it through
  // `process.execPath` only ever worked on Windows — Node parsed an ELF header
  // as JavaScript everywhere else. The API resolves the platform binary itself
  // and returns structured diagnostics rather than scraped stderr. The option
  // vector is otherwise identical, so byte-identical rebuilds are unchanged.
  let result;
  try {
    result = await esbuild({
      absWorkingDir: ROOT,
      entryPoints: [join(PACKAGE_ROOT, "closure", "bootstrap-entry.ts")],
      outfile: join(stagingRoot, "lib", "bootstrap.js"),
      bundle: true,
      platform: "node",
      format: "esm",
      target,
      minify: true,
      keepNames: true,
      legalComments: "none",
      banner: { js: BUNDLE_REQUIRE_GUARD },
      logLevel: "silent"
    });
  } catch (error) {
    return fail("VES_VESTRA_BUILD_BUNDLE_FAILED", "the launcher bootstrap did not bundle", error);
  }
  if (result.errors.length > 0 || result.warnings.length > 0)
    fail(
      "VES_VESTRA_BUILD_BUNDLE_FAILED",
      `the launcher bundle reported diagnostics: ${JSON.stringify([...result.errors, ...result.warnings])}`
    );
}

/**
 * A published bundle may import Node built-ins and nothing else. This is the
 * artifact-level statement of NPX-08: whatever the repository graph looked like
 * at build time, the emitted module resolves no package at run time.
 */
async function assertSelfContained(stagingRoot) {
  const bundled = await readFile(join(stagingRoot, "lib", "bootstrap.js"), "utf8");
  if (!bundled.startsWith(BUNDLE_REQUIRE_GUARD))
    fail("VES_VESTRA_BUILD_FORBIDDEN_CONTENT", "the emitted bundle does not carry the fail-closed require guard");
  const specifiers = [...bundled.matchAll(/(?:^|[\s;}])import\s*(?:[^"';]*?from\s*)?["']([^"']+)["']/gu)].map(
    (match) => match[1]
  );
  const external = specifiers.filter((specifier) => !specifier.startsWith("node:"));
  if (external.length > 0)
    fail("VES_VESTRA_BUILD_FORBIDDEN_CONTENT", `the emitted bundle imports ${external.join(", ")} at run time`);
}

async function renderManifest(semanticVersion) {
  const template = JSON.parse(await readFile(join(PACKAGE_ROOT, "publish", "package.template.json"), "utf8"));
  if ("scripts" in template || "dependencies" in template || template.private === true)
    fail("VES_VESTRA_BUILD_INPUT_INVALID", "the publish manifest template is not publishable as written");
  return Buffer.from(`${JSON.stringify({ ...template, version: semanticVersion }, null, 2)}\n`, "utf8");
}

async function assertPublishable(stagingRoot) {
  const emitted = await walk(stagingRoot);
  if (JSON.stringify(emitted) !== JSON.stringify([...PUBLISHED_FILE_ALLOWLIST]))
    fail(
      "VES_VESTRA_BUILD_ALLOWLIST_DRIFT",
      `emitted tree does not match the published allowlist: ${emitted.join(", ")}`
    );
  const files = [];
  for (const path of emitted) {
    const bytes = await readFile(join(stagingRoot, ...path.split("/")));
    if (path.endsWith(".js") || path.endsWith(".mjs")) {
      for (const [pattern, description] of FORBIDDEN_CONTENT) {
        if (pattern.test(bytes.toString("utf8")))
          fail("VES_VESTRA_BUILD_FORBIDDEN_CONTENT", `${path} contains ${description}`);
      }
    }
    files.push({ path, contentDigest: digestOf(bytes), sizeBytes: bytes.length });
  }
  const manifest = JSON.parse(await readFile(join(stagingRoot, "package.json"), "utf8"));
  if ("scripts" in manifest || "dependencies" in manifest || "devDependencies" in manifest)
    fail("VES_VESTRA_BUILD_FORBIDDEN_CONTENT", "the published manifest declares scripts or dependencies");
  return { files, manifest };
}

/**
 * Builds the publishable tree into `outputDirectory` and returns a receipt
 * naming every emitted file and its digest. The directory must not exist.
 */
export async function buildVestraLauncher(options) {
  const outputDirectory = resolve(options.outputDirectory ?? join(PACKAGE_ROOT, "dist"));
  if (typeof options.releaseInputs !== "string" || options.releaseInputs.length === 0)
    fail("VES_VESTRA_BUILD_INPUTS_MISSING", "a reviewed pinned release input directory is required");
  if (!(await absent(outputDirectory)))
    fail("VES_VESTRA_BUILD_OUTPUT_EXISTS", "the launcher build output already exists");
  const pinned = await readPinnedInputs(resolve(options.releaseInputs));
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  await typecheck();
  await bundle(outputDirectory);
  await assertSelfContained(outputDirectory);
  await writeStaged(outputDirectory, "bin/vestra.mjs", await readFile(join(PACKAGE_ROOT, "bin", "vestra.mjs")));
  await writeStaged(outputDirectory, "bin/verchestra.mjs", await readFile(join(PACKAGE_ROOT, "bin", "verchestra.mjs")));
  await writeStaged(outputDirectory, "README.md", await readFile(join(PACKAGE_ROOT, "README.md")));
  await writeStaged(outputDirectory, "LICENSE", await readFile(join(ROOT, "LICENSE")));
  await writeStaged(outputDirectory, "package.json", await renderManifest(pinned.semanticVersion));
  for (const name of ["release-source.json", "root.json"])
    await writeStaged(outputDirectory, `config/${name}`, pinned.bytes[name]);
  const { files, manifest } = await assertPublishable(outputDirectory);
  return Object.freeze({
    schemaVersion: 1,
    outputDirectory,
    packageName: manifest.name,
    packageVersion: manifest.version,
    files: Object.freeze(files.map((file) => Object.freeze(file))),
    allowlist: PUBLISHED_FILE_ALLOWLIST
  });
}

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const receipt = await buildVestraLauncher({
    releaseInputs: option("--release-inputs"),
    outputDirectory: option("--out")
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
