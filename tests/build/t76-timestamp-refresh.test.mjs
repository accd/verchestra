import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { promisify } from "node:util";

import { TufUpdateClient } from "../../packages/distribution/src/tuf-update-client.ts";
import { SUPPORTED_TARGET_KEYS, publishT76Release } from "../../scripts/t76-publish-release.mjs";
import { REFRESH_UPLOAD_STEPS, refreshT76Timestamp } from "../../scripts/t76-refresh-timestamp.mjs";
import {
  PUBLICATION_LEDGER_SCHEMA,
  ledgerEntryDigest,
  nextLedgerEntry,
  validatePublicationLedger
} from "../../scripts/tuf-publication-ledger.mjs";
import {
  PUBLICATION_BASE_URL,
  PUBLICATION_EXPIRES,
  PUBLICATION_RELEASE_ID,
  PUBLICATION_SEMANTIC_VERSION,
  candidateClosure,
  disposePublicationFixtures,
  priorCandidateClosure,
  sha,
  testSigningKeyBase64,
  writeMatchingReleaseAnchor,
  writeRetiredAnchorCopy
} from "../helpers/t76-publication-fixture.mjs";
import { FixtureDistributionSource } from "../helpers/tuf-update-fixture.mjs";

const execute = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../../scripts/t76-refresh-timestamp.mjs", import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const OFFLINE = "VESTRA_RELEASE_SIGNING_KEY_PKCS8_BASE64";
const ONLINE = "VESTRA_RELEASE_TIMESTAMP_SIGNING_KEY_PKCS8_BASE64";
const TIMESTAMP_PURPOSE = "tuf-timestamp-snapshot";

const scratchRoots = [];
after(async () => {
  await disposePublicationFixtures();
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10 })));
});

const scratch = async (label) => {
  const root = await mkdtemp(join(tmpdir(), `verchestra-t76-refresh-${label}-`));
  scratchRoots.push(root);
  return root;
};

const iso = (milliseconds) => new Date(milliseconds).toISOString();

// why: a hash-chained ledger built through the same helper the refresh uses to emit
// its entry. Each entry defaults to a release that records nothing but what the
// test states.
const writeLedger = async (directory, entries) => {
  const ledger = { schema: PUBLICATION_LEDGER_SCHEMA, policy: "test ledger", entries: [] };
  for (const fields of entries)
    ledger.entries.push(
      nextLedgerEntry(ledger, {
        kind: "release",
        releaseId: null,
        semanticVersion: PUBLICATION_SEMANTIC_VERSION,
        baseUrl: null,
        urlPrefix: null,
        rootDigest: null,
        rootDigestPrefix: null,
        roles: { root: 1, snapshot: 1, targets: 1, timestamp: 1 },
        publicationRunId: null,
        evidence: ["docs/qualification/tuf-publication-ledger.json"],
        ...fields
      })
    );
  const path = join(directory, `ledger-${entries.length}-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(path, `${JSON.stringify(ledger, null, 2)}\n`);
  return path;
};

let prior;
const sharedPrior = async () => {
  prior ??= priorCandidateClosure();
  return await prior;
};

// why: one role-separated lineage: the offline key signs root and targets, the
// distinct online key signs timestamp and snapshot, each bound to its own
// throwaway anchor, published at metadata version 1.
const publishLineage = async ({ timestampExpires } = {}) => {
  const offline = testSigningKeyBase64();
  const online = testSigningKeyBase64();
  const rollback = await sharedPrior();
  const closure = await candidateClosure();
  const releaseAnchorPath = writeMatchingReleaseAnchor(closure.root, offline);
  const timestampAnchorPath = writeMatchingReleaseAnchor(closure.root, online, TIMESTAMP_PURPOSE);
  const manifest = await publishT76Release({
    indexPath: closure.indexPath,
    targetsDirectory: closure.targetsDirectory,
    outputDirectory: closure.outputDirectory,
    baseUrl: PUBLICATION_BASE_URL,
    revision: closure.revision,
    expires: PUBLICATION_EXPIRES,
    timestampExpires,
    metadataVersion: 1,
    rootVersion: 1,
    rollbackIndexPath: rollback.indexPath,
    ledgerPath: await writeLedger(closure.root, []),
    protectedEnvironment: { [OFFLINE]: offline, [ONLINE]: online },
    releaseAnchorPath,
    timestampAnchorPath
  });
  const release = {
    releaseId: manifest.releaseId,
    semanticVersion: manifest.semanticVersion,
    baseUrl: manifest.baseUrl,
    rootDigest: manifest.rootDigest
  };
  return {
    closure,
    manifest,
    offline,
    online,
    release,
    releaseAnchorPath,
    timestampAnchorPath
  };
};

let lineage;
const sharedLineage = async () => {
  lineage ??= publishLineage();
  return await lineage;
};

const refreshOptions = async (value, overrides = {}) => ({
  currentDirectory: value.closure.outputDirectory,
  outputDirectory: join(await scratch("out"), "refresh"),
  metadataVersion: 2,
  timestampExpires: iso(Date.now() + 30 * DAY),
  publicationRunId: "4242",
  ledgerPath: await writeLedger(value.closure.root, [value.release]),
  protectedEnvironment: { [ONLINE]: value.online },
  releaseAnchorPath: value.releaseAnchorPath,
  timestampAnchorPath: value.timestampAnchorPath,
  ...overrides
});

const refused = async (options, code, pattern) => {
  await assert.rejects(
    () => refreshT76Timestamp(options),
    (error) => {
      assert.equal(error.code, code);
      if (pattern) assert.match(error.message, pattern);
      return true;
    }
  );
  // why: every refusal happens before a single output byte exists.
  await assert.rejects(() => readdir(options.outputDirectory), { code: "ENOENT" });
};

const filesUnder = async (directory) => {
  const found = new Map();
  for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    found.set(relative(directory, path).split(sep).join("/"), await readFile(path));
  }
  return found;
};

// why: the fixture client's source is exactly the served object map: metadata by
// name and targets by relative key, as a live endpoint would serve them.
const servedTree = async (publicationRoot, key) => ({
  metadata: await filesUnder(join(publicationRoot, "publication", key, "metadata")),
  targets: await filesUnder(join(publicationRoot, "publication", key, "targets"))
});

// why: what the endpoint serves once a human uploads the refresh: the published
// tree with the new snapshot added and timestamp.json replaced.
const withRefresh = async (served, refreshRoot, key) => {
  const metadata = new Map(served.metadata);
  for (const [name, bytes] of await filesUnder(join(refreshRoot, "publication", key, "metadata")))
    metadata.set(name, bytes);
  return { metadata, targets: served.targets };
};

let stagings = 0;
const stage = async (served, trustRootDirectory, trustedRoot) =>
  await new TufUpdateClient({
    trustRootDirectory,
    stagingRoot: join(await scratch("stage"), `staging-${(stagings += 1)}`),
    trustedRoot,
    source: new FixtureDistributionSource(served, { mode: "offline", sourceId: "source:offline:r2" })
  }).resolveAndStage({ platform: "win32", arch: "x64" });

const signedOf = (bytes) => JSON.parse(bytes.toString("utf8"));

test("round trip: the expired published timestamp is refused, the refreshed one is accepted", async (t) => {
  const start = Date.now();
  const value = await publishLineage({ timestampExpires: iso(start + 2 * DAY) });
  const key = "win32-x64";
  const trustedRoot = await readFile(join(value.closure.outputDirectory, "release-inputs", "root.json"));
  const published = await servedTree(value.closure.outputDirectory, key);
  const trust = join(await scratch("trust"), "installed");

  // why: inside the short window the published release stages normally.
  const installed = await stage(published, trust, trustedRoot);

  // why: past the online window, with root and targets still valid until 2035.
  t.mock.timers.enable({ apis: ["Date"], now: start + 3 * DAY });
  for (const trustRoot of [trust, join(await scratch("trust"), "fresh")])
    await assert.rejects(
      () => stage(published, trustRoot, trustedRoot),
      (error) => {
        assert.equal(error.code, "VES_TUF_EXPIRED");
        assert.equal(error.activationAllowed, false);
        return true;
      }
    );

  const options = await refreshOptions(value, { timestampExpires: iso(start + 10 * DAY) });
  const { manifest } = await refreshT76Timestamp(options);
  assert.equal(manifest.metadataVersion, 2);
  const refreshed = await withRefresh(published, options.outputDirectory, key);

  // why: the install that trusted version 1 updates to the refreshed timestamp, and
  // a fresh install bootstraps from it, both resolving the unchanged release.
  const updated = await stage(refreshed, trust, trustedRoot);
  assert.equal(updated.releaseDigest, installed.releaseDigest);
  assert.deepEqual(updated.components, installed.components);
  const trusted = signedOf(await readFile(join(trust, "timestamp.json")));
  assert.equal(trusted.signed.version, 2);
  assert.equal(trusted.signed.expires, iso(start + 10 * DAY));
  const fresh = await stage(refreshed, join(await scratch("trust"), "after-refresh"), trustedRoot);
  assert.equal(fresh.releaseDigest, installed.releaseDigest);
});

test("the refresh emits only timestamp and snapshot, signed by the online key over the untouched targets", async () => {
  const value = await sharedLineage();
  const options = await refreshOptions(value);
  const { manifest } = await refreshT76Timestamp(options);
  assert.equal(manifest.kind, "role-refresh");
  assert.equal(manifest.releaseId, PUBLICATION_RELEASE_ID);
  assert.equal(manifest.rootDigest, value.manifest.rootDigest);
  assert.equal(manifest.targetsVersion, 1);
  assert.equal(manifest.timestampSigningKeyId, value.manifest.timestampSigningKeyId);
  assert.deepEqual(manifest.steps, [...REFRESH_UPLOAD_STEPS]);
  assert.deepEqual(
    manifest.targets.map((entry) => entry.targetKey),
    [...SUPPORTED_TARGET_KEYS]
  );
  assert.deepEqual((await readdir(options.outputDirectory)).sort(), [
    "ledger-entry.json",
    "publication",
    "refresh-manifest.json"
  ]);
  const emitted = JSON.parse(await readFile(join(options.outputDirectory, "refresh-manifest.json"), "utf8"));
  assert.deepEqual(emitted, manifest);
  for (const entry of manifest.targets) {
    const current = join(value.closure.outputDirectory, "publication", entry.targetKey, "metadata");
    const produced = join(options.outputDirectory, "publication", entry.targetKey, "metadata");
    // why: never root, targets, or components: nothing offline-signed is re-emitted.
    assert.deepEqual((await readdir(produced)).sort(), ["2.snapshot.json", "timestamp.json"]);
    // why: snapshot before timestamp: the order a human must upload them in.
    assert.deepEqual(
      entry.assets.map((asset) => asset.assetName),
      ["2.snapshot.json", "timestamp.json"]
    );
    assert.equal(entry.metadataBaseUrl, `${PUBLICATION_BASE_URL}${entry.targetKey}/metadata/`);
    for (const asset of entry.assets) {
      assert.equal(asset.remoteKey, `${entry.targetKey}/metadata/${asset.assetName}`);
      const bytes = await readFile(join(options.outputDirectory, ...asset.path.split("/")));
      assert.equal(sha(bytes), asset.contentDigest);
      assert.equal(bytes.byteLength, asset.sizeBytes);
    }
    const snapshot = signedOf(await readFile(join(produced, "2.snapshot.json")));
    const timestamp = signedOf(await readFile(join(produced, "timestamp.json")));
    for (const [name, published] of [
      ["targets.json", "1.targets.json"],
      ["components.json", "1.components.json"]
    ]) {
      const bytes = await readFile(join(current, published));
      assert.equal(snapshot.signed.meta[name].version, 1);
      assert.equal(`sha256:${snapshot.signed.meta[name].hashes.sha256}`, sha(bytes));
      assert.equal(snapshot.signed.meta[name].length, bytes.byteLength);
    }
    const snapshotBytes = await readFile(join(produced, "2.snapshot.json"));
    assert.deepEqual(timestamp.signed.meta["snapshot.json"], {
      version: 2,
      length: snapshotBytes.byteLength,
      hashes: { sha256: sha(snapshotBytes).slice("sha256:".length) }
    });
    for (const metadata of [snapshot, timestamp]) {
      assert.equal(metadata.signed.version, 2);
      assert.equal(metadata.signed.expires, options.timestampExpires);
      assert.deepEqual(
        metadata.signatures.map((signature) => signature.keyid),
        [value.manifest.timestampSigningKeyId]
      );
    }
  }
});

test("refuses a timestamp/snapshot version that does not strictly exceed every recorded one", async () => {
  const value = await sharedLineage();
  const ledgerPath = await writeLedger(value.closure.root, [
    value.release,
    { ...value.release, kind: "role-refresh", roles: { snapshot: 3, timestamp: 3 } }
  ]);
  for (const metadataVersion of [1, 2, 3])
    await refused(
      await refreshOptions(value, { metadataVersion, ledgerPath }),
      "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC",
      new RegExp(`metadataVersion ${metadataVersion} must be strictly greater`, "u")
    );
  // why: a version already served in the published input is refused even when the
  // ledger does not record it: the refresh never reuses a live version.
  const copy = join(await scratch("served"), "current");
  await cp(value.closure.outputDirectory, copy, { recursive: true });
  await writeFile(join(copy, "publication", "linux-x64", "metadata", "5.snapshot.json"), "{}");
  await refused(
    await refreshOptions(value, { currentDirectory: copy, metadataVersion: 5 }),
    "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC",
    /already in the published input/u
  );
});

test("refuses a changed or unrecorded root", async () => {
  const value = await sharedLineage();
  const copy = join(await scratch("root"), "current");
  await cp(value.closure.outputDirectory, copy, { recursive: true });
  const rootPath = join(copy, "publication", "darwin-x64", "metadata", "root.json");
  const root = signedOf(await readFile(rootPath));
  root.signed.expires = "2034-01-01T00:00:00.000Z";
  await writeFile(rootPath, JSON.stringify(root));
  await refused(await refreshOptions(value, { currentDirectory: copy }), "VES_T76_REFRESH_ROOT_CHANGED");
  // why: a root the ledger records no release for is not a lineage the refresh may extend.
  await refused(
    await refreshOptions(value, { ledgerPath: await writeLedger(value.closure.root, []) }),
    "VES_T76_REFRESH_LINEAGE_UNKNOWN"
  );
  await refused(
    await refreshOptions(value, {
      ledgerPath: await writeLedger(value.closure.root, [{ ...value.release, rootDigest: sha("another root") }])
    }),
    "VES_T76_REFRESH_LINEAGE_UNKNOWN"
  );
});

test("refuses changed or superseded targets", async () => {
  const value = await sharedLineage();
  // why: a targets file whose signed body changed no longer verifies under the root.
  const copy = join(await scratch("targets"), "current");
  await cp(value.closure.outputDirectory, copy, { recursive: true });
  const targetsPath = join(copy, "publication", "linux-arm64", "metadata", "1.targets.json");
  const targets = signedOf(await readFile(targetsPath));
  targets.signed.expires = "2034-01-01T00:00:00.000Z";
  await writeFile(targetsPath, JSON.stringify(targets));
  await refused(await refreshOptions(value, { currentDirectory: copy }), "VES_TUF_PUBLICATION_REFRESH_UNVERIFIED");
  // why: the same for a components file.
  const componentsCopy = join(await scratch("components"), "current");
  await cp(value.closure.outputDirectory, componentsCopy, { recursive: true });
  const componentsPath = join(componentsCopy, "publication", "win32-x64", "metadata", "1.components.json");
  const components = signedOf(await readFile(componentsPath));
  components.signed.version = 1;
  components.signatures = [];
  await writeFile(componentsPath, JSON.stringify(components));
  await refused(
    await refreshOptions(value, { currentDirectory: componentsCopy }),
    "VES_TUF_PUBLICATION_REFRESH_UNVERIFIED"
  );
  // why: targets older than the newest release the ledger records for this root
  // would roll fresh clients back to a superseded release.
  await refused(
    await refreshOptions(value, {
      metadataVersion: 4,
      ledgerPath: await writeLedger(value.closure.root, [
        value.release,
        { ...value.release, roles: { root: 1, snapshot: 3, targets: 3, timestamp: 3 } }
      ])
    }),
    "VES_T76_REFRESH_TARGETS_CHANGED"
  );
});

test("refuses the offline key as the online key, and the offline key in the environment at all", async () => {
  const value = await sharedLineage();
  await refused(
    await refreshOptions(value, { protectedEnvironment: { [ONLINE]: value.offline } }),
    "VES_T76_REFRESH_ROLE_SEPARATION",
    /online signing key is the offline release key/u
  );
  await refused(
    await refreshOptions(value, { protectedEnvironment: { [ONLINE]: value.online, [OFFLINE]: value.offline } }),
    "VES_T76_REFRESH_OFFLINE_KEY_PRESENT"
  );
  await refused(
    await refreshOptions(value, {
      timestampAnchorPath: writeMatchingReleaseAnchor(value.closure.root, value.offline, TIMESTAMP_PURPOSE)
    }),
    "VES_T76_REFRESH_ROLE_SEPARATION"
  );
  await refused(
    await refreshOptions(value, { protectedEnvironment: { [ONLINE]: testSigningKeyBase64() } }),
    "VES_T76_PUBLISH_KEY_MISMATCH"
  );
  await refused(await refreshOptions(value, { protectedEnvironment: {} }), "VES_T76_PUBLISH_SIGNING_KEY_MISSING");
});

test("fails closed on a missing or mis-purposed timestamp anchor", async () => {
  const value = await sharedLineage();
  await refused(
    await refreshOptions(value, { timestampAnchorPath: join(value.closure.root, "no-such-anchor.json") }),
    "VES_T76_PUBLISH_ANCHOR_MISSING"
  );
  // why: this anchor names the online key but is reviewed for the release role.
  await refused(
    await refreshOptions(value, { timestampAnchorPath: writeMatchingReleaseAnchor(value.closure.root, value.online) }),
    "VES_T76_PUBLISH_ANCHOR_INVALID",
    /tuf-timestamp-snapshot/u
  );
});

test("a retired anchor for either role admits no refresh (#408)", async () => {
  const value = await sharedLineage();
  // why: the lineage's own anchors, retired: the keys still match, so only the
  // retirement can be what refuses them.
  for (const [option, path] of [
    ["timestampAnchorPath", value.timestampAnchorPath],
    ["releaseAnchorPath", value.releaseAnchorPath]
  ])
    await refused(
      await refreshOptions(value, { [option]: writeRetiredAnchorCopy(path) }),
      "VES_T76_PUBLISH_ANCHOR_RETIRED",
      /retired/u
    );
});

test("refuses an online window that is past or outlives the offline targets", async () => {
  const value = await sharedLineage();
  await refused(
    await refreshOptions(value, { timestampExpires: "2036-01-01T00:00:00.000Z" }),
    "VES_TUF_PUBLICATION_EXPIRY_ORDER_INVALID"
  );
  await refused(
    await refreshOptions(value, { timestampExpires: "2020-01-01T00:00:00.000Z" }),
    "VES_TUF_PUBLICATION_INPUT_INVALID"
  );
  await refused(await refreshOptions(value, { timestampExpires: "2030-01-01" }), "VES_T76_PUBLISH_INPUT_INVALID");
});

test("the emitted ledger entry appends verbatim and bounds the next refresh", async () => {
  const value = await sharedLineage();
  const options = await refreshOptions(value);
  const { ledgerEntry } = await refreshT76Timestamp(options);
  const written = JSON.parse(await readFile(join(options.outputDirectory, "ledger-entry.json"), "utf8"));
  assert.deepEqual(written, ledgerEntry);
  const ledger = JSON.parse(await readFile(options.ledgerPath, "utf8"));
  assert.deepEqual(written, {
    sequence: 2,
    previousEntryDigest: ledgerEntryDigest(ledger.entries[0]),
    kind: "role-refresh",
    releaseId: PUBLICATION_RELEASE_ID,
    semanticVersion: PUBLICATION_SEMANTIC_VERSION,
    baseUrl: PUBLICATION_BASE_URL,
    urlPrefix: null,
    rootDigest: value.manifest.rootDigest,
    rootDigestPrefix: null,
    roles: { snapshot: 2, timestamp: 2 },
    publicationRunId: "4242",
    evidence: [".specs/features/tuf-role-separation/republish-v3-runbook.md"]
  });
  const extended = { ...ledger, entries: [...ledger.entries, written] };
  assert.doesNotThrow(() => validatePublicationLedger(extended));
  const extendedPath = join(value.closure.root, "extended-ledger.json");
  await writeFile(extendedPath, `${JSON.stringify(extended, null, 2)}\n`);
  // why: next month: the same version is refused, the next one is admitted.
  await refused(
    await refreshOptions(value, { ledgerPath: extendedPath }),
    "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC"
  );
  const next = await refreshT76Timestamp(await refreshOptions(value, { ledgerPath: extendedPath, metadataVersion: 3 }));
  assert.equal(next.ledgerEntry.sequence, 3);
  assert.equal(next.ledgerEntry.previousEntryDigest, ledgerEntryDigest(written));
});

test("the command line never emits key material on success or on failure", async () => {
  const value = await sharedLineage();
  const outputDirectory = join(await scratch("cli"), "refresh");
  const ledgerPath = await writeLedger(value.closure.root, [value.release]);
  const args = [
    SCRIPT,
    "--current",
    value.closure.outputDirectory,
    "--out",
    outputDirectory,
    "--metadata-version",
    "2",
    "--timestamp-expires",
    iso(Date.now() + 30 * DAY),
    "--ledger",
    ledgerPath,
    "--run-id",
    "77",
    "--release-anchor",
    value.releaseAnchorPath,
    "--timestamp-anchor",
    value.timestampAnchorPath
  ];
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name !== OFFLINE && name !== ONLINE)
  );
  const run = async (environment) =>
    await execute(process.execPath, args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...inherited, ...environment }
    }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "" }));
  const secrets = [
    value.online,
    value.online.slice(0, 32),
    Buffer.from(value.online, "base64").toString("hex"),
    value.offline,
    Buffer.from(value.offline, "base64").toString("hex")
  ];

  const refusedRun = await run({ [ONLINE]: value.online, [OFFLINE]: value.offline });
  const refusedLog = `${refusedRun.stdout}${refusedRun.stderr}`;
  assert.match(refusedLog, /VES_T76_REFRESH_OFFLINE_KEY_PRESENT/u);
  for (const secret of secrets) assert.equal(refusedLog.includes(secret), false, "a refused key may not be echoed");

  const success = await run({ [ONLINE]: value.online });
  const log = `${success.stdout}${success.stderr}`;
  for (const secret of secrets) assert.equal(log.includes(secret), false, "no key material may reach a log");
  assert.match(success.stdout, /"timestampSigningKeyId"/u);
  for (const [name, bytes] of await filesUnder(outputDirectory))
    for (const secret of secrets)
      assert.equal(bytes.toString("utf8").includes(secret), false, `${name} may not carry key material`);
});

test("the refresh is admitted over the ledger entry the publication itself emitted (ADP-7)", async () => {
  const value = await sharedLineage();
  // why: no field of the recorded release is assembled here. The ledger is the
  // publication's own ledger-entry.json appended verbatim to the empty ledger it
  // was admitted against.
  const published = JSON.parse(await readFile(join(value.closure.outputDirectory, "ledger-entry.json"), "utf8"));
  assert.equal(published.sequence, 1);
  assert.equal(published.rootDigest, value.manifest.rootDigest);
  const ledger = { schema: PUBLICATION_LEDGER_SCHEMA, policy: "test ledger", entries: [published] };
  assert.doesNotThrow(() => validatePublicationLedger(ledger));
  const ledgerPath = join(value.closure.root, "ledger-from-publication.json");
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  await refused(
    await refreshOptions(value, { ledgerPath, metadataVersion: 1 }),
    "VES_T76_PUBLISH_METADATA_VERSION_NOT_MONOTONIC"
  );
  const { ledgerEntry } = await refreshT76Timestamp(await refreshOptions(value, { ledgerPath }));
  assert.equal(ledgerEntry.sequence, 2);
  assert.equal(ledgerEntry.previousEntryDigest, ledgerEntryDigest(published));
  assert.doesNotThrow(() => validatePublicationLedger({ ...ledger, entries: [published, ledgerEntry] }));
});
