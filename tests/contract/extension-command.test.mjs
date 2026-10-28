// invariant: slice 1 of .specs/features/probe-host-composition/plan.md, in
// process. The Workspace is the end-to-end fixture's, set up with the real
// `vestra init`; every `vestra extension` command under test runs here,
// through executeExtensionCommand, and main's dispatch through main(). The
// credential store is answered by the fake keychain, as for a child `vestra`.
// `approve` and `check` run only on POSIX (AC 13): on Windows every case that
// needs them asserts their refusal instead of skipping (XP-04).
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, afterEach, before, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { probeLaunchDigest } from "../../packages/platform-node/src/probe-launch-digest.ts";
import { executeExtensionCommand } from "../../apps/vestra-cli/src/extension/extension-command.ts";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";
import { linkDirectory } from "../helpers/windows-links.mjs";

const DARWIN = process.platform === "darwin";
const LINUX = process.platform === "linux";
const WIN32 = process.platform === "win32";
const TIMEOUT = { timeout: 600_000 };
const DAY = 24 * 60 * 60 * 1000;
const WORKER_SOURCE = fileURLToPath(new URL("../fixtures/probe-workers/reference-worker.mjs", import.meta.url));
const ORIGIN = "https://fixture-user:fixture-token@example.invalid/acme/orders.git";
const PUBLIC_ORIGIN = "https://example.invalid/acme/orders.git";
const CHECK_IDS = ["lock", "extension", "approval", "admission", "entry", "launch"];
const WORKER = Object.freeze({
  skill: "acme-orders-probe",
  extension: "plugin:acme-orders-probe",
  ref: "orders-probe-001",
  entry: "probe/worker.mjs"
});
const SECOND = Object.freeze({
  skill: "acme-billing-probe",
  extension: "plugin:acme-billing-probe",
  ref: "billing-probe",
  entry: "probe/billing-probe.mjs"
});

let credentials;
let fixtures;

// why: the fakes read the store path when they load and the store itself each
// time they are asked, so the path is named before the fixture module (which
// loads the POSIX fake) is imported, and one store serves every fixture of
// this file: each binds the same Workspace ID.
before(async () => {
  credentials = await mkdtemp(join(tmpdir(), "vxk-"));
  const store = join(credentials, "keychain-store.json");
  process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE = store;
  // why: the Secret Service backend asks only whether a session bus address
  // is set; the address names a socket that does not exist.
  if (LINUX) process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(credentials, "no-session-bus")}`;
  fixtures = await import("../helpers/task-cli-fixture.mjs");
  if (WIN32) await import("../helpers/fake-windows-spawn.mjs");
  const items = Object.entries(fixtures.MODE_CREDENTIALS.subscription).map(([name, value]) => [
    `verchestra/${fixtures.WORKSPACE_ID}|${name}`,
    value
  ]);
  await writeFile(store, JSON.stringify({ items: Object.fromEntries(items) }));
});

after(() => rm(credentials, { recursive: true, force: true, maxRetries: 5 }));
afterEach(() => fixtures.cleanupTaskFixtures());

const entryPath = (fixture, worker) => join(fixture.repository, ...worker.entry.split("/"));
const lockPath = (fixture) => join(fixture.repository, ".verchestra", "skills.lock.json");
const approvalsRoot = (fixture) => join(fixture.stateRoot, "extension-approvals");
const readLock = async (fixture) => JSON.parse(await readFile(lockPath(fixture), "utf8"));
const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function approvalFiles(fixture) {
  try {
    return (await readdir(approvalsRoot(fixture))).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// why: a committed repository with an origin whose URL carries credentials,
// and the reference worker at each entry a case registers.
async function workspace({ origin = ORIGIN, workers = [WORKER] } = {}) {
  const fixture = await fixtures.taskFixture();
  if (origin !== null) fixture.git(["remote", "add", "origin", origin]);
  await mkdir(join(fixture.repository, "probe"), { recursive: true });
  for (const worker of workers) await copyFile(WORKER_SOURCE, entryPath(fixture, worker));
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "--quiet", "-m", "probe workers"]);
  return fixture;
}

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

async function extension(fixture, name, options = {}, input = "") {
  const stderr = [];
  const result = await inWorkspaceHome(fixture, (env) =>
    executeExtensionCommand(
      { name: `extension ${name}`, options: { ...options, ...(DARWIN ? { keychain: fixture.keychain } : {}) } },
      {
        controlRoot: fixture.repository,
        platform: process.platform,
        env,
        stdin: Readable.from(input === "" ? [] : [Buffer.from(input)]),
        stderr: (value) => stderr.push(value),
        pid: process.pid
      }
    )
  );
  return { ...result, stderr: stderr.join("") };
}

async function refused(promise, code, label) {
  const error = await promise.then(
    () => assert.fail(`${label} succeeded`),
    (rejection) => rejection
  );
  assert.equal(error.envelope?.code, code, `${label}: ${error.stack}`);
  return error.envelope;
}

function add(fixture, worker = WORKER, overrides = {}) {
  const options = {
    skill: worker.skill,
    extension: worker.extension,
    entry: worker.entry,
    "approval-ref": worker.ref,
    version: "1.0.0",
    license: "MIT",
    ...overrides
  };
  return extension(
    fixture,
    "add",
    Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))
  );
}

// why: the launch digest is computed here as an approver's own tool would,
// and typed back on stdin through --confirm-stdin.
async function approve(fixture, worker = WORKER, launch = {}) {
  const { executable = process.execPath, args = [], environment = {}, expires, typed, confirm = true } = launch;
  const path = entryPath(fixture, worker);
  const launchDigest = await probeLaunchDigest({
    executable,
    args,
    environment,
    entry: { path, digest: sha256(readFileSync(path)) }
  });
  const options = {
    "approval-ref": worker.ref,
    executable,
    arg: args,
    env: Object.entries(environment).map(([name, value]) => `${name}=${value}`),
    ...(expires === undefined ? {} : { expires }),
    ...(confirm ? { "confirm-stdin": true } : {})
  };
  return { launchDigest, result: extension(fixture, "approve", options, `${typed ?? launchDigest}\n`) };
}

const check = (fixture, ref = WORKER.ref) => extension(fixture, "check", { "approval-ref": ref });

function statuses(result) {
  return result.data.checks.map((row) => [row.id, row.status, row.code]);
}

// invariant: each failing prerequisite fails its own row with its code, and
// nothing else fails; the rows after an admission failure are not checked.
function failsOnly(result, id, code, label) {
  assert.equal(result.exitCode, 4, label);
  const failed = result.data.checks.filter((row) => row.status === "fail");
  assert.deepEqual(
    failed.map((row) => [row.id, row.code]),
    [[id, code]],
    label
  );
  assert.ok(failed[0].recovery.length > 0, `${label} names no recovery`);
  assert.equal(result.diagnostics.length, result.data.checks.filter((row) => row.status !== "pass").length, label);
}

async function refusedOnWindows(fixture) {
  const before = await approvalFiles(fixture);
  await refused((await approve(fixture)).result, "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", "approve on win32");
  await refused(check(fixture), "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", "check on win32");
  assert.deepEqual(await approvalFiles(fixture), before);
}

test("add registers workers in the signed lock and refuses what it must", TIMEOUT, async () => {
  const fixture = await workspace({ workers: [WORKER, SECOND] });
  const outside = join(fixture.root, "outside");
  await mkdir(outside, { recursive: true });
  await copyFile(WORKER_SOURCE, join(outside, "worker.mjs"));
  await linkDirectory(outside, join(fixture.repository, "linked"));
  const placeholder = await readFile(lockPath(fixture));
  // Arguments are refused (exit 2) before anything is read.
  for (const [label, overrides, argument] of [
    ["no --skill", { skill: undefined }, "--skill"],
    ["a malformed skill id", { skill: "Acme Orders" }, "--skill"],
    ["the product namespace", { extension: "probe-worker:acme" }, "--extension"],
    ["a malformed extension id", { extension: "-acme" }, "--extension"],
    ["no --entry", { entry: undefined }, "--entry"],
    ["a malformed approval ref", { "approval-ref": "Orders.001" }, "--approval-ref"],
    ["a malformed version", { version: "1.0" }, "--version"],
    ["a license outside the allowlist", { license: "GPL-3.0-only" }, "--license"]
  ]) {
    const envelope = await refused(add(fixture, WORKER, overrides), "VES_CLI_ARGUMENT_INVALID", label);
    assert.deepEqual(envelope.safeDetails, { argument }, label);
  }
  // AC 3: an entry that is no regular file inside the Workspace, reached
  // through no link, is refused and changes nothing.
  for (const [label, entry] of [
    ["the Workspace root", "."],
    ["the parent directory", ".."],
    ["a path out of the Workspace", "../outside/worker.mjs"],
    ["an absolute path out of the Workspace", join(outside, "worker.mjs")],
    ["a directory", "probe"],
    ["a missing file", "probe/missing.mjs"],
    ["a path below a file", `${WORKER.entry}/inner.mjs`],
    ["a path through a directory link", "linked/worker.mjs"]
  ])
    await refused(add(fixture, WORKER, { entry }), "VES_EXTENSION_ENTRY_INVALID", label);
  assert.deepEqual(await readFile(lockPath(fixture)), placeholder);

  // AC 1 and AC 2: the placeholder becomes generation 1.
  const first = (await add(fixture)).data;
  const lock = await readLock(fixture);
  assert.deepEqual(first, {
    lockDigest: lock.lockDigest,
    generation: 1,
    skillId: WORKER.skill,
    extensionId: WORKER.extension,
    approvalRef: WORKER.ref
  });
  const [skill] = lock.skills;
  assert.deepEqual(skill.extensionRef, { kind: "plugin", id: WORKER.extension, approvalRef: WORKER.ref });
  assert.equal(skill.contents[0].digest, sha256(await readFile(entryPath(fixture, WORKER))));
  assert.equal(skill.source.repository, PUBLIC_ORIGIN);
  assert.equal(skill.source.commit, fixture.git(["rev-parse", "HEAD"]));

  // One skill id, one extension id, and one approval reference per lock.
  const generationOne = await readFile(lockPath(fixture));
  for (const [label, overrides] of [
    ["the same skill id", { extension: SECOND.extension, "approval-ref": SECOND.ref }],
    ["the same extension id", { skill: SECOND.skill, "approval-ref": SECOND.ref }],
    ["the same approval ref", { skill: SECOND.skill, extension: SECOND.extension }]
  ])
    await refused(
      add(fixture, WORKER, { entry: SECOND.entry, ...overrides }),
      "VES_EXTENSION_ALREADY_REGISTERED",
      label
    );
  assert.deepEqual(await readFile(lockPath(fixture)), generationOne);

  // The next add writes the next generation and keeps the one it replaced.
  const next = (await add(fixture, SECOND)).data;
  const generationTwo = await readLock(fixture);
  assert.equal(next.generation, 2);
  assert.equal(next.lockDigest, generationTwo.lockDigest);
  assert.deepEqual(
    generationTwo.skills.map((entry) => entry.id),
    [WORKER.skill, SECOND.skill]
  );
  assert.deepEqual(await readFile(join(fixture.repository, ".verchestra", "skills.lock.1.json")), generationOne);
});

test("add records a public origin at a commit, or refuses", TIMEOUT, async () => {
  const fixture = await workspace({ origin: null });
  const placeholder = await readFile(lockPath(fixture));
  const notConfigured = async (requirement, label) => {
    const envelope = await refused(add(fixture), "VES_EXTENSION_NOT_CONFIGURED", label);
    assert.deepEqual(envelope.safeDetails, { requirement }, label);
  };
  await notConfigured("git-origin", "no origin");
  fixture.git(["remote", "add", "origin", pathToFileURL(join(fixture.root, "elsewhere.git")).href]);
  await notConfigured("git-origin", "a file URL origin");
  fixture.git(["remote", "set-url", "origin", join(fixture.root, "elsewhere.git")]);
  await notConfigured("git-origin", "a local path origin");
  fixture.git(["remote", "set-url", "origin", "git@example.invalid:acme/orders.git"]);
  fixture.git(["checkout", "--quiet", "--orphan", "unborn"]);
  await notConfigured("git-commit", "no commit");
  assert.deepEqual(await readFile(lockPath(fixture)), placeholder);
});

test("list, revoke and check refuse what names no approval", TIMEOUT, async () => {
  const fixture = await workspace();
  assert.deepEqual((await extension(fixture, "list")).data, { approvals: [] });
  await refused(
    extension(fixture, "revoke", { "approval-ref": "never-approved" }),
    "VES_EXTENSION_APPROVAL_NOT_FOUND",
    "an unknown approval"
  );
  for (const [label, name, options] of [
    ["revoke without --approval-ref", "revoke", {}],
    ["revoke of a malformed approval ref", "revoke", { "approval-ref": "Never.Approved" }],
    ["check without --approval-ref", "check", {}]
  ]) {
    const envelope = await refused(extension(fixture, name, options), "VES_CLI_ARGUMENT_INVALID", label);
    assert.deepEqual(envelope.safeDetails, { argument: "--approval-ref" }, label);
  }
  const unknown = await refused(
    extension(fixture, "frobnicate"),
    "VES_CLI_ARGUMENT_INVALID",
    "a command the family lacks"
  );
  assert.deepEqual(unknown.safeDetails, { argument: "extension frobnicate" });
  assert.deepEqual(await approvalFiles(fixture), []);
});

test("approve refuses its arguments on every platform before reading anything", TIMEOUT, async () => {
  const fixture = await workspace();
  const valid = { "approval-ref": WORKER.ref, executable: process.execPath };
  for (const [label, overrides, argument] of [
    ["no --approval-ref", { "approval-ref": undefined }, "--approval-ref"],
    ["no --executable", { executable: undefined }, "--executable"],
    ["a relative executable", { executable: "node" }, "--executable"],
    ["an --env without a value", { env: ["PROBE_REGION"] }, "--env"],
    ["an --env name given twice", { env: ["PROBE_REGION=eu", "PROBE_REGION=us"] }, "--env"],
    ["an --expires that is no instant", { expires: "next week" }, "--expires"],
    ["an --expires that is not text", { expires: true }, "--expires"],
    ["an --expires in the past", { expires: inDays(-1) }, "--expires"],
    ["an --expires beyond 365 days", { expires: inDays(366) }, "--expires"]
  ]) {
    const options = Object.fromEntries(
      Object.entries({ ...valid, ...overrides }).filter(([, value]) => value !== undefined)
    );
    const envelope = await refused(extension(fixture, "approve", options), "VES_CLI_ARGUMENT_INVALID", label);
    assert.deepEqual(envelope.safeDetails, { argument }, label);
  }
  assert.deepEqual(await approvalFiles(fixture), []);
});

test("approve, list, check and revoke a registered worker", TIMEOUT, async () => {
  const fixture = await workspace({ workers: [WORKER, SECOND] });
  if (WIN32) {
    await add(fixture);
    return refusedOnWindows(fixture);
  }
  // why: an executable is measured, never run, so any file stands for a
  // runtime; changing its bytes later is a changed launch.
  const runtime = join(fixture.root, "worker-runtime");
  const stable = join(fixture.root, "stable-runtime");
  await writeFile(runtime, "runtime bytes, first build\n");
  await writeFile(stable, "runtime bytes that never change\n");
  // Before any add the lock is init's placeholder: nothing is registered,
  // and check fails the lock with nothing after it checked.
  await refused(
    (await approve(fixture, WORKER, { executable: runtime })).result,
    "VES_EXTENSION_NOT_REGISTERED",
    "approve before add"
  );
  const unlocked = await check(fixture);
  assert.equal(unlocked.exitCode, 4);
  assert.equal(unlocked.data.checks[0].status, "fail");
  assert.match(unlocked.data.checks[0].code, /^VES_SKILL_/u);
  assert.deepEqual(
    unlocked.data.checks.slice(1).map((row) => row.status),
    CHECK_IDS.slice(1).map(() => "not-checked")
  );
  assert.equal(unlocked.diagnostics.length, CHECK_IDS.length);

  await add(fixture);
  await add(fixture, SECOND);
  await refused(
    (await approve(fixture, { ...WORKER, ref: "not-in-the-lock" }, { executable: runtime })).result,
    "VES_EXTENSION_NOT_REGISTERED",
    "an approval ref no locked worker carries"
  );
  // AC 7: a denied environment is refused before anything is measured.
  const missing = join(fixture.root, "no-such-executable");
  await refused(
    extension(fixture, "approve", { "approval-ref": WORKER.ref, executable: missing, env: ["NODE_OPTIONS=x"] }),
    "VES_PROBE_HOST_ENVIRONMENT_DENIED",
    "a loader variable"
  );
  await refused(
    extension(fixture, "approve", { "approval-ref": WORKER.ref, executable: missing }),
    "VES_PROBE_HOST_INPUT_INVALID",
    "an executable that does not exist"
  );
  // AC 5: nothing is recorded unless the launch digest is typed back.
  await refused(
    (await approve(fixture, WORKER, { executable: runtime, typed: `sha256:${"0".repeat(64)}` })).result,
    "VES_TASK_CONFIRMATION_REQUIRED",
    "a mistyped launch digest"
  );
  await refused(
    (await approve(fixture, WORKER, { executable: runtime, confirm: false })).result,
    "VES_TASK_CONFIRMATION_REQUIRED",
    "no --confirm-stdin"
  );
  assert.deepEqual(await approvalFiles(fixture), []);

  // AC 4: the confirmed launch is recorded, after both digests were shown.
  const expires = inDays(10);
  const launch = { executable: runtime, args: ["--no-warnings"], environment: { PROBE_REGION: "eu" }, expires };
  const first = await approve(fixture, WORKER, launch);
  const approved = await first.result;
  const componentDigest = sha256(await readFile(entryPath(fixture, WORKER)));
  assert.deepEqual(approved.data, {
    approvalRef: WORKER.ref,
    extensionId: WORKER.extension,
    componentDigest,
    launchDigest: first.launchDigest,
    expiresAt: expires
  });
  assert.match(approved.stderr, new RegExp(componentDigest, "u"));
  assert.match(approved.stderr, new RegExp(first.launchDigest, "u"));
  // AC 6: a second approval for the reference is refused; the first stays.
  const record = await readFile(join(approvalsRoot(fixture), `${WORKER.ref}.json`));
  await refused(
    (await approve(fixture, WORKER, { executable: stable })).result,
    "VES_EXTENSION_APPROVAL_EXISTS",
    "a second approve"
  );
  assert.deepEqual(await readFile(join(approvalsRoot(fixture), `${WORKER.ref}.json`)), record);
  // Without --expires an approval expires 30 days after it is recorded.
  const second = await (await approve(fixture, SECOND, { executable: stable })).result;
  const expiresIn = Date.parse(second.data.expiresAt) - Date.now();
  assert.ok(expiresIn > 29 * DAY && expiresIn <= 30 * DAY, second.data.expiresAt);

  // AC 8: both approvals are listed active, in code-unit order.
  assert.deepEqual(
    (await extension(fixture, "list")).data.approvals.map((entry) => [entry.approvalRef, entry.state]),
    [
      [SECOND.ref, "active"],
      [WORKER.ref, "active"]
    ]
  );
  // AC 10: an admissible worker passes every check.
  const passed = await check(fixture);
  assert.equal(passed.exitCode, 0);
  assert.deepEqual(
    statuses(passed),
    CHECK_IDS.map((id) => [id, "pass", null])
  );
  assert.deepEqual(passed.diagnostics, []);

  // AC 11: each changed prerequisite fails its own row.
  await writeFile(runtime, "runtime bytes, second build\n");
  failsOnly(await check(fixture), "launch", "VES_PROBE_HOST_LAUNCH_DIGEST", "a changed executable");
  await rm(runtime);
  failsOnly(await check(fixture), "launch", "VES_PROBE_HOST_INPUT_INVALID", "a removed executable");
  failsOnly(await check(fixture, "not-in-the-lock"), "extension", "VES_SKILL_UNKNOWN", "an unresolved extension");
  await writeFile(entryPath(fixture, SECOND), `${await readFile(entryPath(fixture, SECOND), "utf8")}// edited\n`);
  failsOnly(await check(fixture, SECOND.ref), "entry", "VES_PROBE_HOST_ENTRY_DIGEST", "an edited entry");
  await refused(
    (await approve(fixture, SECOND, { executable: stable })).result,
    "VES_PROBE_HOST_ENTRY_DIGEST",
    "approve an edited entry"
  );

  // AC 9: a revoked approval is listed revoked and fails check.
  const revoked = (await extension(fixture, "revoke", { "approval-ref": WORKER.ref })).data;
  assert.deepEqual(Object.keys(revoked).sort(), ["approvalRef", "revokedAt"]);
  assert.equal(revoked.approvalRef, WORKER.ref);
  assert.ok(Number.isFinite(Date.parse(revoked.revokedAt)));
  assert.equal(
    (await extension(fixture, "list")).data.approvals.find((entry) => entry.approvalRef === WORKER.ref).state,
    "revoked"
  );
  failsOnly(await check(fixture), "approval", "VES_PROBE_WORKSPACE_TRUST_APPROVAL", "a revoked approval");
  await refused(
    extension(fixture, "revoke", { "approval-ref": WORKER.ref }),
    "VES_EXTENSION_APPROVAL_REVOKED",
    "a second revoke"
  );

  // A lock that is not JSON fails check's lock row, and add and approve
  // refuse it naming the registry's code.
  await writeFile(lockPath(fixture), "{ not json\n");
  const broken = await check(fixture, SECOND.ref);
  assert.equal(broken.exitCode, 4);
  assert.deepEqual(
    broken.data.checks.map((row) => row.status),
    ["fail", ...CHECK_IDS.slice(1).map(() => "not-checked")]
  );
  // why: each command runs alone, as each owns HOME while it runs.
  const third = { ...SECOND, skill: "acme-third", extension: "plugin:acme-third", ref: "third" };
  const addRefused = await refused(add(fixture, third), "VES_EXTENSION_LOCK_REFUSED", "add");
  assert.deepEqual(addRefused.safeDetails, { reason: "VES_SKILL_LOCK_INVALID" });
  const approveRefused = await refused(
    (await approve(fixture, WORKER, { executable: stable })).result,
    "VES_EXTENSION_LOCK_REFUSED",
    "approve"
  );
  assert.deepEqual(approveRefused.safeDetails, { reason: "VES_SKILL_LOCK_INVALID" });
});

test("main routes a vestra extension command to the extension commands", TIMEOUT, async (t) => {
  const { main } = await import("../../apps/vestra-cli/src/main.ts");
  const root = await temporaryDirectory(t, "vxm-");
  const cwd = process.cwd();
  const write = process.stdout.write;
  let stdout = "";
  let exitCode;
  // why: the CLI writes its envelope as text; the test runner's own messages
  // to its parent are binary and pass through untouched.
  process.stdout.write = function capture(chunk, ...rest) {
    if (typeof chunk !== "string") return write.call(this, chunk, ...rest);
    stdout += chunk;
    return true;
  };
  process.chdir(root);
  try {
    exitCode = await main("vestra", ["extension", "list", "--output", "json"]);
  } finally {
    process.chdir(cwd);
    process.stdout.write = write;
  }
  const envelope = JSON.parse(stdout);
  assert.equal(exitCode, 5, stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.error.code, "VES_INIT_WORKSPACE_MISSING");
  assert.deepEqual(await readdir(root), []);
});
