#!/usr/bin/env node
// Qualification-only fixture provisioner for deep doctor (T5, #207). Not wired
// into `vestra init` or any user-facing command — it exists so a T75 matrix leg
// can materialize the seven subsystem paths the layout contract declares,
// which nothing on a bare source checkout ever creates.
//
// Every path comes from `SUBSYSTEM_OBSERVATION_PATHS`
// (packages/domain/src/workspace-layout/subsystem-layout.ts) via generic
// iteration, never a hand-listed per-subsystem case. A hand-listed case would
// reintroduce exactly the drift AD-019 exists to end: a subsystem silently
// unprovisioned because whoever last edited this file forgot it.
// tests/architecture/doctor-workspace-root.test.mjs statically proves this
// file still iterates the contract rather than hardcoding a partial list.
//
// Content is placeholder except for three subsystems whose live probes need
// something genuine to observe, not an empty file:
// - sandbox (T12, DDL-06): a directory symlink/junction escaping the sandbox
//   root, so ProtectedPathBroker's out-of-root refusal is reachable at all —
//   LogicalPath.parse already rejects any naive "../" logical path.
// - sqlite-durable-state (T13, DDL-08): a real database opened through the
//   product's own RuntimeStore migration path, not hand-rolled schema SQL,
//   so inspectRuntimeDatabase's integrity check and its "runs"/"ves_migrations"
//   row counts observe the actual product schema rather than a fixture that
//   only coincidentally resembles it.
// - cedar-policy (T14, DDL-07): a real Ed25519-signed policy bundle. No
//   production signer for a policy bundle exists yet anywhere in the
//   repository, so this provisioner mints a fresh keypair each run purely
//   for fixture purposes — it is not a trust root anything else in the
//   product relies on. The encoding matches the product's existing Ed25519
//   convention (packages/evidence/src/integrity/artifact-sealer.ts: spki-der
//   public key, base64url signature), which the doctor's own read-only
//   verifier (apps/vestra-cli/src/doctor-composition.ts) expects.
// - driver, connector, probe (T17-T19, DDL-10): an availability.json record
//   inside each subsystem's own directory, declaring that subsystem
//   available. No real driver/connector/probe adapter publishes such a
//   record anywhere in the product yet, so this is qualification-only, the
//   same footing as the two fixtures above — never a claim that a real
//   subsystem self-reports this way today.

import { createHash, generateKeyPairSync, sign as signBytes } from "node:crypto";
import { lstat, mkdir, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AVAILABILITY_SUBSYSTEMS,
  SUBSYSTEM_OBSERVATION_PATHS,
  WORKSPACE_ROOT_DIRNAME
} from "../packages/domain/src/index.ts";
import { RuntimeStore } from "../packages/platform-node/src/index.ts";
import { buildPolicyBundle } from "../packages/policy/src/index.ts";

// A relative path whose final segment carries a dot names a file (e.g.
// "policy/active.bundle", "runtime.db"); every other declared path names a
// directory a real subsystem adapter would populate (e.g. "drivers",
// "sandbox"). This is a generic, structural rule over the contract's own
// path shapes — not a per-subsystem special case.
function isFilePath(relativePath) {
  const finalSegment = relativePath.split("/").at(-1) ?? "";
  return finalSegment.includes(".");
}

function needsRealFixture(subsystem) {
  return subsystem === "sqlite-durable-state" || subsystem === "cedar-policy";
}

// P1 review finding on #306: canonicalizing `controlRoot` alone does not
// contain a descendant — `.verchestra`, or a subsystem directory below it
// such as `sandbox` — that already exists as a symlink or junction planted
// before this call, redirecting every subsequent write under it outside the
// requested root. This walks `dir`'s path one real segment at a time from
// the already-validated `root`, creating each missing segment and refusing
// (before any write reaches it) the moment an existing segment is not a
// genuine directory. Every mkdir/writeFile/rm/symlink target below is routed
// through this so containment is proven for the whole descendant path, not
// only `controlRoot` itself.
function assertWithin(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    throw new Error(`refusing to provision outside ${resolvedRoot}: ${resolvedTarget}`);
  }
  return resolvedTarget;
}

async function mkdirContained(root, dir) {
  const containedRoot = resolve(root);
  const containedDir = resolve(dir);
  if (containedDir !== containedRoot && !containedDir.startsWith(containedRoot + sep)) {
    throw new Error(`refusing to provision outside ${containedRoot}: ${containedDir}`);
  }
  const segments = relative(containedRoot, containedDir).split(sep).filter(Boolean);
  let current = containedRoot;
  for (const segment of segments) {
    current = resolve(join(current, segment));
    if (current !== containedRoot && !current.startsWith(containedRoot + sep)) {
      throw new Error(`refusing to provision outside ${containedRoot}: ${current}`);
    }
    let entryStat;
    try {
      entryStat = await lstat(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
      continue;
    }
    if (!entryStat.isDirectory()) {
      throw new Error(`refusing to provision through a redirected or non-directory path: ${current}`);
    }
  }
  return current;
}

// A target file path itself — not only its parent directory — could already
// be a symlink planted before this call; writeFile follows a symlink and
// writes through it. Refuses that before the write, the same fail-closed
// posture as mkdirContained above.
async function assertNotExistingRedirect(root, target) {
  const containedRoot = resolve(root);
  const containedTarget = resolve(target);
  if (containedTarget !== containedRoot && !containedTarget.startsWith(containedRoot + sep)) {
    throw new Error(`refusing to provision outside ${containedRoot}: ${containedTarget}`);
  }
  let entryStat;
  try {
    entryStat = await lstat(containedTarget);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (entryStat.isSymbolicLink() || entryStat.nlink > 1) {
    throw new Error(`refusing to write through a pre-existing symlink or hard link: ${containedTarget}`);
  }
}

async function writeFileContained(root, target, content) {
  const containedRoot = resolve(root);
  const containedTarget = resolve(target);
  if (containedTarget !== containedRoot && !containedTarget.startsWith(containedRoot + sep)) {
    throw new Error(`refusing to provision outside ${containedRoot}: ${containedTarget}`);
  }
  await mkdirContained(root, dirname(containedTarget));
  await assertNotExistingRedirect(containedRoot, containedTarget);
  await writeFile(containedTarget, content);
}

async function rebuildTrustedTempChild(canonicalRequestedRoot) {
  const trustedTempRoot = await realpath(tmpdir());
  const requestedName = basename(canonicalRequestedRoot);
  for (const entry of await readdir(trustedTempRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name !== requestedName) continue;
    const candidate = join(trustedTempRoot, entry.name);
    try {
      if ((await realpath(candidate)) === canonicalRequestedRoot) return candidate;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

async function validateControlRoot(untrustedControlRoot) {
  const requestedRoot = resolve(untrustedControlRoot);
  const canonicalRequestedRoot = await realpath(requestedRoot);
  if (canonicalRequestedRoot !== requestedRoot) {
    throw new Error(`controlRoot must not be a redirected path: ${untrustedControlRoot}`);
  }
  // The qualification fixture root is always a disposable direct child of the
  // OS temp directory. Rebuild the path from a directory entry obtained from
  // that trusted root before any filesystem sink sees it. The CLI string is
  // used only for comparison; it never becomes a sink path value.
  const controlRoot = await rebuildTrustedTempChild(canonicalRequestedRoot);
  if (controlRoot === undefined)
    throw new Error(`controlRoot must be a canonical direct child of the OS temp directory: ${untrustedControlRoot}`);
  const controlRootStat = await lstat(controlRoot);
  if (!controlRootStat.isDirectory() || controlRootStat.isSymbolicLink()) {
    throw new Error(`controlRoot must be an existing directory: ${untrustedControlRoot}`);
  }
  const filesystemRoot = resolve(sep);
  if (controlRoot === filesystemRoot || controlRoot.length === 0) {
    throw new Error(`refusing to provision at the filesystem root: ${controlRoot}`);
  }
  return controlRoot;
}

async function replaceSandboxEscape(sandboxRoot, metadataRoot) {
  const containedSandboxRoot = resolve(sandboxRoot);
  const escapeLink = resolve(join(containedSandboxRoot, "escape"));
  if (escapeLink !== containedSandboxRoot && !escapeLink.startsWith(containedSandboxRoot + sep)) {
    throw new Error(`refusing to provision outside ${containedSandboxRoot}: ${escapeLink}`);
  }
  const requestedMetadataRoot = resolve(metadataRoot);
  const canonicalMetadataRoot = await realpath(requestedMetadataRoot);
  if (canonicalMetadataRoot !== requestedMetadataRoot) {
    throw new Error(`refusing to link to a redirected metadata root: ${metadataRoot}`);
  }
  try {
    const existingEscape = await lstat(escapeLink);
    if (!existingEscape.isSymbolicLink()) {
      throw new Error(`refusing to replace a pre-existing non-link escape path: ${escapeLink}`);
    }
    await rm(escapeLink, { force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await symlink(canonicalMetadataRoot, escapeLink, process.platform === "win32" ? "junction" : "dir");
}

async function provisionAvailabilityFixtures(metadataRoot) {
  for (const subsystem of AVAILABILITY_SUBSYSTEMS) {
    const availabilityPath = assertWithin(
      metadataRoot,
      join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS[subsystem], "availability.json")
    );
    await writeFileContained(
      metadataRoot,
      availabilityPath,
      JSON.stringify({ schemaVersion: 1, subsystem, available: true }, null, 2)
    );
  }
}

export async function provisionDoctorFixtures(untrustedControlRoot) {
  // controlRoot ultimately traces back to a CLI argument (this script's own
  // `invokedDirectly` branch below, or a caller passing one through). Every
  // write below is joined onto it, so it is canonicalized and validated as a
  // real, existing directory before any of them run — a symlink, a
  // non-existent path, or anything else that would let a crafted argument
  // steer a write somewhere unintended fails closed here, once, rather than
  // at each individual join.
  const controlRoot = await validateControlRoot(untrustedControlRoot);
  const metadataRoot = await mkdirContained(controlRoot, join(controlRoot, WORKSPACE_ROOT_DIRNAME));
  const provisioned = [];
  for (const [subsystem, relativePath] of Object.entries(SUBSYSTEM_OBSERVATION_PATHS)) {
    const target = assertWithin(metadataRoot, join(metadataRoot, relativePath));
    if (needsRealFixture(subsystem)) {
      // Real content, provisioned below (RuntimeStore's own migration path;
      // a real signed bundle) — not the empty-placeholder branch every other
      // file takes.
    } else if (isFilePath(relativePath)) {
      await writeFileContained(metadataRoot, target, "");
    } else {
      await mkdirContained(metadataRoot, target);
    }
    provisioned.push(target);
  }

  // The runtime.db fixture (T13, DDL-08): open and close a real RuntimeStore
  // so its own migrations run, producing a genuinely valid database an
  // integrity check can observe as "ok" — the exact schema the product
  // itself creates, not a duplicate maintained separately here.
  const runtimeDbPath = assertWithin(
    metadataRoot,
    join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS["sqlite-durable-state"])
  );
  await assertNotExistingRedirect(metadataRoot, runtimeDbPath);
  const runtimeStore = new RuntimeStore({ dbPath: runtimeDbPath, now: () => new Date().toISOString() });
  runtimeStore.open();
  runtimeStore.close();

  // The sandbox escape fixture (T12, DDL-06): a directory symlink/junction
  // inside the sandbox root pointing at its own parent (.verchestra), which
  // the loop above just populated with real files (runtime.db among them) —
  // self-contained, no dependency on anything outside what this run already
  // provisions. `openExisting({ rootId: "sandbox", logicalPath:
  // "escape/runtime.db" })` resolves through the link to a real file that is
  // unambiguously outside the sandbox root, exercising the genuine
  // VES_PATH_OUTSIDE_ROOT refusal path. Same cross-platform convention as
  // tests/security/protected-path.test.mjs: a junction on Windows (plain
  // symlinks there need elevated privilege or Developer Mode), a directory
  // symlink elsewhere.
  const sandboxRoot = await mkdirContained(metadataRoot, join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS.sandbox));
  // Remove only a pre-existing link at this leaf; never recursively delete a
  // normal directory supplied by an untrusted caller. sandboxRoot itself is
  // what mkdirContained just proved is a genuine, contained directory.
  await replaceSandboxEscape(sandboxRoot, metadataRoot);

  // The policy bundle fixture (T14, DDL-07): a real Ed25519-signed
  // PolicyBundle built through buildPolicyBundle, the product's own
  // construction path — not hand-assembled JSON — so verifyPolicyBundle's
  // recompute-and-check logic (digest reproduction, per-policy source
  // digests, signature) all observe genuine, self-consistent content.
  const bundleKeyPair = generateKeyPairSync("ed25519");
  const bundleCrypto = {
    sha256: (value) => createHash("sha256").update(value).digest("hex"),
    sign: (digestValue) => ({
      signature: signBytes(null, Buffer.from(digestValue), bundleKeyPair.privateKey).toString("base64url"),
      publicKeyRef: bundleKeyPair.publicKey.export({ type: "spki", format: "der" }).toString("base64url")
    }),
    verify: () => true // never called by buildPolicyBundle; present only to satisfy the port's shape
  };
  const bundle = buildPolicyBundle(
    {
      version: "1.0.0",
      policies: [{ id: "doctorFixturePermit", cedar: "permit(principal, action, resource);" }],
      createdAt: new Date().toISOString()
    },
    bundleCrypto
  );
  const bundlePath = join(metadataRoot, SUBSYSTEM_OBSERVATION_PATHS["cedar-policy"]);
  await writeFileContained(metadataRoot, bundlePath, JSON.stringify(bundle, null, 2));

  // The trust anchor (P1 review finding on #306): a bundle's own
  // `publicKeyRef` field is content under verification, not a trust source —
  // a fully replaced, self-consistent, self-signed bundle would carry a
  // matching key and pass if the verifier trusted it. This sibling file,
  // written by the same provisioning run that signs the bundle and read by
  // the doctor from a path independent of the bundle's own content, is what
  // the doctor's live probe pins against instead.
  const trustedSignerPath = join(dirname(bundlePath), "trusted-signer.pub");
  await writeFileContained(
    metadataRoot,
    trustedSignerPath,
    bundleKeyPair.publicKey.export({ type: "spki", format: "der" }).toString("base64url")
  );

  // The availability record fixtures (T17-T19, DDL-10): one per declared
  // availability subsystem, generic iteration matching the same discipline
  // as the main loop above — never a hand-listed per-subsystem case.
  await provisionAvailabilityFixtures(metadataRoot);

  return provisioned;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const controlRoot = process.argv[2];
  if (!controlRoot) {
    console.error("usage: node scripts/provision-doctor-fixtures.mjs <controlRoot>");
    process.exitCode = 1;
  } else {
    const provisioned = await provisionDoctorFixtures(resolve(controlRoot));
    console.log(`provisioned ${provisioned.length} deep-doctor fixture path(s) under ${controlRoot}`);
  }
}
