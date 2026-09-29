import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";

import { BINARY_MANIFEST, SEA_SETTINGS, buildVestraBinary } from "../../scripts/build-vestra-binary.mjs";
import { loadNodeRuntimePins, sha256Of } from "../../scripts/node-runtime-archive.mjs";
import { locateSeaBlob } from "../../scripts/sea-inject.mjs";
import { createUpdateKeys, serialize } from "../helpers/tuf-update-fixture.mjs";
import {
  FLEET_TARGET_KEYS,
  disposeLauncherFixtures,
  fixtureReleaseSource,
  pinnedInputDirectory
} from "../helpers/vestra-launcher-fixture.mjs";

// why: #236 promises one executable that runs the npm launcher's exact
// bootstrap with no `node` anywhere on the machine. This builds the host
// target from the pinned official runtime, twice, and proves the artifact
// rather than the build options: identical bytes, a manifest that names every
// byte, a `--version` answered with PATH emptied, and a run that reaches the
// real TUF activation path — anchoring a signed fixture root and dialing the
// pinned source — with PATH emptied and HOME redirected to a disposable root.
//
// The runtime comes from the pinned archive in the Node distribution cache
// (VES_NODE_DIST_CACHE, else ~/.cache/node-dist), or from the running Node when
// its bytes are the pinned official executable, as they are on every CI
// runner. A host with neither cannot build a verified binary, and only that
// case is skipped, with the reason stated.

const HOST = `${process.platform}-${process.arch}`;
const CACHE = process.env["VES_NODE_DIST_CACHE"] ?? join(homedir(), ".cache", "node-dist");
const roots = [];

const scratch = async (prefix) => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
};

async function verifiedRuntimeSource() {
  const pins = await loadNodeRuntimePins();
  const pin = pins.targets[HOST];
  if (pin === undefined) return { skip: `${HOST} is not a supported single-binary target` };
  if (existsSync(join(CACHE, pin.archive.fileName))) return { nodeCache: CACHE };
  if (sha256Of(await readFile(process.execPath)) === pin.executable.sha256) return { nodeExecutable: process.execPath };
  return {
    skip: `no verified Node ${pins.version} runtime for ${HOST}: ${pin.archive.fileName} is not in the distribution cache and the running Node is not the pinned official executable`
  };
}

const source = await verifiedRuntimeSource();
const requiresRuntime = { skip: source.skip ?? false };

// invariant: the pinned inputs carry a genuinely anchoring TUF root, signed with
// the repository's TUF fixture keys, and pin every target to a loopback
// listener, so the activation path runs for real and no byte leaves the host.
const listener = { connections: 0, server: undefined, port: 0 };
let inputs;
let rootDigest;
let first;
let second;

async function signedPinnedInputs(port) {
  const [key] = createUpdateKeys(1);
  const role = { keyids: [key.id], threshold: 1 };
  const trustedRoot = serialize(
    {
      _type: "root",
      spec_version: "1.0.0",
      version: 1,
      expires: "2035-01-01T00:00:00.000Z",
      keys: { [key.id]: { keytype: "ed25519", scheme: "ed25519", keyval: { public: key.publicPem } } },
      roles: { root: role, timestamp: role, snapshot: role, targets: role },
      consistent_snapshot: true
    },
    [key],
    1
  );
  rootDigest = sha256Of(trustedRoot);
  const targets = Object.fromEntries(
    [...new Set([...FLEET_TARGET_KEYS, HOST])].map((target) => [
      target,
      {
        metadataBaseUrl: `https://127.0.0.1:${port}/${target}/metadata/`,
        targetBaseUrl: `https://127.0.0.1:${port}/${target}/targets/`
      }
    ])
  );
  return await pinnedInputDirectory({
    trustedRoot,
    source: fixtureReleaseSource({ rootDigest: `sha256:${rootDigest}`, targets })
  });
}

before(async () => {
  listener.server = createServer((socket) => {
    listener.connections += 1;
    socket.destroy();
  });
  await new Promise((resolve) => listener.server.listen(0, "127.0.0.1", resolve));
  listener.port = listener.server.address().port;
  inputs = await signedPinnedInputs(listener.port);
});

after(async () => {
  await new Promise((resolve) => listener.server?.close(resolve));
  await disposeLauncherFixtures();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  );
});

const build = async () =>
  await buildVestraBinary({
    target: HOST,
    ...source,
    releaseInputs: inputs,
    outputDirectory: join(await scratch("verchestra-binary-"), "out")
  });

const builtOnce = async () => (first ??= await build());

async function tree(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await tree(root, path)));
    else files.push({ path: relative(root, path).replaceAll("\\", "/"), digest: sha256Of(await readFile(path)) });
  }
  return files.sort((left, right) => (left.path < right.path ? -1 : 1));
}

/**
 * why: the whole point of the channel is that no ambient Node exists, so the
 * child sees an empty PATH and a disposable HOME and nothing else — except the
 * one variable Windows needs to reach its own networking stack.
 */
function runBinary(receipt, args, home, extra = {}) {
  const env = { PATH: "", HOME: home, USERPROFILE: home, ...extra };
  if (process.platform === "win32") env["SystemRoot"] = process.env["SystemRoot"];
  return new Promise((resolve) => {
    execFile(
      join(receipt.outputDirectory, receipt.executable.path),
      args,
      { env, encoding: "utf8", windowsHide: true, timeout: 120_000 },
      (error, stdout, stderr) => resolve({ status: error ? error.code : 0, stdout, stderr })
    );
  });
}

async function findFile(root, name) {
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name === name) return join(entry.parentPath, entry.name);
  }
  return undefined;
}

test("two builds from identical inputs emit byte-identical trees", requiresRuntime, async () => {
  const one = await builtOnce();
  second ??= await build();
  assert.notEqual(one.outputDirectory, second.outputDirectory);
  const [left, right] = [await tree(one.outputDirectory), await tree(second.outputDirectory)];
  assert.deepEqual(
    left.map((file) => file.path),
    [
      one.executable.path,
      "licenses/LICENSE",
      "licenses/THIRD-PARTY-NOTICES",
      "licenses/node.LICENSE",
      BINARY_MANIFEST
    ].sort()
  );
  assert.deepEqual(right, left);
});

test(
  "the manifest names the verified runtime, the launcher bundle, the blob, and every emitted byte",
  requiresRuntime,
  async () => {
    const receipt = await builtOnce();
    const text = await readFile(join(receipt.outputDirectory, BINARY_MANIFEST), "utf8");
    const manifest = JSON.parse(text);
    const pins = await loadNodeRuntimePins();
    const pin = pins.targets[HOST];
    const executable = await readFile(join(receipt.outputDirectory, receipt.executable.path));

    assert.deepEqual(manifest.target, { platform: process.platform, arch: process.arch });
    assert.equal(manifest.executable.contentDigest, `sha256:${sha256Of(executable)}`);
    assert.equal(manifest.executable.signature, process.platform === "darwin" ? "ad-hoc" : "none");
    assert.equal(manifest.runtime.version, "24.14.0");
    assert.equal(manifest.runtime.archive.contentDigest, `sha256:${pin.archive.sha256}`);
    assert.equal(manifest.runtime.executable.contentDigest, `sha256:${pin.executable.sha256}`);
    assert.equal(manifest.runtime.verifiedBy, source.nodeCache === undefined ? "installation" : "archive");
    assert.equal(manifest.release.rootDigest, `sha256:${rootDigest}`);

    const { format, blob } = locateSeaBlob(executable);
    assert.equal(manifest.executable.format, format);
    assert.equal(manifest.sea.blob.contentDigest, `sha256:${sha256Of(blob)}`, "the recorded blob is the embedded blob");
    assert.ok(blob.includes(Buffer.from(manifest.launcherBundle.path)), "the blob names the recorded main script");
    for (const [setting, value] of Object.entries(SEA_SETTINGS)) assert.equal(manifest.sea[setting], value, setting);
    const inputBytes = {
      "config/release-source.json": await readFile(join(inputs, "release-source.json")),
      "config/root.json": await readFile(join(inputs, "root.json"))
    };
    for (const asset of manifest.sea.assets)
      assert.equal(asset.contentDigest, `sha256:${sha256Of(inputBytes[asset.path])}`);

    for (const license of manifest.licenses) {
      const bytes = await readFile(join(receipt.outputDirectory, ...license.path.split("/")));
      assert.equal(license.contentDigest, `sha256:${sha256Of(bytes)}`, license.path);
    }
    const notices = await readFile(join(receipt.outputDirectory, "licenses", "THIRD-PARTY-NOTICES"), "utf8");
    const bundled = manifest.sbom.components.filter((component) => component.purl?.startsWith("pkg:npm/"));
    assert.ok(
      bundled.some((component) => component.name === "tuf-js"),
      "the TUF client is a named SBOM component"
    );
    for (const component of bundled)
      assert.ok(notices.includes(`${component.name}@${component.version}`), component.name);
    const runtime = manifest.sbom.components.find((component) => component["bom-ref"] === "runtime:node");
    assert.deepEqual(runtime.hashes, [{ alg: "SHA-256", content: pin.executable.sha256 }]);

    assert.doesNotMatch(
      text,
      /[A-Za-z]:\\|\/(?:home|Users|private|var|tmp)\//u,
      "the manifest records no machine-local path"
    );
  }
);

test("with PATH emptied, --version is answered by the embedded runtime alone", requiresRuntime, async () => {
  const receipt = await builtOnce();
  const home = await scratch("verchestra-binary-home-");
  // invariant: the blob disables execution-argument extension, so an ambient
  // NODE_OPTIONS that would load code into any ordinary `node` is ignored.
  const hostile = { NODE_OPTIONS: `--require ${join(home, "injected-by-environment.cjs")}` };
  const result = await runBinary(receipt, ["--version"], home, hostile);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    `vestra ${fixtureReleaseSource().semanticVersion} (single binary; ${HOST}; node v24.14.0)\n`
  );
  assert.equal(result.status, 0);
});

test(
  "with PATH emptied, a run anchors the embedded trust root and reaches the pinned TUF source",
  requiresRuntime,
  async () => {
    const receipt = await builtOnce();
    const home = await scratch("verchestra-binary-home-");
    const dialed = listener.connections;
    const result = await runBinary(receipt, ["self-test", "--profile", "smoke"], home);

    assert.equal(result.status, 70, "an unreachable release source is a deterministic activation failure");
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^VES_VESTRA_ACTIVATION_UNAVAILABLE: .*\(VES_TUF_[A-Z_]+\)\. /u);
    assert.ok(listener.connections > dialed, "the binary dialed the pinned loopback source");
    const anchor = await findFile(home, "bootstrap-root.sha256");
    assert.ok(anchor !== undefined, "the embedded trust root was anchored under the redirected home");
    assert.equal(await readFile(anchor, "utf8"), `sha256:${rootDigest}`);
  }
);

test("the build refuses a runtime that is not the pinned official binary", async () => {
  const cache = await scratch("verchestra-binary-cache-");
  const pins = await loadNodeRuntimePins();
  const target = pins.targets[HOST] === undefined ? "linux-x64" : HOST;
  await writeFile(join(cache, pins.targets[target].archive.fileName), "not the official archive");
  await assert.rejects(
    buildVestraBinary({
      target,
      nodeCache: cache,
      releaseInputs: await pinnedInputDirectory(),
      outputDirectory: join(cache, "out")
    }),
    { code: "VES_BINARY_RUNTIME_DIGEST_MISMATCH" }
  );
  assert.equal(existsSync(join(cache, "out")), false, "a refused build leaves no output behind");

  const fake = join(cache, "bin", "node");
  await mkdir(join(cache, "bin"));
  await writeFile(fake, "not the official runtime");
  await assert.rejects(
    buildVestraBinary({
      target,
      nodeExecutable: fake,
      releaseInputs: await pinnedInputDirectory(),
      outputDirectory: join(cache, "out")
    }),
    { code: "VES_BINARY_RUNTIME_DIGEST_MISMATCH" }
  );
});

test("the build refuses pinned inputs the launcher itself would refuse, before reading any runtime", async () => {
  const root = await scratch("verchestra-binary-inputs-");
  const plaintext = Object.fromEntries(
    FLEET_TARGET_KEYS.map((key) => [
      key,
      {
        metadataBaseUrl: `http://releases.example.invalid/${key}/`,
        targetBaseUrl: `https://releases.example.invalid/${key}/`
      }
    ])
  );
  await assert.rejects(
    buildVestraBinary({
      target: "linux-x64",
      nodeCache: join(root, "no-runtime-here"),
      releaseInputs: await pinnedInputDirectory({ sourceOverrides: { targets: plaintext } }),
      outputDirectory: join(root, "out")
    }),
    { code: "VES_BINARY_INPUTS_INVALID" }
  );
  assert.equal(existsSync(join(root, "out")), false);
});

test("the build refuses unsupported targets, ambiguous runtimes, missing inputs, and existing output", async () => {
  const root = await scratch("verchestra-binary-refusal-");
  const base = {
    target: "linux-x64",
    nodeCache: root,
    releaseInputs: await pinnedInputDirectory(),
    outputDirectory: join(root, "out")
  };
  await assert.rejects(buildVestraBinary({ ...base, target: "win32-arm64" }), {
    code: "VES_BINARY_TARGET_UNSUPPORTED"
  });
  await assert.rejects(buildVestraBinary({ ...base, nodeExecutable: process.execPath }), {
    code: "VES_BINARY_RUNTIME_UNAVAILABLE"
  });
  await assert.rejects(buildVestraBinary({ ...base, nodeCache: undefined }), {
    code: "VES_BINARY_RUNTIME_UNAVAILABLE"
  });
  await assert.rejects(buildVestraBinary({ ...base, releaseInputs: undefined }), { code: "VES_BINARY_INPUTS_MISSING" });
  await assert.rejects(buildVestraBinary({ ...base, outputDirectory: root }), { code: "VES_BINARY_OUTPUT_EXISTS" });
});
