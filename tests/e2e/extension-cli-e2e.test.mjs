// invariant: slice 1 of .specs/features/probe-host-composition/plan.md. The
// real `vestra` binary registers a workspace probe worker in a signed skill
// lock, approves its exact launch, lists and revokes approvals, and checks
// that admission would accept it, with nothing started. `approve` and `check`
// run only on POSIX (AC 13): on Windows every case that needs them asserts
// their refusal instead of skipping (XP-04).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { skillLockDigest } from "../../packages/agent-runtime/src/index.ts";
import { createTrustRoot } from "../../packages/evidence/src/index.ts";
import { probeLaunchDigest } from "../../packages/platform-node/src/probe-launch-digest.ts";
import { installedReleaseManifest } from "../../apps/vestra-cli/src/release-manifest.ts";
import { workspaceLockVerifier } from "../../apps/vestra-cli/src/extension/skill-lock-file.ts";
import { EVIDENCE_KEY_ID, EVIDENCE_PURPOSES } from "../../apps/vestra-cli/src/task/task-signing.ts";
import { CREDENTIALS, LINUX, VESTRA, WIN32, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";
import { linkDirectory } from "../helpers/windows-links.mjs";

const TIMEOUT = { timeout: 600_000 };
const DAY = 24 * 60 * 60 * 1000;
const WORKER_SOURCE = fileURLToPath(new URL("../fixtures/probe-workers/reference-worker.mjs", import.meta.url));
const ORIGIN = "https://fixture-user:fixture-token@example.invalid/acme/orders.git";
const PUBLIC_ORIGIN = "https://example.invalid/acme/orders.git";
const BASE = "https://accd.github.io/verchestra/attestation";
const COMMANDS = ["extension add", "extension approve", "extension list", "extension revoke", "extension check"];
const CHECK_IDS = ["lock", "extension", "approval", "admission", "entry", "launch"];
const extraRoots = [];

afterEach(async () => {
  await cleanupTaskFixtures();
  await Promise.all(extraRoots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

const WORKER = Object.freeze({
  skill: "acme-orders-probe",
  extension: "plugin:acme-orders-probe",
  ref: "orders-probe-001",
  entry: "probe/worker.mjs"
});

function workerNamed(name) {
  return { skill: `acme-${name}`, extension: `plugin:acme-${name}`, ref: name, entry: `probe/${name}.mjs` };
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

// why: a committed repository with an origin whose URL carries credentials,
// and the reference worker at each entry a case registers.
async function workspace(options = {}, workers = [WORKER]) {
  const fixture = await taskFixture({ secretService: LINUX, ...options });
  fixture.git(["remote", "add", "origin", ORIGIN]);
  await mkdir(join(fixture.repository, "probe"), { recursive: true });
  for (const worker of workers) await copyFile(WORKER_SOURCE, entryPath(fixture, worker));
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "--quiet", "-m", "probe workers"]);
  return fixture;
}

const entryPath = (fixture, worker) => join(fixture.repository, ...worker.entry.split("/"));
const lockPath = (fixture) => join(fixture.repository, ".verchestra", "skills.lock.json");
const approvalsRoot = (fixture) => join(fixture.stateRoot, "extension-approvals");
const approvalPath = (fixture, ref) => join(approvalsRoot(fixture), `${ref}.json`);
const revocationPath = (fixture, ref) => join(approvalsRoot(fixture), `${ref}.revoked.json`);
const readLock = async (fixture) => JSON.parse(await readFile(lockPath(fixture), "utf8"));

async function approvalFiles(fixture) {
  try {
    return (await readdir(approvalsRoot(fixture))).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function vestra(fixture, argv, { input = "", keychain = false, clockOffsetMs } = {}) {
  const result = fixture.launch(
    ["extension", ...argv, ...(keychain ? fixture.keychainArgs : []), "--output", "json"],
    input,
    { clockOffsetMs }
  );
  assert.ok(result.json !== undefined, `no JSON envelope: ${result.stderr}\n${result.stdout}`);
  return result;
}

function succeeded(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.json.ok, true, label);
  return result.json.data;
}

function refused(result, code, status, label) {
  assert.equal(result.status, status, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(result.json.ok, false, label);
  assert.equal(result.json.error.code, code, `${label}: ${JSON.stringify(result.json.error)}`);
  return result.json.error;
}

function add(fixture, worker = WORKER, overrides = {}) {
  const flags = {
    skill: worker.skill,
    extension: worker.extension,
    entry: worker.entry,
    "approval-ref": worker.ref,
    version: "1.0.0",
    license: "MIT",
    ...overrides
  };
  const argv = Object.entries(flags)
    .filter(([, value]) => value !== undefined)
    .flatMap(([name, value]) => [`--${name}`, value]);
  return vestra(fixture, ["add", ...argv], { keychain: true });
}

async function launchDigestOf(fixture, worker, { executable = process.execPath, args = [], environment = {} } = {}) {
  const path = entryPath(fixture, worker);
  return probeLaunchDigest({ executable, args, environment, entry: { path, digest: sha256(readFileSync(path)) } });
}

// why: the launch digest is computed here as an approver's own tool would,
// and typed back on stdin through the explicit --confirm-stdin flag.
async function approve(fixture, worker = WORKER, options = {}) {
  const { executable = process.execPath, args = [], environment = {}, expires, confirm = true, typed } = options;
  const launchDigest = await launchDigestOf(fixture, worker, { executable, args, environment });
  const argv = [
    "approve",
    "--approval-ref",
    worker.ref,
    "--executable",
    executable,
    ...args.flatMap((value) => ["--arg", value]),
    ...Object.entries(environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    ...(expires === undefined ? [] : ["--expires", expires]),
    ...(confirm ? ["--confirm-stdin"] : [])
  ];
  const result = vestra(fixture, argv, { input: `${typed ?? launchDigest}\n`, keychain: true });
  return { result, launchDigest };
}

function check(fixture, ref = WORKER.ref, options = {}) {
  return vestra(fixture, ["check", "--approval-ref", ref], options);
}

function rows(data) {
  return Object.fromEntries(data.checks.map((row) => [row.id, row]));
}

// invariant: AC 13 on Windows. Both POSIX-only commands refuse for the
// platform, exit 5, and record nothing.
async function refusedOnWindows(fixture, worker = WORKER) {
  const before = await approvalFiles(fixture);
  const { result } = await approve(fixture, worker);
  refused(result, "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, "approve on win32");
  refused(check(fixture, worker.ref), "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, "check on win32");
  assert.deepEqual(await approvalFiles(fixture), before);
}

function statementOf(envelope) {
  return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
}

async function approvalRecord(fixture, ref) {
  return statementOf(JSON.parse(await readFile(approvalPath(fixture, ref), "utf8")));
}

const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();

test("add registers the worker in a signed lock", TIMEOUT, async () => {
  const second = workerNamed("billing-probe");
  const fixture = await workspace({}, [WORKER, second]);
  const head = fixture.git(["rev-parse", "HEAD"]);
  const first = succeeded(add(fixture), "add");
  const lock = await readLock(fixture);
  assert.equal(lock.generation, 1);
  assert.deepEqual(first, {
    lockDigest: lock.lockDigest,
    generation: 1,
    skillId: WORKER.skill,
    extensionId: WORKER.extension,
    approvalRef: WORKER.ref
  });
  assert.equal(lock.lockDigest, skillLockDigest(lock));
  assert.equal(lock.skills.length, 1);
  const [skill] = lock.skills;
  assert.equal(skill.id, WORKER.skill);
  assert.deepEqual(skill.extensionRef, { kind: "plugin", id: WORKER.extension, approvalRef: WORKER.ref });
  const digest = sha256(await readFile(entryPath(fixture, WORKER)));
  assert.equal(skill.contents.length, 1);
  assert.equal(skill.contents[0].path, WORKER.entry);
  assert.equal(skill.contents[0].digest, digest);
  assert.equal(skill.contents[0].declaredClass, "executable");
  assert.equal(skill.source.treeDigest, digest);
  assert.equal(skill.source.commit, head);
  // invariant: the credentials in the origin URL never reach the tracked lock.
  assert.equal(skill.source.repository, PUBLIC_ORIGIN);
  assert.doesNotMatch(await readFile(lockPath(fixture), "utf8"), /fixture-user|fixture-token/u);
  // AC 1: both signatures verify against the pinned anchor alone.
  const anchor = JSON.parse(await readFile(join(fixture.stateRoot, "keys", "task-evidence-trust.json"), "utf8"));
  const verifier = workspaceLockVerifier(
    createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [anchor.publicKeyRef] })
  );
  assert.equal(await verifier.verifyLock(lock), true);
  assert.equal(await verifier.verifySource(skill), true);
  // The next add writes the next generation.
  const next = succeeded(add(fixture, second), "second add");
  const generationTwo = await readLock(fixture);
  assert.equal(next.generation, 2);
  assert.equal(next.lockDigest, generationTwo.lockDigest);
  assert.deepEqual(
    generationTwo.skills.map((entry) => [entry.id, entry.extensionRef.approvalRef]),
    [
      [WORKER.skill, WORKER.ref],
      [second.skill, second.ref]
    ]
  );
});

test("add refuses an entry outside the Workspace or behind a link", TIMEOUT, async () => {
  const fixture = await workspace();
  const outside = join(fixture.root, "outside");
  await mkdir(outside, { recursive: true });
  await copyFile(WORKER_SOURCE, join(outside, "worker.mjs"));
  await linkDirectory(outside, join(fixture.repository, "linked"));
  const before = await readFile(lockPath(fixture));
  const entries = [
    ["a relative path out of the Workspace", "../outside/worker.mjs"],
    ["an absolute path out of the Workspace", join(outside, "worker.mjs")],
    ["a path through a directory link", "linked/worker.mjs"]
  ];
  if (!WIN32) {
    // why: a file link needs Developer Mode on Windows; the directory link
    // above covers a link on every platform.
    await symlink(join(outside, "worker.mjs"), join(fixture.repository, "probe", "file-link.mjs"));
    entries.push(["a file link", "probe/file-link.mjs"]);
  }
  for (const [label, entry] of entries) {
    refused(add(fixture, WORKER, { entry }), "VES_EXTENSION_ENTRY_INVALID", 5, label);
    assert.deepEqual(await readFile(lockPath(fixture)), before, `${label} changed the lock`);
  }
  // why: the same Workspace accepts the worker inside it, so the path decided.
  succeeded(add(fixture), "the entry inside the Workspace");
});

test("the Workspace key still unlocks for task commands", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) await refusedOnWindows(fixture);
  else succeeded((await approve(fixture)).result, "approve");
  const keyFile = join(
    fixture.stateRoot,
    "keys",
    `${createHash("sha256").update(EVIDENCE_KEY_ID).digest("hex")}.key.json`
  );
  assert.deepEqual(JSON.parse(await readFile(keyFile, "utf8")).publicKeyRef.purposes, [...EVIDENCE_PURPOSES]);
  const plan = fixture.launch([
    "task",
    "plan",
    "--request",
    fixture.requestPath,
    ...fixture.keychainArgs,
    "--output",
    "json"
  ]);
  assert.equal(plan.status, 0, `task plan: ${plan.stdout}\n${plan.stderr}`);
  assert.equal(plan.json.ok, true);
  assert.match(plan.json.data.runId, /^run_/u);
});

test("approve records the confirmed launch", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  const expires = inDays(10);
  const launch = { args: ["--no-warnings"], environment: { PROBE_REGION: "eu" } };
  const { result, launchDigest } = await approve(fixture, WORKER, { ...launch, expires });
  const data = succeeded(result, "approve");
  const componentDigest = sha256(await readFile(entryPath(fixture, WORKER)));
  assert.deepEqual(data, {
    approvalRef: WORKER.ref,
    extensionId: WORKER.extension,
    componentDigest,
    launchDigest,
    expiresAt: expires
  });
  // AC 4: both digests were shown before the confirmation was read.
  assert.match(result.stderr, new RegExp(componentDigest, "u"));
  assert.match(result.stderr, new RegExp(launchDigest, "u"));
  const statement = await approvalRecord(fixture, WORKER.ref);
  assert.equal(statement.predicateType, `${BASE}/extension-approval/v1`);
  const content = statement.predicate.content;
  assert.equal(content.lockDigest, (await readLock(fixture)).lockDigest);
  assert.equal(content.extensionId, WORKER.extension);
  assert.equal(content.componentDigest, componentDigest);
  assert.equal(content.launchDigest, launchDigest);
  assert.deepEqual(content.launch, { executable: process.execPath, ...launch });
  assert.equal(content.expiresAt, expires);
});

test("approve defaults to 30 days and refuses more than 365", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  // The bound is an argument rule, so it holds on every platform.
  const tooLate = await approve(fixture, WORKER, { expires: inDays(366) });
  refused(tooLate.result, "VES_CLI_ARGUMENT_INVALID", 2, "an expiry beyond 365 days");
  assert.deepEqual(await approvalFiles(fixture), []);
  if (WIN32) return refusedOnWindows(fixture);
  const data = succeeded((await approve(fixture)).result, "approve without --expires");
  const content = (await approvalRecord(fixture, WORKER.ref)).predicate.content;
  assert.equal(data.expiresAt, content.expiresAt);
  assert.equal(Date.parse(content.expiresAt) - Date.parse(content.approvedAt), 30 * DAY);
});

test("approve writes nothing unless the launch digest is typed back", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  const mistyped = await approve(fixture, WORKER, { typed: `sha256:${"0".repeat(64)}` });
  refused(mistyped.result, "VES_TASK_CONFIRMATION_REQUIRED", 5, "a mistyped launch digest");
  assert.deepEqual(await approvalFiles(fixture), []);
  const unconfirmed = await approve(fixture, WORKER, { confirm: false });
  refused(unconfirmed.result, "VES_TASK_CONFIRMATION_REQUIRED", 5, "no terminal and no --confirm-stdin");
  assert.deepEqual(await approvalFiles(fixture), []);
  // why: the same launch, typed back, is recorded, so the confirmation decided.
  succeeded((await approve(fixture)).result, "a confirmed approve");
});

test("approve refuses a second approval for the same ref", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  succeeded((await approve(fixture)).result, "the first approve");
  const first = await readFile(approvalPath(fixture, WORKER.ref));
  const again = await approve(fixture, WORKER, { environment: { PROBE_REGION: "us" } });
  refused(again.result, "VES_EXTENSION_APPROVAL_EXISTS", 5, "a second approve");
  assert.deepEqual(await readFile(approvalPath(fixture, WORKER.ref)), first);
  assert.deepEqual(await approvalFiles(fixture), [`${WORKER.ref}.json`]);
});

test("approve refuses environment the worker would refuse", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  // why: the executable does not exist and no confirmation is offered, so a
  // refusal for the environment comes before anything is measured.
  const missingExecutable = join(fixture.root, "no-such-executable");
  for (const name of ["NODE_OPTIONS", "API_TOKEN", "VERCHESTRA_PROBE_WORKSPACE_ID"]) {
    const argv = ["approve", "--approval-ref", WORKER.ref, "--executable", missingExecutable, "--env", `${name}=value`];
    refused(vestra(fixture, argv, { keychain: true }), "VES_PROBE_HOST_ENVIRONMENT_DENIED", 5, name);
    assert.deepEqual(await approvalFiles(fixture), []);
  }
  // A permitted name reaches the measurement, which the missing executable fails.
  const permitted = vestra(
    fixture,
    ["approve", "--approval-ref", WORKER.ref, "--executable", missingExecutable, "--env", "PROBE_REGION=eu"],
    { keychain: true }
  );
  refused(permitted, "VES_PROBE_HOST_INPUT_INVALID", 5, "a permitted name");
});

test("list reports each approval state in order", TIMEOUT, async () => {
  // why: code-unit order differs from both insertion and locale order here:
  // "-" (0x2d) < "1" (0x31) < "_" (0x5f) < "z" (0x7a).
  const [active, expired, revoked, invalid] = ["orders-2", "orders1", "orders_1", "ordersz"].map(workerNamed);
  const fixture = await workspace({}, [invalid, revoked, expired, active]);
  const empty = succeeded(vestra(fixture, ["list"]), "list with no approval");
  assert.deepEqual(empty, { approvals: [] });
  for (const worker of [invalid, revoked, expired, active]) succeeded(add(fixture, worker), `add ${worker.ref}`);
  if (WIN32) return refusedOnWindows(fixture, active);
  succeeded((await approve(fixture, invalid)).result, "approve invalid");
  succeeded((await approve(fixture, revoked)).result, "approve revoked");
  succeeded((await approve(fixture, expired, { expires: inDays(1) })).result, "approve expired");
  succeeded((await approve(fixture, active)).result, "approve active");
  succeeded(vestra(fixture, ["revoke", "--approval-ref", revoked.ref], { keychain: true }), "revoke");
  const path = approvalPath(fixture, invalid.ref);
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const statement = statementOf(envelope);
  statement.predicate.content.expiresAt = inDays(300);
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  const listed = succeeded(vestra(fixture, ["list"], { clockOffsetMs: 2 * DAY }), "list two days later");
  assert.deepEqual(
    listed.approvals.map((entry) => [entry.approvalRef, entry.state]),
    [
      [active.ref, "active"],
      [expired.ref, "expired"],
      [revoked.ref, "revoked"],
      [invalid.ref, "invalid"]
    ]
  );
  // why: the expired approval was active before time moved.
  const now = succeeded(vestra(fixture, ["list"]), "list now");
  assert.equal(now.approvals.find((entry) => entry.approvalRef === expired.ref).state, "active");
});

test("revoke ends an approval", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  succeeded((await approve(fixture)).result, "approve");
  assert.equal(check(fixture).status, 0, "check before revoke");
  const data = succeeded(vestra(fixture, ["revoke", "--approval-ref", WORKER.ref], { keychain: true }), "revoke");
  assert.equal(data.approvalRef, WORKER.ref);
  assert.ok(Number.isFinite(Date.parse(data.revokedAt)));
  const revocation = statementOf(JSON.parse(await readFile(revocationPath(fixture, WORKER.ref), "utf8")));
  assert.equal(revocation.predicateType, `${BASE}/extension-approval-revocation/v1`);
  assert.deepEqual(revocation.predicate.content, data);
  const listed = succeeded(vestra(fixture, ["list"]), "list");
  assert.deepEqual(
    listed.approvals.map((entry) => entry.state),
    ["revoked"]
  );
  const after = check(fixture);
  assert.equal(after.status, 4);
  assert.equal(rows(after.json.data).approval.status, "fail");
  assert.equal(rows(after.json.data).approval.code, "VES_PROBE_WORKSPACE_TRUST_APPROVAL");
});

test("revoke refuses an unknown or revoked approval", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  const unknown = vestra(fixture, ["revoke", "--approval-ref", "never-approved"], { keychain: true });
  refused(unknown, "VES_EXTENSION_APPROVAL_NOT_FOUND", 5, "an unknown approval");
  assert.deepEqual(await approvalFiles(fixture), []);
  if (WIN32) return refusedOnWindows(fixture);
  succeeded((await approve(fixture)).result, "approve");
  succeeded(vestra(fixture, ["revoke", "--approval-ref", WORKER.ref], { keychain: true }), "revoke");
  const revocation = await readFile(revocationPath(fixture, WORKER.ref));
  const files = await approvalFiles(fixture);
  const again = vestra(fixture, ["revoke", "--approval-ref", WORKER.ref], { keychain: true });
  refused(again, "VES_EXTENSION_APPROVAL_REVOKED", 5, "a revoked approval");
  assert.deepEqual(await readFile(revocationPath(fixture, WORKER.ref)), revocation);
  assert.deepEqual(await approvalFiles(fixture), files);
});

test("check passes an admissible worker", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  succeeded((await approve(fixture)).result, "approve");
  const result = check(fixture);
  const data = succeeded(result, "check");
  assert.deepEqual(
    data.checks.map((row) => [row.id, row.status]),
    CHECK_IDS.map((id) => [id, "pass"])
  );
});

// invariant: each prerequisite fails alone, with the code admission or the
// launch measurement raised, so removing any one check is seen.
const PREREQUISITES = [
  {
    name: "an invalid lock",
    failing: "lock",
    code: "VES_SKILL_SIGNATURE_INVALID",
    async arrange(fixture) {
      succeeded((await approve(fixture)).result, "approve");
      const lock = await readLock(fixture);
      lock.skills[0].version = "1.0.1";
      lock.lockDigest = skillLockDigest(lock);
      await writeFile(lockPath(fixture), `${JSON.stringify(lock, null, 2)}\n`);
    }
  },
  {
    name: "an unresolved extension",
    failing: "extension",
    code: "VES_SKILL_UNKNOWN",
    ref: "not-in-the-lock",
    async arrange(fixture) {
      succeeded((await approve(fixture)).result, "approve");
    }
  },
  {
    name: "an absent approval",
    failing: "approval",
    code: "VES_PROBE_WORKSPACE_TRUST_APPROVAL",
    async arrange() {}
  },
  {
    name: "an entry edited after add",
    failing: "entry",
    code: "VES_PROBE_HOST_ENTRY_DIGEST",
    async arrange(fixture) {
      succeeded((await approve(fixture)).result, "approve");
      await writeFile(entryPath(fixture, WORKER), `${await readFile(entryPath(fixture, WORKER), "utf8")}// edited\n`);
    }
  },
  {
    name: "a launch whose executable changed after approve",
    failing: "launch",
    code: "VES_PROBE_HOST_LAUNCH_DIGEST",
    async arrange(fixture) {
      const executable = join(fixture.root, "worker-runtime");
      await symlink(process.execPath, executable);
      succeeded((await approve(fixture, WORKER, { executable })).result, "approve");
      await unlink(executable);
      await symlink("/bin/sh", executable);
    }
  }
];

test("check names each failing prerequisite", TIMEOUT, async () => {
  for (const prerequisite of PREREQUISITES) {
    const fixture = await workspace();
    succeeded(add(fixture), `${prerequisite.name}: add`);
    if (WIN32) {
      await refusedOnWindows(fixture);
      continue;
    }
    await prerequisite.arrange(fixture);
    const result = check(fixture, prerequisite.ref ?? WORKER.ref);
    assert.equal(result.status, 4, `${prerequisite.name}: ${result.stdout}\n${result.stderr}`);
    assert.equal(result.json.ok, true, prerequisite.name);
    const failed = result.json.data.checks.filter((row) => row.status === "fail");
    assert.deepEqual(
      failed.map((row) => [row.id, row.code]),
      [[prerequisite.failing, prerequisite.code]],
      prerequisite.name
    );
    assert.ok(failed[0].recovery.length > 0, `${prerequisite.name} names no recovery`);
  }
});

test("approve and check refuse on Windows", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  // why: on POSIX the same two commands are not refused for the platform.
  succeeded((await approve(fixture)).result, "approve on POSIX");
  succeeded(check(fixture), "check on POSIX");
});

test("no worker starts during the extension commands", TIMEOUT, async () => {
  const fixture = await workspace();
  const marker = join(fixture.root, "worker-started");
  succeeded(add(fixture), "add");
  succeeded(vestra(fixture, ["list"]), "list");
  if (WIN32) {
    await refusedOnWindows(fixture);
    refused(
      vestra(fixture, ["revoke", "--approval-ref", WORKER.ref], { keychain: true }),
      "VES_EXTENSION_APPROVAL_NOT_FOUND",
      5,
      "revoke"
    );
  } else {
    const environment = { PROBE_FIXTURE_START_MARKER: marker };
    succeeded((await approve(fixture, WORKER, { environment })).result, "approve");
    succeeded(vestra(fixture, ["list"]), "list after approve");
    succeeded(check(fixture), "check");
    succeeded(vestra(fixture, ["revoke", "--approval-ref", WORKER.ref], { keychain: true }), "revoke");
  }
  await assert.rejects(readFile(marker), { code: "ENOENT" }, "AC 14: a worker started");
  // why: the marker works, so its absence above means nothing started.
  const control = join(fixture.root, "control-started");
  const started = spawnSync(process.execPath, [entryPath(fixture, WORKER)], {
    env: { PROBE_FIXTURE_START_MARKER: control, SystemRoot: process.env.SystemRoot ?? "" },
    input: "",
    timeout: 30_000,
    killSignal: "SIGKILL"
  });
  assert.equal(started.error, undefined);
  assert.match(await readFile(control, "utf8"), /^\d+\n$/u);
});

test("the extension commands are declared and documented", TIMEOUT, async () => {
  const declared = installedReleaseManifest.commands.map((command) => command.name);
  for (const name of COMMANDS) assert.ok(declared.includes(name), `${name} is not in the release manifest`);
  const fixture = await workspace();
  const human = fixture.launch(["extension", "--help"]);
  assert.equal(human.status, 0, human.stderr);
  for (const name of COMMANDS) assert.match(human.stdout, new RegExp(`^  ${name} `, "mu"), name);
  const json = fixture.launch(["extension", "--help", "--output", "json"]);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(json.json.data.commands, COMMANDS);
});

test("missing flags exit 2", TIMEOUT, async () => {
  const fixture = await workspace();
  const before = await readFile(lockPath(fixture));
  const cases = [
    ["add", ["add"]],
    [
      "add without --entry",
      [
        "add",
        "--skill",
        WORKER.skill,
        "--extension",
        WORKER.extension,
        "--approval-ref",
        WORKER.ref,
        "--version",
        "1.0.0",
        "--license",
        "MIT"
      ]
    ],
    ["approve", ["approve", "--executable", process.execPath]],
    ["approve without --executable", ["approve", "--approval-ref", WORKER.ref]],
    ["revoke", ["revoke"]],
    ["check", ["check"]]
  ];
  for (const [label, argv] of cases) refused(vestra(fixture, argv), "VES_CLI_ARGUMENT_INVALID", 2, label);
  assert.deepEqual(await readFile(lockPath(fixture)), before);
  assert.deepEqual(await approvalFiles(fixture), []);
});

test("outside a Workspace the commands refuse", TIMEOUT, async () => {
  const root = await mkdtemp(join(tmpdir(), "vxo-"));
  extraRoots.push(root);
  const home = join(root, "home");
  await mkdir(home, { recursive: true });
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: join(root, "local"),
    SystemRoot: process.env.SystemRoot ?? "",
    TMPDIR: root,
    TEMP: root,
    TMP: root
  };
  const run = (argv) => {
    const result = spawnSync(process.execPath, [VESTRA, "extension", ...argv, "--output", "json"], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 120_000
    });
    return { ...result, json: JSON.parse(result.stdout) };
  };
  refused(run(["list"]), "VES_INIT_WORKSPACE_MISSING", 5, "list");
  const expected = WIN32 ? "VES_PROBE_HOST_PLATFORM_UNSUPPORTED" : "VES_INIT_WORKSPACE_MISSING";
  refused(run(["check", "--approval-ref", WORKER.ref]), expected, 5, "check");
  assert.deepEqual((await readdir(root)).sort(), ["home"]);
});

test("signing commands refuse without the passphrase", TIMEOUT, async () => {
  const withoutPassphrase = await workspace({ credentials: {} });
  const before = await readFile(lockPath(withoutPassphrase));
  const error = refused(add(withoutPassphrase), "VES_TASK_NOT_CONFIGURED", 5, "add without the passphrase");
  assert.equal(error.safeDetails.requirement, "evidence-signing-passphrase");
  assert.deepEqual(await readFile(lockPath(withoutPassphrase)), before);
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  // why: the passphrase is removed from the store after the worker was added.
  const store = JSON.parse(await readFile(fixture.store, "utf8"));
  for (const key of Object.keys(store.items)) if (key.endsWith("|evidence-signing-passphrase")) delete store.items[key];
  await writeFile(fixture.store, JSON.stringify(store));
  const { result } = await approve(fixture);
  const refusal = refused(result, "VES_TASK_NOT_CONFIGURED", 5, "approve without the passphrase");
  assert.equal(refusal.safeDetails.requirement, "evidence-signing-passphrase");
  assert.deepEqual(await approvalFiles(fixture), []);
  assert.equal(CREDENTIALS["evidence-signing-passphrase"].length > 0, true);
});

test("envelopes carry their declared fields", TIMEOUT, async () => {
  const fixture = await workspace();
  const keys = (value) => Object.keys(value).sort();
  const added = add(fixture);
  assert.equal(added.json.command, "extension add");
  assert.deepEqual(keys(succeeded(added, "add")), [
    "approvalRef",
    "extensionId",
    "generation",
    "lockDigest",
    "skillId"
  ]);
  if (WIN32) {
    assert.deepEqual(succeeded(vestra(fixture, ["list"]), "list"), { approvals: [] });
    return refusedOnWindows(fixture);
  }
  const approved = (await approve(fixture)).result;
  assert.equal(approved.json.command, "extension approve");
  assert.deepEqual(keys(succeeded(approved, "approve")), [
    "approvalRef",
    "componentDigest",
    "expiresAt",
    "extensionId",
    "launchDigest"
  ]);
  const listed = vestra(fixture, ["list"]);
  assert.equal(listed.json.command, "extension list");
  const list = succeeded(listed, "list");
  assert.deepEqual(keys(list), ["approvals"]);
  assert.deepEqual(keys(list.approvals[0]), [
    "approvalRef",
    "componentDigest",
    "expiresAt",
    "extensionId",
    "launchDigest",
    "state"
  ]);
  const checked = check(fixture);
  assert.equal(checked.json.command, "extension check");
  const report = succeeded(checked, "check");
  assert.deepEqual(keys(report), ["checks"]);
  for (const row of report.checks) assert.deepEqual(keys(row), ["code", "id", "recovery", "status"]);
  const revoked = vestra(fixture, ["revoke", "--approval-ref", WORKER.ref], { keychain: true });
  assert.equal(revoked.json.command, "extension revoke");
  assert.deepEqual(keys(succeeded(revoked, "revoke")), ["approvalRef", "revokedAt"]);
});

test("check fails an expired approval", TIMEOUT, async () => {
  const fixture = await workspace();
  succeeded(add(fixture), "add");
  if (WIN32) return refusedOnWindows(fixture);
  succeeded((await approve(fixture, WORKER, { expires: inDays(1) })).result, "approve");
  // why: the same approval passes before it expires.
  succeeded(check(fixture), "check before the expiry");
  const result = check(fixture, WORKER.ref, { clockOffsetMs: 2 * DAY });
  assert.equal(result.status, 4, `${result.stdout}\n${result.stderr}`);
  const failed = result.json.data.checks.filter((row) => row.status === "fail");
  assert.deepEqual(
    failed.map((row) => [row.id, row.code]),
    [["approval", "VES_PROBE_WORKSPACE_TRUST_APPROVAL"]]
  );
});
