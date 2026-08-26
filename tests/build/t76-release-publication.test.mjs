import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { loadPinnedInputs } from "../../apps/vestra-launcher/src/pinned-inputs.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import {
  HttpsDistributionSource,
  NodeFilesystemDistributionSource,
  TufUpdateClient
} from "../../packages/distribution/src/tuf-update-client.ts";
import { buildVestraLauncher } from "../../scripts/build-vestra-launcher.mjs";
import {
  MANUAL_UPLOAD_STEPS,
  SUPPORTED_TARGET_KEYS,
  publishT76Release,
  releaseSignerFromEnvironment
} from "../../scripts/t76-publish-release.mjs";
import {
  PUBLICATION_BASE_URL,
  PUBLICATION_EXPIRES,
  PUBLICATION_RELEASE_ID,
  PUBLICATION_REVISION,
  PUBLICATION_SEMANTIC_VERSION,
  candidateClosure,
  disposePublicationFixtures,
  priorCandidateClosure,
  sha,
  tamperPayload,
  testSigningKeyBase64
} from "../helpers/t76-publication-fixture.mjs";

const execute = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/t76-publish-release.mjs", import.meta.url));

after(async () => {
  await disposePublicationFixtures();
});

const optionsFor = (closure, environment, rollbackIndexPath) => ({
  indexPath: closure.indexPath,
  targetsDirectory: closure.targetsDirectory,
  outputDirectory: closure.outputDirectory,
  baseUrl: PUBLICATION_BASE_URL,
  revision: closure.revision,
  expires: PUBLICATION_EXPIRES,
  rollbackIndexPath,
  protectedEnvironment: environment
});

const withKey = (key = testSigningKeyBase64()) => ({ VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64: key });

// One sealed prior closure serves every rollback index below: a different
// revision with entirely distinct payload bytes, exactly what a real
// `--rollback-index` points at.
let prior;
const sharedPrior = async () => {
  prior ??= priorCandidateClosure();
  return await prior;
};

// One published closure serves every positive assertion. Nothing below mutates
// it, so the emitted tree stays exactly what the publication produced.
let shared;
const sharedPublication = async () => {
  shared ??= (async () => {
    const rollback = await sharedPrior();
    const closure = await candidateClosure();
    const manifest = await publishT76Release(optionsFor(closure, withKey(), rollback.indexPath));
    return { closure, manifest, rollback };
  })();
  return await shared;
};

test("publishes exactly one signed TUF repository for every supported target", async () => {
  const { closure, manifest } = await sharedPublication();
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.revision, PUBLICATION_REVISION);
  assert.equal(manifest.releaseId, PUBLICATION_RELEASE_ID);
  assert.equal(manifest.semanticVersion, PUBLICATION_SEMANTIC_VERSION);
  assert.deepEqual(
    manifest.targets.map((entry) => entry.targetKey),
    [...SUPPORTED_TARGET_KEYS]
  );
  for (const entry of manifest.targets) {
    const metadata = await readdir(join(closure.outputDirectory, "publication", entry.targetKey, "metadata"));
    assert.deepEqual(metadata.sort(), [
      "1.components.json",
      "1.snapshot.json",
      "1.targets.json",
      "root.json",
      "timestamp.json"
    ]);
    assert.match(entry.candidateDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(entry.manifestPath, `releases/${entry.target.platform}-${entry.target.arch}/release.json`);
    assert.ok(entry.assetCount > metadata.length, "every target contributes metadata and target assets");
  }
});

test("one trust root serves all five targets and every metadata role is signed by the release key", async () => {
  const { closure, manifest } = await sharedPublication();
  const roots = [];
  for (const entry of manifest.targets)
    roots.push(await readFile(join(closure.outputDirectory, "publication", entry.targetKey, "metadata", "root.json")));
  assert.equal(new Set(roots.map((bytes) => sha(bytes))).size, 1);
  assert.equal(sha(roots[0]), manifest.rootDigest);
  const root = JSON.parse(roots[0].toString("utf8"));
  assert.equal(root.signatures.length, 1);
  assert.equal(root.signatures[0].keyid, manifest.signingKeyId);
  assert.deepEqual(Object.keys(root.signed.roles).sort(), ["root", "snapshot", "targets", "timestamp"]);
  for (const role of Object.values(root.signed.roles)) assert.deepEqual(role.keyids, [manifest.signingKeyId]);
});

test("the upload manifest names every asset, its digest, and the remote key it must land at", async () => {
  const { closure, manifest } = await sharedPublication();
  assert.equal(manifest.host, "r2");
  assert.equal(manifest.baseUrl, PUBLICATION_BASE_URL);
  assert.deepEqual(manifest.steps, [...MANUAL_UPLOAD_STEPS]);
  for (const entry of manifest.targets) {
    assert.equal(entry.metadataBaseUrl, `${PUBLICATION_BASE_URL}${entry.targetKey}/metadata/`);
    assert.equal(entry.targetBaseUrl, `${PUBLICATION_BASE_URL}${entry.targetKey}/targets/`);
    assert.equal(entry.assets.length, entry.assetCount);
    for (const asset of entry.assets) {
      // The remote key mirrors the emitted tree byte for byte, so copying
      // publication/ to the prefix the base URL serves is the whole upload.
      assert.equal(asset.remoteKey, `${entry.targetKey}/${asset.area}/${asset.assetName}`);
      assert.equal(asset.path, `publication/${asset.remoteKey}`);
      const bytes = await readFile(join(closure.outputDirectory, ...asset.path.split("/")));
      assert.equal(sha(bytes), asset.contentDigest, `${asset.path} must match its declared digest`);
      assert.equal(bytes.byteLength, asset.sizeBytes);
      assert.equal(asset.path.endsWith(`/${asset.assetName}`), true);
    }
  }
});

test("the single emitted release inputs cover every target and satisfy the launcher contract", async () => {
  const { closure, manifest } = await sharedPublication();
  const inputs = join(closure.outputDirectory, "release-inputs");
  assert.deepEqual((await readdir(inputs)).sort(), ["release-source.json", "root.json"]);
  const emitted = JSON.parse(await readFile(join(inputs, "release-source.json"), "utf8"));
  assert.equal(emitted.schemaVersion, 2);
  assert.equal(emitted.sourceId, "source:online:r2");
  assert.equal(emitted.releaseId, PUBLICATION_RELEASE_ID);
  assert.equal(emitted.semanticVersion, PUBLICATION_SEMANTIC_VERSION);
  assert.equal(emitted.rootDigest, sha(await readFile(join(inputs, "root.json"))));
  assert.equal(emitted.rootDigest, manifest.rootDigest);
  assert.deepEqual(Object.keys(emitted.targets), [...SUPPORTED_TARGET_KEYS]);
  for (const [key, locations] of Object.entries(emitted.targets)) {
    assert.equal(locations.metadataBaseUrl, `${PUBLICATION_BASE_URL}${key}/metadata/`);
    assert.equal(locations.targetBaseUrl, `${PUBLICATION_BASE_URL}${key}/targets/`);
  }

  // The cross-contract proof: the exact bytes this script emits are the bytes
  // the launcher's own pinned-input loader accepts.
  const packageRoot = join(closure.root, "pinned-contract");
  await mkdir(join(packageRoot, "config"), { recursive: true });
  for (const name of ["release-source.json", "root.json"])
    await writeFile(join(packageRoot, "config", name), await readFile(join(inputs, name)));
  const pinned = await loadPinnedInputs(packageRoot);
  assert.deepEqual(pinned.source, emitted);

  const receipt = await buildVestraLauncher({
    releaseInputs: inputs,
    outputDirectory: join(closure.root, "launcher-package")
  });
  assert.equal(receipt.packageName, "verchestra");
  assert.equal(receipt.packageVersion, PUBLICATION_SEMANTIC_VERSION);
  const packaged = JSON.parse(await readFile(join(receipt.outputDirectory, "config", "release-source.json"), "utf8"));
  assert.deepEqual(packaged, emitted);
});

test("every published target repository resolves and stages through the TUF client", async () => {
  // Cross-platform staging: any host can stage any published target, so the
  // Windows repository and a non-Windows repository are both resolved here
  // regardless of which platform runs the suite.
  const { closure } = await sharedPublication();
  const trustedRoot = await readFile(join(closure.outputDirectory, "release-inputs", "root.json"));
  for (const [key, platform, arch] of [
    ["win32-x64", "win32", "x64"],
    ["linux-arm64", "linux", "arm64"]
  ]) {
    const scratch = await mkdtemp(join(tmpdir(), "verchestra-t76-stage-"));
    try {
      const staged = await new TufUpdateClient({
        trustRootDirectory: join(scratch, "trust"),
        stagingRoot: join(scratch, "staging"),
        trustedRoot,
        source: new NodeFilesystemDistributionSource({
          mode: "offline",
          sourceId: "source:offline:r2",
          root: join(closure.outputDirectory, "publication", key)
        })
      }).resolveAndStage({ platform, arch });
      const { bundle } = closure.targets.find(
        (item) => `${item.bundle.target.platform}-${item.bundle.target.arch}` === key
      );
      assert.equal(staged.releaseDigest, bundle.releaseDigest);
      assert.deepEqual(
        staged.components.map((component) => component.logicalPath).sort(),
        bundle.components.map((component) => component.logicalPath).sort()
      );
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
});

test("the emitted manifest exposes the four sealed release views for every target", async () => {
  // RC-02 requires exactly one view per source mode, all naming one release.
  // The candidate seals that into `candidateDigest`; this asserts a reviewer
  // holding only the emitted artifacts can check it without trusting a digest.
  const { closure, manifest } = await sharedPublication();
  for (const entry of manifest.targets) {
    const { bundle } = closure.targets.find(
      (item) => `${item.bundle.target.platform}-${item.bundle.target.arch}` === entry.targetKey
    );
    assert.deepEqual(
      entry.views.map((view) => view.mode),
      ["air-gapped", "mirror", "offline", "online"]
    );
    for (const view of entry.views) {
      assert.deepEqual(Object.keys(view).sort(), [
        "metadataDigest",
        "mode",
        "releaseDigest",
        "sourceId",
        "targetDigest"
      ]);
      assert.equal(view.releaseDigest, bundle.releaseDigest);
      assert.equal(view.sourceId, `source:${view.mode}:r2`);
      assert.equal(view.metadataDigest, entry.views[0].metadataDigest);
      assert.equal(view.targetDigest, entry.views[0].targetDigest);
    }
  }
});

test("one published tree resolves to one closure through the HTTPS and filesystem adapters", async () => {
  // The four-view claim is that online, mirror, offline, and air-gapped resolve
  // the same release. Elsewhere that is exercised with a source double whose
  // mode is a constructor label over one byte source. Here the two REAL
  // adapters read the one emitted publication tree by their own transports —
  // HTTP 200 metadata and 206 byte ranges against the manifest's remote keys,
  // and filesystem reads against the same directory — and must agree on the
  // whole closure, component for component.
  const { closure, manifest } = await sharedPublication();
  const trustedRoot = await readFile(join(closure.outputDirectory, "release-inputs", "root.json"));
  const key = "win32-x64";
  const entry = manifest.targets.find((item) => item.targetKey === key);
  const { bundle } = closure.targets.find(
    (item) => `${item.bundle.target.platform}-${item.bundle.target.arch}` === key
  );

  // Serves exactly what the manifest says must land at each remote key, with
  // the response shape the pinned HTTPS source requires.
  // The base URL names a prefix inside the store, so a request's remote key is
  // its path relative to that prefix - the same mapping a real object store
  // applies, and the one the manifest's remote keys are written against.
  const basePrefix = new URL(PUBLICATION_BASE_URL).pathname;
  const servedKeys = [];
  const endpoint = async (input, init = {}) => {
    const remoteKey = new URL(input).pathname
      .slice(basePrefix.length)
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent)
      .join("/");
    const asset = entry.assets.find((item) => item.remoteKey === remoteKey);
    if (!asset) return new Response(null, { status: 404 });
    servedKeys.push(remoteKey);
    const bytes = await readFile(join(closure.outputDirectory, ...asset.path.split("/")));
    if (asset.area === "metadata")
      return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
    const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get("range") ?? "");
    if (!range) return new Response(null, { status: 416 });
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), bytes.length - 1);
    const chunk = bytes.subarray(start, end + 1);
    return new Response(chunk, {
      status: 206,
      headers: {
        "content-length": String(chunk.length),
        "content-range": `bytes ${start}-${end}/${bytes.length}`
      }
    });
  };

  const scratch = await mkdtemp(join(tmpdir(), "verchestra-t76-views-"));
  try {
    const stage = (name, source) =>
      new TufUpdateClient({
        trustRootDirectory: join(scratch, name, "trust"),
        stagingRoot: join(scratch, name, "staging"),
        trustedRoot,
        source
      }).resolveAndStage({ platform: "win32", arch: "x64" });

    const online = await stage(
      "online",
      new HttpsDistributionSource({
        mode: "online",
        sourceId: "source:online:r2",
        metadataBaseUrl: entry.metadataBaseUrl,
        targetBaseUrl: entry.targetBaseUrl,
        fetch: endpoint
      })
    );
    const offline = await stage(
      "offline",
      new NodeFilesystemDistributionSource({
        mode: "offline",
        sourceId: "source:offline:r2",
        root: join(closure.outputDirectory, "publication", key)
      })
    );

    assert.equal(online.sourceMode, "online");
    assert.equal(offline.sourceMode, "offline");
    assert.ok(servedKeys.length > 0, "the online staging must have gone through the HTTPS transport");
    assert.equal(online.releaseDigest, bundle.releaseDigest);
    assert.equal(offline.releaseDigest, online.releaseDigest);
    assert.deepEqual(online.bundle, offline.bundle);
    assert.deepEqual(online.components, offline.components);
    const byCodeUnits = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
    assert.deepEqual(
      online.components.map((component) => component.logicalPath).sort(byCodeUnits),
      bundle.components.map((component) => component.logicalPath).sort(byCodeUnits)
    );
    const sealed = entry.views.find((view) => view.mode === "online");
    assert.equal(sealed.releaseDigest, online.releaseDigest);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("refuses a closure that does not cover all five supported targets", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure({ omitTargets: ["linux-arm64"] });
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_CLOSURE_INCOMPLETE"
  });
});

test("refuses targets that disagree on release identity or revision", async () => {
  const rollback = await sharedPrior();
  const mixedRelease = await candidateClosure({
    bundleOverrides: { "win32-x64": { releaseId: "release:verchestra:1.0.0:other" } }
  });
  await assert.rejects(() => publishT76Release(optionsFor(mixedRelease, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_CLOSURE_INCONSISTENT"
  });
  const mixedRevision = await candidateClosure({
    revisionOverrides: { "linux-x64": "c".repeat(40) }
  });
  await assert.rejects(() => publishT76Release(optionsFor(mixedRevision, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_CLOSURE_INCONSISTENT"
  });
});

test("refuses a payload byte that contradicts its sealed component digest", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  await tamperPayload(closure, "darwin-x64", "core:verchestra");
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_DIGEST_MISMATCH"
  });
});

test("refuses a reconciled index that is re-serialized or whose digest no longer covers its targets", async () => {
  const rollback = await sharedPrior();
  const rewritten = await candidateClosure();
  const index = JSON.parse(await readFile(rewritten.indexPath, "utf8"));
  await writeFile(rewritten.indexPath, `${JSON.stringify(index, null, 2)}\n`);
  await assert.rejects(() => publishT76Release(optionsFor(rewritten, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_INPUT_INVALID"
  });
  const forged = await candidateClosure();
  const forgedIndex = JSON.parse(await readFile(forged.indexPath, "utf8"));
  forgedIndex.digest = sha("not-the-closure");
  await writeFile(forged.indexPath, `${canonicalizeJsonV2(forgedIndex)}\n`);
  await assert.rejects(() => publishT76Release(optionsFor(forged, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_DIGEST_MISMATCH"
  });
});

test("refuses every invalid base URL before any output directory is created", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  const invalid = [
    "http://releases.example.invalid/verchestra/",
    "https://user:secret@releases.example.invalid/verchestra/",
    "https://releases.example.invalid/verchestra/?channel=stable",
    "https://releases.example.invalid/verchestra/#latest",
    "https://releases.example.invalid/verchestra",
    "https://releases.example.invalid/${TARGET_KEY}/",
    `https://releases.example.invalid/${"a".repeat(512)}/`
  ];
  for (const baseUrl of invalid) {
    await assert.rejects(
      () => publishT76Release({ ...optionsFor(closure, withKey(), rollback.indexPath), baseUrl }),
      { code: "VES_T76_PUBLISH_BASE_URL_INVALID" },
      `${baseUrl.slice(0, 60)} must be refused`
    );
  }
  await assert.rejects(() => readdir(closure.outputDirectory), { code: "ENOENT" });
});

test("refuses a rollback index that does not seal a prior release for every supported target", async () => {
  const incomplete = await priorCandidateClosure({ omitTargets: ["darwin-x64"] });
  const closure = await candidateClosure();
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), incomplete.indexPath)), {
    code: "VES_T76_PUBLISH_ROLLBACK_INCOMPLETE"
  });
  await assert.rejects(() => readdir(closure.outputDirectory), { code: "ENOENT" });
});

test("refuses a rollback index that is re-serialized or that seals the published revision", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  const reserializedPath = join(closure.root, "reserialized-rollback-index.json");
  const priorIndex = JSON.parse(await readFile(rollback.indexPath, "utf8"));
  await writeFile(reserializedPath, `${JSON.stringify(priorIndex, null, 2)}\n`);
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), reserializedPath)), {
    code: "VES_T76_PUBLISH_INPUT_INVALID"
  });
  // The current closure's own index is canonical and complete, but it seals
  // the revision being published, so it can never be its own rollback target.
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), closure.indexPath)), {
    code: "VES_T76_PUBLISH_INPUT_INVALID"
  });
  await assert.rejects(() => readdir(closure.outputDirectory), { code: "ENOENT" });
});

test("refuses a rollback target whose prior digest equals the candidate release digest", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  const priorIndex = JSON.parse(await readFile(rollback.indexPath, "utf8"));
  const current = closure.targets.find((item) => item.bundle.target.platform === "win32");
  for (const entry of priorIndex.targets) {
    if (entry.target.platform === "win32" && entry.target.arch === "x64")
      entry.releaseDigest = current.evidence.releaseDigest;
  }
  priorIndex.digest = sha(canonicalizeJsonV2(priorIndex.targets));
  const forgedPath = join(closure.root, "same-digest-rollback-index.json");
  await writeFile(forgedPath, `${canonicalizeJsonV2(priorIndex)}\n`);
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), forgedPath)), {
    code: "VES_T76_PUBLISH_CANDIDATE_INVALID"
  });
});

test("refuses a missing signing key before any output directory is created", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  await assert.rejects(() => publishT76Release(optionsFor(closure, {}, rollback.indexPath)), {
    code: "VES_T76_PUBLISH_SIGNING_KEY_MISSING"
  });
  await assert.rejects(() => readdir(closure.outputDirectory), { code: "ENOENT" });
});

test("refuses every malformed signing key shape", async () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const key of [
    "not base64 at all",
    "YWJj",
    Buffer.from("still not pkcs8").toString("base64"),
    rsa.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")
  ])
    assert.throws(() => releaseSignerFromEnvironment(withKey(key)), { code: "VES_T76_PUBLISH_SIGNING_KEY_INVALID" });
  assert.throws(() => releaseSignerFromEnvironment({}), { code: "VES_T76_PUBLISH_SIGNING_KEY_MISSING" });
});

test("a signing-key failure carries no cause chain that could echo key material", () => {
  const error = (() => {
    try {
      releaseSignerFromEnvironment(withKey(Buffer.from("still not pkcs8").toString("base64")));
    } catch (thrown) {
      return thrown;
    }
    return undefined;
  })();
  assert.equal(error.code, "VES_T76_PUBLISH_SIGNING_KEY_INVALID");
  assert.equal(error.cause, undefined);
  assert.equal(error.message.includes("still"), false);
});

test("refuses to overwrite an existing publication output", async () => {
  const { closure, rollback } = await sharedPublication();
  await assert.rejects(() => publishT76Release(optionsFor(closure, withKey(), rollback.indexPath)), {
    code: "VES_T76_PUBLISH_OUTPUT_EXISTS"
  });
});

test("the command line never emits key material on success or on failure", async () => {
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  const key = testSigningKeyBase64();
  const args = [
    SCRIPT,
    "--index",
    closure.indexPath,
    "--targets",
    closure.targetsDirectory,
    "--out",
    closure.outputDirectory,
    "--base-url",
    PUBLICATION_BASE_URL,
    "--revision",
    closure.revision,
    "--expires",
    PUBLICATION_EXPIRES,
    "--rollback-index",
    rollback.indexPath
  ];
  const run = async (environment) =>
    await execute(process.execPath, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...environment }
    }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));

  const secrets = [key, key.slice(0, 32), Buffer.from(key, "base64").toString("hex")];
  const success = await run({ VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64: key });
  const combined = `${success.stdout}${success.stderr}`;
  for (const secret of secrets) assert.equal(combined.includes(secret), false, "no key material may reach a log");
  assert.match(success.stdout, /"signingKeyId"/u);

  const emitted = JSON.parse(await readFile(join(closure.outputDirectory, "publication-manifest.json"), "utf8"));
  const serialized = JSON.stringify(emitted);
  for (const secret of secrets)
    assert.equal(serialized.includes(secret), false, "no key material may reach an artifact");

  const failure = await run({ VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64: `${key}!!` });
  const failed = `${failure.stdout}${failure.stderr}`;
  for (const secret of secrets) assert.equal(failed.includes(secret), false, "a rejected key may not be echoed");
  assert.match(failed, /VES_T76_PUBLISH_SIGNING_KEY_INVALID/u);
});
