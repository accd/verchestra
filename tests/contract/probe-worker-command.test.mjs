// invariant: S1 of .specs/features/sqlite-probe-worker/checks.md, in process.
// The Workspace is the end-to-end fixture's, set up with the real `vestra
// init`; `vestra probe worker` runs here through the CLI runner over the probe
// family's command, so its exit code is the one main() would return. The
// worker bundle is the one `scripts/build-probe-worker.mjs` writes; a case
// without it names a source layout that has not built it. The command writes a
// file on every platform, so every case runs on Windows too.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Readable } from "node:stream";
import { afterEach, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { temporaryDirectory } from "../helpers/temporary-directory.mjs";
import { linkDirectory } from "../helpers/windows-links.mjs";

const WIN32 = process.platform === "win32";
const TIMEOUT = { timeout: 600_000 };
const BUILD_SCRIPT = fileURLToPath(new URL("../../scripts/build-probe-worker.mjs", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../../apps/vestra-cli/dist/sqlite-probe-worker.mjs", import.meta.url));
const ENTRY = "probe/sqlite-worker.mjs";
const BUILD_COMMAND = "corepack pnpm build:probe-worker";

let fixtures;
let product;

before(async () => {
  execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: "pipe", windowsHide: true });
  fixtures = await import("../helpers/task-cli-fixture.mjs");
  const modules = await Promise.all([
    import("../../apps/vestra-cli/src/probe/probe-command.ts"),
    import("../../apps/vestra-cli/src/cli.ts"),
    import("../../apps/vestra-cli/src/release-manifest.ts"),
    import("../../apps/vestra-cli/src/release-layout.ts")
  ]);
  product = Object.assign({}, ...modules);
});

afterEach(() => fixtures.cleanupTaskFixtures());

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bundleBytes = () => readFile(BUNDLE);

// why: the state root the fixture's `vestra init` resolved: from the home
// directory on POSIX, which os.homedir() reads from HOME, and from the local
// application data directory on Windows.
async function inWorkspaceHome(fixture, run) {
  if (WIN32) return run({ LOCALAPPDATA: join(fixture.root, "l") });
  const home = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    return await run({ HOME: fixture.home });
  } finally {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
  }
}

// invariant: the CLI runner parses the arguments against the release manifest
// and maps a refusal to its exit code, exactly as main() does; the command bus
// is the probe family alone, with the running layout's worker bundle unless a
// case names another.
async function vestra(fixture, argv, { workerBundle } = {}) {
  const stdout = [];
  const stderr = [];
  const exitCode = await inWorkspaceHome(fixture, (env) =>
    product.runCli({
      argv: [...argv, "--output", "json"],
      invokedAs: "vestra",
      installedManifest: product.installedReleaseManifest,
      installedCliVersion: product.installedReleaseManifest.semanticVersion,
      commandBus: {
        execute: (command) =>
          product.executeProbeCommand(
            command,
            {
              controlRoot: fixture.repository,
              platform: process.platform,
              env,
              stdin: Readable.from([]),
              stderr: (value) => stderr.push(value),
              pid: process.pid
            },
            workerBundle
          )
      },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    })
  );
  const text = stdout.join("");
  return { exitCode, json: JSON.parse(text), stdout: text, stderr: stderr.join("") };
}

const writeWorker = (fixture, entry = ENTRY, options = {}) =>
  vestra(fixture, ["probe", "worker", "--engine", "sqlite", "--entry", entry], options);

function succeeded(result, label) {
  assert.equal(result.exitCode, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.json.ok, true, label);
  return result.json.data;
}

function refused(result, code, exitCode, label) {
  assert.equal(result.exitCode, exitCode, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.json.ok, false, label);
  assert.equal(result.json.error.code, code, `${label}: ${JSON.stringify(result.json.error)}`);
  return result.json.error;
}

// why: everything below the fixture root but the repository's Git directory,
// with each entry's kind and size, so a case can see that nothing was written
// in or outside the Workspace.
async function tree(root, directory = root) {
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(root, path).replaceAll("\\", "/");
    if (name === "repo/.git") continue;
    const metadata = await lstat(path);
    if (metadata.isDirectory()) entries.push(`${name}/`, ...(await tree(root, path)));
    else entries.push(`${name} ${metadata.isSymbolicLink() ? "link" : metadata.size}`);
  }
  return entries.sort();
}

const entryPath = (fixture, entry = ENTRY) => join(fixture.repository, ...entry.split("/"));

test("the worker command writes the bundled worker", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const bundle = await bundleBytes();
  const data = succeeded(await writeWorker(fixture), "probe worker");
  assert.deepEqual(data, { path: ENTRY, engine: "sqlite", digest: sha256(bundle), written: true });
  const written = await readFile(entryPath(fixture));
  assert.ok(written.equals(bundle), "the file holds exactly the bundle's bytes");
  assert.equal(data.digest, sha256(written));
});

test("a worker already written is left as it is", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const first = succeeded(await writeWorker(fixture), "first write");
  const before = await lstat(entryPath(fixture));
  const bytes = await readFile(entryPath(fixture));
  const again = succeeded(await writeWorker(fixture), "second write");
  assert.deepEqual(again, { path: ENTRY, engine: "sqlite", digest: first.digest, written: false });
  assert.ok((await readFile(entryPath(fixture))).equals(bytes), "the file's bytes are unchanged");
  assert.equal((await lstat(entryPath(fixture))).mtimeMs, before.mtimeMs, "the file was not rewritten");
});

test("a worker path holding other bytes is refused", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  await mkdir(join(fixture.repository, "probe"), { recursive: true });
  const other = Buffer.from("// another worker, written by its owner\n");
  await writeFile(entryPath(fixture), other);
  refused(await writeWorker(fixture), "VES_PROBE_WORKER_TARGET_CONFLICT", 5, "other bytes");
  assert.ok((await readFile(entryPath(fixture))).equals(other), "the file's bytes are unchanged");
  // why: a prefix of the bundle is other bytes too, not a worker to complete.
  const prefix = (await bundleBytes()).subarray(0, 64);
  await writeFile(entryPath(fixture), prefix);
  refused(await writeWorker(fixture), "VES_PROBE_WORKER_TARGET_CONFLICT", 5, "a prefix of the bundle");
  assert.ok((await readFile(entryPath(fixture))).equals(prefix), "the prefix is left as it is");
});

test("a worker path outside the Workspace, through a link, or at a directory is refused", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const outside = join(fixture.root, "outside");
  await mkdir(outside);
  // why: a symbolic link on Linux and macOS, a junction on Windows.
  await linkDirectory(outside, join(fixture.repository, "linked"));
  await mkdir(join(fixture.repository, "probe", "worker.mjs"), { recursive: true });
  const before = await tree(fixture.root);
  for (const [label, entry] of [
    ["outside the Git top level", "../outside.mjs"],
    ["outside, by an absolute path", join(fixture.root, "outside", "sqlite-worker.mjs")],
    ["through a directory link", "linked/sqlite-worker.mjs"],
    ["below a directory link", "linked/nested/sqlite-worker.mjs"],
    ["an existing directory", "probe/worker.mjs"],
    ["the Git top level itself", "."]
  ]) {
    refused(await writeWorker(fixture, entry), "VES_PROBE_WORKER_TARGET_INVALID", 5, label);
    assert.deepEqual(await tree(fixture.root), before, `${label}: nothing is written in or outside the Workspace`);
  }
  assert.deepEqual(await readdir(outside), [], "nothing is written through the link");
});

test("a worker for another engine is refused", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const before = await tree(fixture.root);
  refused(
    await vestra(fixture, ["probe", "worker", "--engine", "postgresql", "--entry", ENTRY]),
    "VES_PROBE_WORKER_ENGINE_UNSUPPORTED",
    5,
    "--engine postgresql"
  );
  assert.deepEqual(await tree(fixture.root), before, "nothing is written");
  for (const [label, argv, argument] of [
    ["no --engine", ["--entry", ENTRY], "--engine"],
    ["no --entry", ["--engine", "sqlite"], "--entry"]
  ]) {
    const error = refused(await vestra(fixture, ["probe", "worker", ...argv]), "VES_CLI_ARGUMENT_INVALID", 2, label);
    assert.equal(error.safeDetails.argument, argument, label);
    assert.deepEqual(await tree(fixture.root), before, `${label}: nothing is written`);
  }
});

test("a worker command without a built bundle names the build", TIMEOUT, async (t) => {
  const fixture = await fixtures.taskFixture();
  // why: a source layout that has not run the build: the layout resolver asked
  // from that checkout's own release-layout module finds no bundle.
  const checkout = await temporaryDirectory(t, "verchestra-unbuilt-");
  const layoutModule = pathToFileURL(join(checkout, "apps", "vestra-cli", "src", "release-layout.ts")).href;
  const missing = product.resolveSqliteProbeWorker(layoutModule);
  assert.equal(missing, join(checkout, "apps", "vestra-cli", "dist", "sqlite-probe-worker.mjs"));
  const before = await tree(fixture.root);
  const error = refused(
    await writeWorker(fixture, ENTRY, { workerBundle: () => product.resolveSqliteProbeWorker(layoutModule) }),
    "VES_PROBE_WORKER_UNAVAILABLE",
    5,
    "no bundle"
  );
  assert.ok(error.recovery.includes(BUILD_COMMAND), error.recovery);
  assert.deepEqual(await tree(fixture.root), before, "nothing is written");
  assert.deepEqual(await readdir(checkout), [], "nothing is written in the unbuilt checkout");
  // why: the running checkout's own layout resolves the bundle the build wrote.
  assert.equal(product.resolveSqliteProbeWorker(), BUNDLE);
});
