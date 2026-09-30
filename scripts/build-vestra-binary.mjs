// why: #236 adds a second distribution channel for the same launcher: one
// executable per supported target that embeds the pinned official Node runtime,
// so bootstrap needs no ambient `node` and no npm. This script is its only
// build path. It never downloads, never signs with an identity, and never
// publishes; it turns reviewed inputs into bytes plus a manifest that names
// every one of them.
//
// invariant: the build is a pure function of its inputs on a given host — the
// verified runtime, the reviewed pinned release inputs, the repository sources,
// and the pinned toolchain. esbuild runs with a fixed option vector and no
// source map, the SEA blob embeds only relative names, injection is
// deterministic, and the ad-hoc macOS signature carries no timestamp, so two
// builds from identical inputs emit byte-identical files, which
// tests/build/vestra-binary.test.mjs asserts.

import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build as esbuild } from "esbuild";

import { readPinnedInputs as validateLauncherInputs } from "../apps/vestra-launcher/src/pinned-inputs.ts";
import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";
import { FORBIDDEN_CONTENT, pinnedNodeTarget, readPinnedInputs, typecheck } from "./build-vestra-launcher.mjs";
import {
  NODE_RUNTIME_PINS_PATH,
  SINGLE_BINARY_TARGETS,
  loadNodeRuntimePins,
  runtimeFromArchive,
  runtimeFromInstallation,
  sha256Of
} from "./node-runtime-archive.mjs";
import { SEA_FUSE, SEA_RESOURCE_NAME, injectSeaBlob, locateSeaBlob } from "./sea-inject.mjs";

const execute = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MAIN_ENTRY = "apps/vestra-launcher/closure/single-binary-main.ts";
const CODESIGN = "/usr/bin/codesign";
export const CODESIGN_IDENTIFIER = "vestra";
export const BINARY_MANIFEST = "vestra-binary-manifest.json";

/**
 * why: an injected main script's `require` already serves Node built-ins only;
 * the guard restates that at the top of the bundle so the refusal is the same
 * stable message the npm bundle gives, whatever a future Node release does.
 */
export const SEA_REQUIRE_GUARD = [
  "const __vestraSeaRequire = require;",
  'const { isBuiltin: __vestraIsBuiltin } = __vestraSeaRequire("node:module");',
  "var require = (id) => {",
  '  if (!__vestraIsBuiltin(id)) throw new Error("vestra refuses a runtime module resolution");',
  "  return __vestraSeaRequire(id);",
  "};"
].join("\n");

/** invariant: every knob that could vary a SEA blob is fixed here, never read from the host. */
export const SEA_SETTINGS = Object.freeze({
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  execArgvExtension: "none"
});

const EMBEDDED_ASSETS = Object.freeze(["config/release-source.json", "config/root.json"]);

export class VestraBinaryBuildError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "VestraBinaryBuildError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new VestraBinaryBuildError(code, message, cause === undefined ? undefined : { cause });
};

const digestOf = (bytes) => `sha256:${sha256Of(bytes)}`;
const described = (path, bytes) => Object.freeze({ path, contentDigest: digestOf(bytes), sizeBytes: bytes.length });
const executableName = (target) => (target.startsWith("win32-") ? "vestra.exe" : "vestra");

const absent = async (path) => {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
};

async function validatedOptions(options) {
  if (!SINGLE_BINARY_TARGETS.includes(options?.target))
    fail("VES_BINARY_TARGET_UNSUPPORTED", "the target is not one of the five supported single-binary targets");
  if ((options.nodeCache === undefined) === (options.nodeExecutable === undefined))
    fail(
      "VES_BINARY_RUNTIME_UNAVAILABLE",
      "exactly one of a Node archive cache or an installed Node executable is required"
    );
  if (typeof options.releaseInputs !== "string" || options.releaseInputs.length === 0)
    fail("VES_BINARY_INPUTS_MISSING", "a reviewed pinned release input directory is required");
  if (typeof options.outputDirectory !== "string" || options.outputDirectory.length === 0)
    fail("VES_BINARY_OUTPUT_INVALID", "an output directory is required");
  const outputDirectory = resolve(options.outputDirectory);
  if (!(await absent(outputDirectory))) fail("VES_BINARY_OUTPUT_EXISTS", "the binary build output already exists");
  return { ...options, outputDirectory };
}

/**
 * invariant: the SEA blob format belongs to the Node release that reads it, so
 * the blob is generated only by the exact runtime version being embedded, which
 * must also be the version the repository pins.
 */
async function verifiedPins() {
  const pins = await loadNodeRuntimePins(ROOT);
  if (`node${pins.version}` !== (await pinnedNodeTarget()))
    fail("VES_BINARY_RUNTIME_PINS_INVALID", "the runtime pins disagree with the repository's pinned Node version");
  if (process.version !== `v${pins.version}`)
    fail("VES_BINARY_TOOLCHAIN_MISMATCH", `the build must run on Node ${pins.version} to generate its SEA blob`);
  return pins;
}

const verifiedRuntime = async (pins, options) =>
  options.nodeCache === undefined
    ? await runtimeFromInstallation(pins, options.target, options.nodeExecutable)
    : await runtimeFromArchive(pins, options.target, options.nodeCache);

function assertBundleSelfContained(text) {
  if (!text.startsWith(SEA_REQUIRE_GUARD))
    fail("VES_BINARY_BUNDLE_FORBIDDEN_CONTENT", "the single-binary bundle does not carry the require guard");
  const loaded = [...text.matchAll(/\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/gu)].map((match) => match[1]);
  const external = loaded.filter((specifier) => !isBuiltin(specifier));
  if (external.length > 0)
    fail("VES_BINARY_BUNDLE_FORBIDDEN_CONTENT", `the single-binary bundle loads ${external.join(", ")} at run time`);
  for (const [pattern, description] of FORBIDDEN_CONTENT) {
    if (pattern.test(text))
      fail("VES_BINARY_BUNDLE_FORBIDDEN_CONTENT", `the single-binary bundle contains ${description}`);
  }
}

/**
 * why: a Node single executable's main script is CommonJS, so the npm bundle's
 * ESM output cannot be reused; the option vector otherwise mirrors
 * `bundle()` in scripts/build-vestra-launcher.mjs, with the metafile kept in
 * memory only to name every third-party package the bundle inlines.
 */
async function bundleMain() {
  let result;
  try {
    result = await esbuild({
      absWorkingDir: ROOT,
      entryPoints: [join(ROOT, ...MAIN_ENTRY.split("/"))],
      outfile: join(ROOT, "vestra.cjs"),
      write: false,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: await pinnedNodeTarget(),
      minify: true,
      keepNames: true,
      legalComments: "none",
      banner: { js: SEA_REQUIRE_GUARD },
      metafile: true,
      logLevel: "silent"
    });
  } catch (error) {
    return fail("VES_BINARY_BUNDLE_FAILED", "the single-binary launcher did not bundle", error);
  }
  if (result.errors.length > 0 || result.warnings.length > 0 || result.outputFiles.length !== 1)
    fail(
      "VES_BINARY_BUNDLE_FAILED",
      `the single-binary bundle reported diagnostics: ${JSON.stringify(result.warnings)}`
    );
  const bytes = Buffer.from(result.outputFiles[0].contents);
  assertBundleSelfContained(bytes.toString("utf8"));
  return { bytes, inputs: Object.keys(result.metafile.inputs).map((input) => input.replaceAll("\\", "/")) };
}

const PACKAGE_DIRECTORY = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//u;
const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:\.[a-z]+)?$/iu;

async function bundledPackage(directory) {
  const manifest = JSON.parse(await readFile(join(ROOT, ...directory.split("/"), "package.json"), "utf8"));
  const licenseFile = (await readdir(join(ROOT, ...directory.split("/"))))
    .filter((name) => LICENSE_FILE.test(name))
    .sort()[0];
  const license = typeof manifest.license === "string" ? manifest.license : undefined;
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string" || !license || !licenseFile)
    fail("VES_BINARY_LICENSE_INCOMPLETE", `a bundled package under ${directory} declares no license closure`);
  const text = await readFile(join(ROOT, ...directory.split("/"), licenseFile));
  return Object.freeze({ name: manifest.name, version: manifest.version, license, text });
}

/** invariant: every third-party package the bundle inlines is named with its license text, or the build fails. */
async function bundledPackages(inputs) {
  const directories = [...new Set(inputs.map((input) => PACKAGE_DIRECTORY.exec(input)?.[1]).filter(Boolean))];
  const packages = await Promise.all(directories.map(bundledPackage));
  return packages.sort((left, right) => Number(left.name > right.name) - Number(left.name < right.name));
}

function thirdPartyNotices(packages) {
  const sections = packages.map(
    (entry) =>
      `${"=".repeat(78)}\n${entry.name}@${entry.version} (${entry.license})\n${"=".repeat(78)}\n\n${entry.text.toString("utf8").trimEnd()}\n`
  );
  return Buffer.from(`Third-party software bundled into the vestra single binary.\n\n${sections.join("\n")}`, "utf8");
}

const sanitizedEnvironment = () =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("NODE_")));

/**
 * why: the SEA config names the main script and assets relatively, and runs
 * with the staging directory as its working directory, so the blob records no
 * build-machine path.
 */
async function generateBlob(main, pinned) {
  const staging = await mkdtemp(join(tmpdir(), "verchestra-sea-"));
  try {
    await writeFile(join(staging, "vestra.cjs"), main, { mode: 0o600 });
    await mkdir(join(staging, "config"), { mode: 0o700 });
    for (const name of ["release-source.json", "root.json"])
      await writeFile(join(staging, "config", name), pinned.bytes[name], { mode: 0o600 });
    const assets = Object.fromEntries(EMBEDDED_ASSETS.map((key) => [key, key]));
    const config = { main: "vestra.cjs", output: "vestra.blob", ...SEA_SETTINGS, assets };
    await writeFile(join(staging, "sea-config.json"), `${JSON.stringify(config)}\n`, { mode: 0o600 });
    await execute(process.execPath, ["--experimental-sea-config", "sea-config.json"], {
      cwd: staging,
      env: sanitizedEnvironment(),
      windowsHide: true
    });
    return await readFile(join(staging, "vestra.blob"));
  } catch (error) {
    return fail("VES_BINARY_BLOB_FAILED", "Node could not generate the single executable blob", error);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * why: arm64 macOS refuses to run an unsigned Mach-O, and injection removed the
 * official signature. The replacement is ad hoc — no identity, no keychain, no
 * timestamp — so it is reproducible; a Developer ID signature and notarization
 * are owner actions on the emitted bytes, recorded as pending in
 * docs/qualification/single-binary-distribution.md.
 */
async function adHocSign(path) {
  if (process.platform !== "darwin")
    fail("VES_BINARY_SIGNING_UNAVAILABLE", "a macOS binary can only be signed ad hoc on a macOS build host");
  try {
    await execute(CODESIGN, ["--sign", "-", "--force", "--identifier", CODESIGN_IDENTIFIER, path], {
      windowsHide: true
    });
  } catch (error) {
    fail("VES_BINARY_SIGNING_FAILED", "codesign could not apply the ad-hoc signature", error);
  }
}

async function writeOutput(outputDirectory, relativePath, bytes, mode = 0o600) {
  const target = resolve(outputDirectory, ...relativePath.split("/"));
  const child = relative(outputDirectory, target);
  if (child.length === 0 || child.startsWith(`..${sep}`))
    fail("VES_BINARY_OUTPUT_INVALID", `output path ${relativePath} escapes the output directory`);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, bytes, { flag: "wx", mode });
  return target;
}

async function emitExecutable(options, runtime, blob) {
  const injected = injectSeaBlob(runtime.executable, blob);
  const path = await writeOutput(options.outputDirectory, executableName(options.target), injected, 0o755);
  if (options.target.startsWith("darwin-")) await adHocSign(path);
  const bytes = await readFile(path);
  if (!locateSeaBlob(bytes).blob.equals(blob))
    fail("VES_BINARY_INJECTION_UNVERIFIED", "the emitted executable does not carry the generated blob");
  return bytes;
}

async function emitLicenses(outputDirectory, runtime, packages) {
  const files = [
    ["licenses/LICENSE", await readFile(join(ROOT, "LICENSE")), "verchestra", "Apache-2.0"],
    ["licenses/node.LICENSE", runtime.license, "node", "MIT"],
    ["licenses/THIRD-PARTY-NOTICES", thirdPartyNotices(packages), "bundled-npm-packages", "see-notices"]
  ];
  const entries = [];
  for (const [path, bytes, subject, license] of files) {
    await writeOutput(outputDirectory, path, bytes);
    entries.push({ ...described(path, bytes), subject, license });
  }
  return entries;
}

const npmPurl = (entry) => `pkg:npm/${entry.name.replace(/^@/u, "%40")}@${entry.version}`;

function sbomOf(context) {
  const { pins, runtime, bundle, packages, executable, semanticVersion } = context;
  const hash = (bytes) => [{ alg: "SHA-256", content: sha256Of(bytes) }];
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": "vestra",
        name: "vestra",
        version: semanticVersion,
        hashes: hash(executable)
      }
    },
    components: [
      {
        type: "application",
        "bom-ref": "runtime:node",
        name: "node",
        version: pins.version,
        purl: `pkg:generic/node@${pins.version}?download_url=${encodeURIComponent(pins.distributionBaseUrl)}`,
        hashes: hash(runtime.executable),
        licenses: [{ license: { id: pins.license } }]
      },
      {
        type: "library",
        "bom-ref": "launcher:single-binary",
        name: "vestra-launcher",
        version: semanticVersion,
        hashes: hash(bundle.bytes),
        licenses: [{ license: { id: "Apache-2.0" } }]
      },
      ...packages.map((entry) => ({
        type: "library",
        "bom-ref": npmPurl(entry),
        name: entry.name,
        version: entry.version,
        purl: npmPurl(entry),
        licenses: [{ license: { id: entry.license } }]
      }))
    ]
  };
}

function manifestOf(context) {
  const { options, pins, runtime, bundle, blob, pinned, executable, licenses, format } = context;
  const pin = pins.targets[options.target];
  const [platform, arch] = options.target.split("-");
  return {
    schemaVersion: 1,
    kind: "verchestra-single-binary",
    target: { platform, arch },
    release: {
      releaseId: pinned.source.releaseId,
      semanticVersion: pinned.source.semanticVersion,
      rootDigest: pinned.source.rootDigest
    },
    executable: {
      ...described(executableName(options.target), executable),
      format,
      signature: platform === "darwin" ? "ad-hoc" : "none"
    },
    runtime: {
      name: "node",
      version: pins.version,
      verifiedBy: runtime.verifiedBy,
      pins: { path: NODE_RUNTIME_PINS_PATH, contentDigest: `sha256:${pins.digest}` },
      shasumsUrl: pins.shasumsUrl,
      archive: { fileName: pin.archive.fileName, contentDigest: `sha256:${pin.archive.sha256}` },
      executable: described(pin.executable.member, runtime.executable)
    },
    launcherBundle: { entry: MAIN_ENTRY, format: "cjs", ...described("vestra.cjs", bundle.bytes) },
    sea: {
      ...SEA_SETTINGS,
      resource: SEA_RESOURCE_NAME,
      fuse: SEA_FUSE,
      blob: described("vestra.blob", blob),
      assets: EMBEDDED_ASSETS.map((key) => described(key, pinned.bytes[key.slice("config/".length)]))
    },
    licenses,
    sbom: sbomOf({ ...context, semanticVersion: pinned.source.semanticVersion })
  };
}

/**
 * invariant: the build embeds only inputs the binary itself would accept, so
 * the launcher's own validation runs here over the exact bytes that are
 * embedded, and a refusal surfaces now rather than on a user's machine.
 */
async function readReleaseInputs(directory) {
  const pinned = await readPinnedInputs(resolve(directory));
  try {
    const validated = await validateLauncherInputs(async (name) => pinned.bytes[name]);
    return { bytes: pinned.bytes, source: validated.source };
  } catch (error) {
    return fail("VES_BINARY_INPUTS_INVALID", "the pinned release inputs are not ones the launcher accepts", error);
  }
}

async function assemble(options, outputDirectory) {
  const pins = await verifiedPins();
  const pinned = await readReleaseInputs(options.releaseInputs);
  const runtime = await verifiedRuntime(pins, options);
  await typecheck();
  const bundle = await bundleMain();
  const packages = await bundledPackages(bundle.inputs);
  const blob = await generateBlob(bundle.bytes, pinned);
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const executable = await emitExecutable(options, runtime, blob);
  const licenses = await emitLicenses(outputDirectory, runtime, packages);
  const format = locateSeaBlob(executable).format;
  const context = { options, pins, runtime, bundle, blob, pinned, packages, executable, licenses, format };
  const manifest = Buffer.from(`${canonicalizeJsonV2(manifestOf(context))}\n`, "utf8");
  await writeOutput(outputDirectory, BINARY_MANIFEST, manifest);
  return { manifest, executable };
}

/**
 * invariant: `outputDirectory` must not exist, and a failed build removes
 * everything it created, so a partial binary can never be mistaken for one.
 */
export async function buildVestraBinary(rawOptions) {
  const options = await validatedOptions(rawOptions);
  let succeeded = false;
  try {
    const { manifest, executable } = await assemble(options, options.outputDirectory);
    succeeded = true;
    return Object.freeze({
      schemaVersion: 1,
      outputDirectory: options.outputDirectory,
      target: options.target,
      executable: described(executableName(options.target), executable),
      manifest: described(BINARY_MANIFEST, manifest)
    });
  } finally {
    if (!succeeded) await rm(options.outputDirectory, { recursive: true, force: true });
  }
}

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const receipt = await buildVestraBinary({
    target: option("--target"),
    nodeCache: option("--node-cache"),
    nodeExecutable: option("--node-executable"),
    releaseInputs: option("--release-inputs"),
    outputDirectory: option("--out")
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}
