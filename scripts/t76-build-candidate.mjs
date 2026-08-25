import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { dirname, join, relative, resolve, sep } from "node:path";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";

import { canonicalizeJsonV2 } from "../packages/domain/src/index.ts";
import { materializeHermeticReleaseFromFiles } from "../packages/distribution/src/release-materializer.ts";

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REVISION = /^[0-9a-f]{40}$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:._@+/-]{0,255}$/u;
const NODE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const PLATFORMS = new Set(["win32", "linux", "darwin"]);
const ARCHES = new Set(["x64", "arm64"]);
const REQUIRED_PROFILES = Object.freeze(["build", "full", "quick", "release", "security"]);
const SOURCE_EXTENSIONS = new Set([".mjs", ".ts"]);

export class T76BuildError extends Error {
  code;

  constructor(code, message, options) {
    super(message, options);
    this.name = "T76BuildError";
    this.code = code;
  }
}

const fail = (code, message, cause) => {
  throw new T76BuildError(code, message, cause === undefined ? undefined : { cause });
};

const canonicalBytes = (value) => Buffer.from(canonicalizeJsonV2(value), "utf8");

const text = (value, label, pattern) => {
  if (typeof value !== "string" || !pattern.test(value)) fail("VES_T76_BUILD_INPUT_INVALID", `${label} is invalid`);
  return value;
};

const assertInside = (root, candidate) => {
  const rootPath = resolve(root);
  const candidatePath = resolve(candidate);
  const child = relative(rootPath, candidatePath);
  if (child.length === 0 || child === ".." || child.startsWith(`..${sep}`) || child.includes(`..${sep}`))
    fail("VES_T76_BUILD_PATH_INVALID", "build output path escapes its root");
};

const assertAbsent = async (path) => {
  try {
    await lstat(path);
    fail("VES_T76_BUILD_OUTPUT_EXISTS", "build output already exists");
  } catch (error) {
    if (error instanceof T76BuildError) throw error;
    if (error?.code !== "ENOENT") fail("VES_T76_BUILD_OUTPUT_INVALID", "build output cannot be inspected", error);
  }
};

const writeOutput = async (root, relativePath, bytes, mode = 0o600) => {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.startsWith("/")
  )
    fail("VES_T76_BUILD_PATH_INVALID", "output path is not a safe relative path");
  const target = resolve(root, ...relativePath.split("/"));
  assertInside(root, target);
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try {
    await writeFile(target, bytes, { flag: "wx", mode });
  } catch (error) {
    fail("VES_T76_BUILD_WRITE_FAILED", `unable to write ${relativePath}`, error);
  }
};

const git = async (repository, args, code) => {
  try {
    const result = await execute("git", ["-C", repository, ...args], { encoding: "buffer", windowsHide: true });
    return Buffer.from(result.stdout);
  } catch (error) {
    fail(code, "git could not provide the requested revision content", error);
  }
};

const trackedPaths = async (repository, revision) => {
  const bytes = await git(
    repository,
    ["ls-tree", "-r", "--name-only", "-z", revision],
    "VES_T76_BUILD_REVISION_INVALID"
  );
  return bytes
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
};

const trackedBytes = async (repository, revision, path) =>
  git(repository, ["show", `${revision}:${path}`], "VES_T76_BUILD_SOURCE_READ_FAILED");

const PACKAGE_KINDS = Object.freeze([
  ["packages/policy/src/", "policy"],
  ["packages/drivers/src/", "driver"],
  ["packages/data-probe/src/", "connector"],
  ["packages/agent-runtime/src/skills/", "skill"],
  ["packages/workspace/src/init/", "migration"]
]);

const packageSourceKind = (path) => {
  for (const [prefix, kind] of PACKAGE_KINDS) if (path.startsWith(prefix)) return kind;
  return "core-code";
};

const sourceKind = (path) => {
  if (path === "LICENSE") return "license";
  if (path.startsWith("schemas/") && path.endsWith(".json")) return "schema";
  if (!path.startsWith("packages/") || !path.includes("/src/")) return undefined;
  return packageSourceKind(path);
};

const isSourcePath = (path) => {
  if (path.startsWith("apps/vestra-cli/src/") && SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf(".")))) return true;
  return sourceKind(path) !== undefined;
};

const hostPlatform = () => {
  if (!PLATFORMS.has(process.platform) || !ARCHES.has(process.arch))
    fail("VES_T76_BUILD_TARGET_UNSUPPORTED", "the current host is not a supported T76 target");
  return { platform: process.platform, arch: process.arch };
};

const nativeAsset = (packageName, fallback) => {
  try {
    return fallback();
  } catch (error) {
    fail("VES_T76_BUILD_NATIVE_ASSET_UNAVAILABLE", `${packageName} is not installed for this target`, error);
  }
};

const hostAssets = () => {
  const sqlitePath = nativeAsset("sqlite-vec", () => require("sqlite-vec").getLoadablePath());
  const cedarModule = nativeAsset("@cedar-policy/cedar-wasm", () => require.resolve("@cedar-policy/cedar-wasm/nodejs"));
  const cedarPath = join(dirname(cedarModule), "cedar_wasm_bg.wasm");
  return Object.freeze({ node: process.execPath, sqlite: sqlitePath, cedar: cedarPath });
};

const componentIdFor = (logicalPath) => `source:${createHash("sha256").update(logicalPath).digest("hex").slice(0, 32)}`;

const referencesFor = (kind) =>
  kind === "license"
    ? { licenseRefs: [], attestationRefs: [] }
    : { licenseRefs: ["license:closure"], attestationRefs: ["provenance:build", "evaluation:release"] };

const descriptor = ({ componentId, kind, platform, arch, logicalPath, sourcePath, executable = false }) => ({
  componentId,
  kind,
  platform,
  arch,
  logicalPath,
  sourcePath,
  ...referencesFor(kind),
  executable
});

const validCounter = (value, positive) => Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);

const validateEvaluationCounters = (evaluation, profile) => {
  if (!validCounter(evaluation.assertionCount, true))
    fail("VES_T76_BUILD_EVALUATION_INVALID", `${profile} has an invalid assertionCount`);
  if (!validCounter(evaluation.skipped, false))
    fail("VES_T76_BUILD_EVALUATION_INVALID", `${profile} has an invalid skipped count`);
  if (!validCounter(evaluation.todo, false))
    fail("VES_T76_BUILD_EVALUATION_INVALID", `${profile} has an invalid todo count`);
  if (!validCounter(evaluation.survivingMutants, false))
    fail("VES_T76_BUILD_EVALUATION_INVALID", `${profile} has an invalid survivingMutants count`);
  if (evaluation.skipped !== 0 || evaluation.todo !== 0 || evaluation.survivingMutants !== 0)
    fail("VES_T76_BUILD_EVALUATION_NOT_READY", `${profile} has incomplete or surviving evidence`);
};

const validateEvaluation = (evaluation, index, names) => {
  if (evaluation === null || typeof evaluation !== "object")
    fail("VES_T76_BUILD_EVALUATION_INVALID", `evaluation ${index} is invalid`);
  const profile = text(evaluation.profile, `evaluation ${index} profile`, /^[a-z]+$/u);
  if (!REQUIRED_PROFILES.includes(profile) || names.has(profile))
    fail("VES_T76_BUILD_EVALUATION_INCOMPLETE", "evaluations must contain each gate exactly once");
  names.add(profile);
  if (evaluation.result !== "pass") fail("VES_T76_BUILD_EVALUATION_NOT_READY", `${profile} did not pass`);
  validateEvaluationCounters(evaluation, profile);
};

const validateEvaluations = (evaluations) => {
  if (!Array.isArray(evaluations) || evaluations.length !== REQUIRED_PROFILES.length)
    fail("VES_T76_BUILD_EVALUATION_INCOMPLETE", "exactly five gate evaluations are required");
  const names = new Set();
  for (const [index, evaluation] of evaluations.entries()) validateEvaluation(evaluation, index, names);
  if (names.size !== REQUIRED_PROFILES.length)
    fail("VES_T76_BUILD_EVALUATION_INCOMPLETE", "a gate evaluation is missing");
};

const validateTarget = (target) => {
  if (target === null || typeof target !== "object") fail("VES_T76_BUILD_INPUT_INVALID", "target is required");
  const platform = text(target.platform, "target.platform", /^[a-z0-9]+$/u);
  const arch = text(target.arch, "target.arch", /^[a-z0-9]+$/u);
  const nodeVersion = text(target.nodeVersion, "target.nodeVersion", NODE_VERSION);
  if (!PLATFORMS.has(platform) || !ARCHES.has(arch)) fail("VES_T76_BUILD_TARGET_UNSUPPORTED", "target is unsupported");
  const host = hostPlatform();
  if (platform !== host.platform || arch !== host.arch || nodeVersion !== process.version.slice(1))
    fail("VES_T76_BUILD_TARGET_MISMATCH", "the requested target must match the actual build host and Node runtime");
  return Object.freeze({ platform, arch, nodeVersion });
};

const validateOptions = (options) => {
  if (options === null || typeof options !== "object")
    fail("VES_T76_BUILD_INPUT_INVALID", "build options are required");
  const repository = resolve(typeof options.repositoryRoot === "string" ? options.repositoryRoot : ROOT);
  const revision = text(options.revision, "revision", REVISION);
  const releaseId = text(options.releaseId, "releaseId", SAFE_ID);
  const semanticVersion = text(options.semanticVersion, "semanticVersion", SEMVER);
  const createdAt = text(options.createdAt, "createdAt", INSTANT);
  if (!Number.isFinite(Date.parse(createdAt))) fail("VES_T76_BUILD_INPUT_INVALID", "createdAt is invalid");
  const target = validateTarget(options.target);
  if (typeof options.outputDirectory !== "string" || options.outputDirectory.length === 0)
    fail("VES_T76_BUILD_OUTPUT_INVALID", "outputDirectory is required");
  validateEvaluations(options.evaluations);
  return Object.freeze({
    repository,
    revision,
    releaseId,
    semanticVersion,
    createdAt,
    target,
    outputDirectory: resolve(options.outputDirectory),
    evaluations: Object.freeze(options.evaluations.map((evaluation) => Object.freeze({ ...evaluation })))
  });
};

const assertRevisionAtHead = async (repository, revision) => {
  const actual = (await git(repository, ["rev-parse", "HEAD"], "VES_T76_BUILD_REVISION_INVALID"))
    .toString("utf8")
    .trim();
  if (actual !== revision)
    fail("VES_T76_BUILD_REVISION_MISMATCH", "the build repository is not at the requested exact revision");
};

const sourceDescriptors = async (options, inputRoot, paths) => {
  const descriptors = [];
  for (const path of paths.filter(isSourcePath)) {
    const kind = sourceKind(path) ?? "core-code";
    const sourcePath = `source/${path}`;
    const logicalPath = `components/${path}`;
    await writeOutput(inputRoot, sourcePath, await trackedBytes(options.repository, options.revision, path));
    descriptors.push(
      descriptor({
        componentId: path === "LICENSE" ? "license:source" : componentIdFor(logicalPath),
        kind,
        platform: "any",
        arch: "any",
        logicalPath,
        sourcePath
      })
    );
  }
  if (!descriptors.some((item) => item.kind === "license"))
    fail("VES_T76_BUILD_SOURCE_INCOMPLETE", "LICENSE is not tracked at the candidate revision");
  return descriptors;
};

const hostDescriptors = async (inputRoot, target, repository) => {
  const assets = hostAssets();
  const entries = [
    {
      componentId: "runtime:node",
      kind: "node-runtime",
      logicalPath: "runtime/node",
      sourcePath: "runtime/node",
      path: assets.node,
      executable: true
    },
    {
      componentId: "native:sqlite-vec",
      kind: "sqlite-native",
      logicalPath: "native/sqlite-vec",
      sourcePath: "native/sqlite-vec",
      path: assets.sqlite
    },
    {
      componentId: "native:cedar-wasm",
      kind: "cedar-wasm",
      logicalPath: "native/cedar-wasm.wasm",
      sourcePath: "native/cedar-wasm.wasm",
      path: assets.cedar
    },
    {
      componentId: "launcher:vestra",
      kind: "launcher",
      logicalPath: "bin/vestra.mjs",
      sourcePath: "bin/vestra.mjs",
      path: join(repository, "apps/vestra-cli/bin/vestra.mjs"),
      executable: true
    },
    {
      componentId: "launcher:verchestra",
      kind: "launcher",
      logicalPath: "bin/verchestra.mjs",
      sourcePath: "bin/verchestra.mjs",
      path: join(repository, "apps/vestra-cli/bin/verchestra.mjs"),
      executable: true
    }
  ];
  const descriptors = [];
  for (const entry of entries) {
    await writeOutput(
      inputRoot,
      entry.sourcePath,
      await readFile(entry.path).catch((error) =>
        fail("VES_T76_BUILD_SOURCE_READ_FAILED", `${entry.kind} asset cannot be read`, error)
      ),
      entry.executable ? 0o700 : 0o600
    );
    descriptors.push(
      descriptor({
        componentId: entry.componentId,
        kind: entry.kind,
        platform: entry.kind === "cedar-wasm" ? "any" : target.platform,
        arch: entry.kind === "cedar-wasm" ? "any" : target.arch,
        logicalPath: entry.logicalPath,
        sourcePath: entry.sourcePath,
        executable: entry.executable ?? false
      })
    );
  }
  return descriptors;
};

const writeMaterialization = async (output, materialized, options) => {
  await writeOutput(output, "bundle.json", canonicalBytes(materialized.bundle));
  for (const component of materialized.componentBytes)
    await writeOutput(output, `payload/${component.logicalPath}`, component.bytes);
  const components = materialized.bundle.components.map(
    ({ componentId, kind, logicalPath, contentDigest, sizeBytes }) => ({
      componentId,
      kind,
      logicalPath,
      contentDigest,
      sizeBytes
    })
  );
  await writeOutput(output, "component-manifest.json", canonicalBytes({ schemaVersion: 1, components }));
  await writeOutput(
    output,
    "build-info.json",
    canonicalBytes({
      schemaVersion: 1,
      deterministic: true,
      revision: options.revision,
      releaseId: options.releaseId,
      semanticVersion: options.semanticVersion,
      target: options.target,
      evidence: materialized.evidence.map(({ kind, logicalPath, contentDigest, sizeBytes }) => ({
        kind,
        logicalPath,
        contentDigest,
        sizeBytes
      }))
    })
  );
};

export async function buildReproducibleT76Target(rawOptions) {
  const options = validateOptions(rawOptions);
  await assertAbsent(options.outputDirectory);
  let outputCreated = false;
  let succeeded = false;
  const inputRoot = join(options.outputDirectory, "input-root");
  try {
    await mkdir(options.outputDirectory, { recursive: false, mode: 0o700 });
    outputCreated = true;
    await mkdir(inputRoot, { mode: 0o700 });
    await assertRevisionAtHead(options.repository, options.revision);
    const paths = await trackedPaths(options.repository, options.revision);
    const sources = [
      ...(await sourceDescriptors(options, inputRoot, paths)),
      ...(await hostDescriptors(inputRoot, options.target, options.repository))
    ];
    const materialized = await materializeHermeticReleaseFromFiles({
      schemaVersion: 1,
      releaseId: options.releaseId,
      semanticVersion: options.semanticVersion,
      createdAt: options.createdAt,
      target: options.target,
      runtimeResolver: false,
      rootDirectory: inputRoot,
      sources,
      revision: options.revision,
      evaluations: options.evaluations
    });
    await writeMaterialization(options.outputDirectory, materialized, options);
    succeeded = true;
    return Object.freeze({
      schemaVersion: 1,
      deterministic: true,
      revision: options.revision,
      releaseId: options.releaseId,
      semanticVersion: options.semanticVersion,
      target: options.target,
      bundle: materialized.bundle,
      evidence: materialized.evidence,
      components: materialized.bundle.components.map(
        ({ componentId, kind, logicalPath, contentDigest, sizeBytes }) => ({
          componentId,
          kind,
          logicalPath,
          contentDigest,
          sizeBytes
        })
      )
    });
  } catch (error) {
    if (error instanceof T76BuildError) throw error;
    fail("VES_T76_BUILD_FAILED", "reproducible target build failed", error);
  } finally {
    await rm(inputRoot, { recursive: true, force: true });
    if (outputCreated && !succeeded) await rm(options.outputDirectory, { recursive: true, force: true });
  }
}

const argument = (args, name) => {
  const index = args.indexOf(name);
  if (index < 0 || args[index + 1] === undefined) throw new Error(`missing ${name}`);
  return args[index + 1];
};

const runCli = async () => {
  const args = process.argv.slice(2);
  const evaluationPath = argument(args, "--evaluations");
  const parsed = JSON.parse(await readFile(resolve(evaluationPath), "utf8"));
  const evaluations = Array.isArray(parsed) ? parsed : parsed.evaluations;
  const result = await buildReproducibleT76Target({
    repositoryRoot: argument(args, "--repository"),
    revision: argument(args, "--revision"),
    releaseId: argument(args, "--release-id"),
    semanticVersion: argument(args, "--semantic-version"),
    createdAt: argument(args, "--created-at"),
    target: {
      platform: argument(args, "--platform"),
      arch: argument(args, "--arch"),
      nodeVersion: argument(args, "--node-version")
    },
    outputDirectory: argument(args, "--out"),
    evaluations
  });
  console.log(`T76 target materialized for ${result.revision}: ${result.bundle.releaseDigest}`);
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCli();
