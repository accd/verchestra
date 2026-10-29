// invariant: slice 2b of .specs/features/probe-run/plan.md, in process. The
// Workspace is the end-to-end fixture's, set up with the real `vestra init`;
// `database add`, `extension add` and `approve`, `probe run` and the task
// commands run here through the CLI runner over their family's command, and
// main's dispatch through main(). The credential store is answered by the fake
// keychain, as for a child `vestra`. A probe run that reaches its worker
// starts a real one, so those cases run on Linux and macOS; on Windows each
// asserts the platform refusal instead of skipping (XP-04).
// why: every product module is imported after the child process spy is
// installed (in `before`), because the Git runner keeps the promisified
// execFile it finds when it loads.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { after, afterEach, before, test } from "node:test";
import { promisify } from "node:util";

import { CREDENTIAL_TOOL } from "../helpers/deny-keychain-spawn.mjs";
import {
  REFERENCE_WORKER,
  SENTINEL,
  SQLITE_WORKER,
  bindingDigestOf,
  databaseArgument,
  installWorkers,
  ordersDatabase,
  ordersDefinition,
  postgresDefinition,
  probeRequest
} from "../helpers/probe-run-fixture.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const DARWIN = process.platform === "darwin";
const LINUX = process.platform === "linux";
const WIN32 = process.platform === "win32";
const POSIX_PLATFORM = DARWIN ? "darwin" : "linux";
const TIMEOUT = { timeout: 600_000 };
const SIGNING = "evidence-signing-passphrase";
const MISTYPED = `sha256:${"0".repeat(64)}`;
const GRANT_LIFETIME_MS = 600_000;
// why: the environment the probe host itself gives every worker
// (SpawnedProbeWorker's base environment); a launch adds its approved extras.
const HOST_ENVIRONMENT = [
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "VERCHESTRA_PROBE_PROTOCOL",
  "VERCHESTRA_PROBE_WORKSPACE_ID"
];

let credentials;
let store;
let fixtures;
let product;

// invariant: C7's sensor. Every child_process entry point is wrapped, as the
// outermost layer above the fakes, so a start the fakes answer is seen too.
const started = [];
let recording = false;

function spyOnChildProcesses() {
  const record = (file) => {
    if (recording) started.push(String(file));
  };
  const wrap = (original, name) =>
    function spied(file, ...rest) {
      record(name === "exec" || name === "execSync" ? String(file).trim().split(/\s/u)[0] : file);
      return original.call(this, file, ...rest);
    };
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const original = childProcess[name];
    const spied = wrap(original, name);
    const custom = original[promisify.custom];
    if (typeof custom === "function") Object.defineProperty(spied, promisify.custom, { value: wrap(custom, name) });
    childProcess[name] = spied;
  }
  syncBuiltinESMExports();
}

async function storeItems(names) {
  const items = names.map((name) => [`verchestra/${fixtures.WORKSPACE_ID}|${name}`, fixtures.CREDENTIALS[name]]);
  await writeFile(store, JSON.stringify({ items: Object.fromEntries(items) }));
}

// why: the fakes read the store path when they load and the store itself each
// time they are asked, so the path is named before the fixture module (which
// loads the POSIX fake) is imported, and one store serves every fixture of
// this file: each binds the same Workspace ID.
before(async () => {
  credentials = await mkdtemp(join(tmpdir(), "vpk-"));
  store = join(credentials, "keychain-store.json");
  process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE = store;
  // why: the Secret Service backend asks only whether a session bus address
  // is set; the address names a socket that does not exist.
  if (LINUX) process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(credentials, "no-session-bus")}`;
  fixtures = await import("../helpers/task-cli-fixture.mjs");
  if (WIN32) await import("../helpers/fake-windows-spawn.mjs");
  spyOnChildProcesses();
  await storeItems([SIGNING]);
  const modules = await Promise.all([
    import("../../apps/vestra-cli/src/probe/probe-command.ts"),
    import("../../apps/vestra-cli/src/database/database-command.ts"),
    import("../../apps/vestra-cli/src/extension/extension-command.ts"),
    import("../../apps/vestra-cli/src/task/task-command.ts"),
    import("../../apps/vestra-cli/src/cli.ts"),
    import("../../apps/vestra-cli/src/release-manifest.ts"),
    import("../../packages/platform-node/src/probe-launch-digest.ts"),
    import("../../packages/extension-host/src/index.ts")
  ]);
  product = Object.assign({}, ...modules);
});

after(() => rm(credentials, { recursive: true, force: true, maxRetries: 5 }));
afterEach(() => fixtures.cleanupTaskFixtures());

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

// why: a confirmation read from a pipe, whose answer is decided when the
// command first reads it, so a case can look at what was shown before it.
class Answering extends EventEmitter {
  #answer;
  #asked = false;

  constructor(answer) {
    super();
    this.#answer = answer;
  }

  resume() {
    if (this.#asked) return this;
    this.#asked = true;
    setImmediate(async () => {
      const typed = await this.#answer();
      if (typed !== undefined) this.emit("data", Buffer.from(`${typed}\n`));
      this.emit("end");
    });
    return this;
  }

  pause() {
    return this;
  }
}

const FAMILIES = Object.freeze({
  probe: (command, io) => product.executeProbeCommand(command, io),
  database: (command, io) => product.executeDatabaseCommand(command, io),
  extension: (command, io) => product.executeExtensionCommand(command, io),
  task: (command, io) => product.executeTaskCommand(command, io)
});

// invariant: the CLI runner parses the arguments against the release manifest
// and maps a refusal to its exit code, exactly as main() does; the command bus
// is the named family alone. `answer` decides what is typed when the command
// reads its confirmation, from what it has written to stderr so far, and
// `onStderr` sees each write to stderr as the command makes it.
async function vestra(fixture, argv, { answer, input = "", platform = process.platform, onStderr } = {}) {
  const stdout = [];
  const stderr = [];
  const stdin =
    answer === undefined
      ? Readable.from(input === "" ? [] : [Buffer.from(input)])
      : new Answering(() => answer(stderr.join("")));
  const exitCode = await inWorkspaceHome(fixture, (env) =>
    product.runCli({
      argv: [...argv, "--output", "json"],
      invokedAs: "vestra",
      installedManifest: product.installedReleaseManifest,
      installedCliVersion: product.installedReleaseManifest.semanticVersion,
      commandBus: {
        execute: (command) =>
          FAMILIES[command.name.split(" ")[0]](command, {
            controlRoot: fixture.repository,
            platform,
            env,
            stdin,
            stderr: (value) => {
              stderr.push(value);
              onStderr?.(value);
            },
            pid: process.pid
          })
      },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    })
  );
  const text = stdout.join("");
  return { exitCode, json: JSON.parse(text), stdout: text, stderr: stderr.join("") };
}

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

const keychain = (fixture) => (DARWIN ? ["--keychain", fixture.keychain] : []);
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const entryPath = (fixture, worker) => join(fixture.repository, ...worker.entry.split("/"));

let files = 0;
async function jsonFile(fixture, value) {
  files += 1;
  const path = join(fixture.root, `input-${files}.json`);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

function workerNamed(name) {
  return { skill: `acme-${name}`, extension: `plugin:acme-${name}`, ref: name, entry: `probe/${name}.mjs` };
}

function addWorker(fixture, worker) {
  const flags = {
    skill: worker.skill,
    extension: worker.extension,
    entry: worker.entry,
    "approval-ref": worker.ref,
    version: "1.0.0",
    license: "MIT"
  };
  const argv = Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]);
  return vestra(fixture, ["extension", "add", ...argv, ...keychain(fixture)]);
}

// why: the launch digest is computed here as an approver's own tool would,
// and typed back on stdin through --confirm-stdin.
async function approveWorker(fixture, worker, launch = {}) {
  const { executable = process.execPath, args = [], environment = {}, expires } = launch;
  const path = entryPath(fixture, worker);
  const launchDigest = await product.probeLaunchDigest({
    executable,
    args,
    environment,
    entry: { path, digest: sha256(readFileSync(path)) }
  });
  const argv = [
    "extension",
    "approve",
    "--approval-ref",
    worker.ref,
    "--executable",
    executable,
    ...args.flatMap((value) => ["--arg", value]),
    ...Object.entries(environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    ...(expires === undefined ? [] : ["--expires", expires]),
    "--confirm-stdin",
    ...keychain(fixture)
  ];
  succeeded(await vestra(fixture, argv, { input: `${launchDigest}\n` }), `approve ${worker.ref}`);
  return launchDigest;
}

// why: the fixture's Workspace with the `orders` database registered and each
// worker registered and, unless a case says otherwise, approved: the SQLite
// worker with the database file as its argument, a reference worker in the
// mode the case names. On Windows nothing is approved, since approval refuses
// the platform, and every case asserts the refusal instead.
async function probeWorkspace({ workers = [SQLITE_WORKER], modes = {}, definitions = [ordersDefinition()] } = {}) {
  const fixture = await fixtures.taskFixture();
  const database = join(fixture.root, "orders.sqlite");
  if (WIN32) return { fixture, database, launchDigests: {} };
  await installWorkers(fixture, workers);
  ordersDatabase(database);
  for (const definition of definitions)
    succeeded(
      await vestra(fixture, [
        "database",
        "add",
        "--definition",
        await jsonFile(fixture, definition),
        ...keychain(fixture)
      ]),
      `database add ${definition.database.databaseId}`
    );
  const launchDigests = {};
  for (const worker of workers) {
    succeeded(await addWorker(fixture, worker), `extension add ${worker.ref}`);
    const mode = modes[worker.ref];
    if (mode === null) continue;
    launchDigests[worker.ref] = await approveWorker(
      fixture,
      worker,
      worker === SQLITE_WORKER
        ? { args: [databaseArgument(database)] }
        : { environment: { PROBE_FIXTURE_MODE: mode ?? "reference" } }
    );
  }
  return { fixture, database, launchDigests };
}

const typedBack = (review) => bindingDigestOf(review);

async function probe(fixture, request, options = {}) {
  const {
    worker = SQLITE_WORKER,
    database = "orders",
    confirm = true,
    answer = typedBack,
    platform,
    onStderr
  } = options;
  const path =
    typeof request === "string" && request.startsWith("@") ? request.slice(1) : await jsonFile(fixture, request);
  const argv = [
    "probe",
    "run",
    "--database",
    database,
    "--approval-ref",
    worker.ref,
    "--request",
    path,
    ...(confirm ? ["--confirm-stdin"] : []),
    ...keychain(fixture)
  ];
  return vestra(fixture, argv, {
    ...(answer === null ? {} : { answer }),
    ...(platform === undefined ? {} : { platform }),
    onStderr
  });
}

// why: the runtime store as the command left it, read beside it, never through
// a store that would migrate it.
function storeRows(fixture, sql, ...parameters) {
  const path = join(fixture.stateRoot, "runtime", "runtime.sqlite");
  if (!existsSync(path)) return [];
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(sql)
      .all(...parameters)
      .map((row) => ({ ...row }));
  } finally {
    db.close();
  }
}

const runs = (fixture) =>
  storeRows(
    fixture,
    "SELECT run_id AS runId, run_kind AS runKind, state, state_version AS version FROM runs ORDER BY rowid"
  );
const runOf = (fixture, runId) => runs(fixture).find((run) => run.runId === runId);
const approvalsOf = (fixture, runId) =>
  storeRows(fixture, "SELECT record_json AS record FROM authority_approvals WHERE run_id=?", runId).map((row) =>
    JSON.parse(row.record)
  );
const grantsOf = (fixture, runId) =>
  storeRows(
    fixture,
    "SELECT record_json AS record, revoked_at AS revokedAt FROM authority_grants WHERE run_id=?",
    runId
  ).map((row) => ({ ...JSON.parse(row.record), revokedAt: row.revokedAt }));

async function credentialLookups() {
  return (await readFile(`${store}.log`, "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// invariant: XP-04. On Windows a case asserts the platform refusal, with
// nothing read and no run created, instead of skipping.
async function refusedOnWindows(fixture, request = probeRequest()) {
  const before = await credentialLookups();
  refused(await probe(fixture, request), "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, "probe run on win32");
  assert.deepEqual(runs(fixture), []);
  assert.deepEqual(await credentialLookups(), before);
}

// why: a pre-run refusal leaves the store without a run.
function noRun(fixture, label) {
  assert.deepEqual(runs(fixture), [], `${label} created a run`);
}

test("the review names the run's binding before the digest is typed", TIMEOUT, async () => {
  const { fixture, launchDigests } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  let shown;
  const result = await probe(fixture, probeRequest(), {
    answer: (review) => {
      shown = { review, runs: runs(fixture) };
      return bindingDigestOf(review);
    }
  });
  const data = succeeded(result, "a confirmed run");
  const line = (label, value) => assert.match(shown.review, new RegExp(`^ {2}${label}: +${value}$`, "mu"), label);
  line("database", "orders");
  line("engine", "sqlite");
  line("logical environment", "staging");
  line("classification", "confidential");
  line("production", "false");
  line("purpose", "diagnostics");
  line("statement fingerprint", data.result.queryFingerprint);
  line("objects read", "main\\.orders");
  line("bounds", "rows 100, bytes 100000, timeout-ms 20000, concurrency 1");
  line("worker", SQLITE_WORKER.extension.replace(".", "\\."));
  line("launch digest", launchDigests[SQLITE_WORKER.ref]);
  const [approval] = approvalsOf(fixture, data.runId);
  line("binding digest", approval.bindingDigest);
  assert.match(shown.review, new RegExp(`^Approve probe run ${data.runId}:$`, "mu"));
  assert.deepEqual(shown.runs, [
    { runId: data.runId, runKind: "probe", state: "AWAITING_EXECUTION_APPROVAL", version: 1 }
  ]);
});

test("the request's parameters never reach the output", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace({
    workers: [SQLITE_WORKER, REFERENCE_WORKER],
    modes: { [REFERENCE_WORKER.ref]: "leak" }
  });
  const request = probeRequest({ parameters: [SENTINEL] });
  if (WIN32) {
    await refusedOnWindows(fixture, request);
    return;
  }
  const completed = await probe(fixture, request);
  assert.equal(succeeded(completed, "a completed run").result.rowCount, 0);
  const leaked = await probe(fixture, request, { worker: REFERENCE_WORKER });
  refused(leaked, "VES_PROBE_SECRET_LEAK", 5, "a worker that echoes its parameters");
  for (const [label, result] of [
    ["completed", completed],
    ["refused", leaked]
  ]) {
    assert.equal(result.stdout.includes(SENTINEL), false, `${label} stdout`);
    assert.equal(result.stderr.includes(SENTINEL), false, `${label} stderr`);
    assert.equal(JSON.stringify(result.json).includes(SENTINEL), false, `${label} envelope`);
  }
});

// invariant: every parameter takes the registration's classification, so a
// statement with several parameters plans one classification per bind and the
// worker binds them all (.specs/features/probe-multi-parameter/checks.md C6, C7).
test("a probe run binds every parameter", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  const sql = "SELECT id, status FROM main.orders WHERE id = ? AND status = ?";
  if (WIN32) return refusedOnWindows(fixture, probeRequest({ sql, parameters: [1, "paid"] }));
  const matched = succeeded(await probe(fixture, probeRequest({ sql, parameters: [1, "paid"] })), "a matching row");
  assert.equal(matched.result.status, "complete");
  assert.equal(matched.result.rowCount, 1);
  assert.equal(runOf(fixture, matched.runId).state, "COMPLETED");
  const other = succeeded(await probe(fixture, probeRequest({ sql, parameters: [1, "pending"] })), "another status");
  assert.equal(other.result.rowCount, 0);
  const sentinel = await probe(fixture, probeRequest({ sql, parameters: [1, SENTINEL] }));
  assert.equal(succeeded(sentinel, "a sentinel status").result.rowCount, 0);
  assert.equal(sentinel.stdout.includes(SENTINEL), false, "stdout");
  assert.equal(sentinel.stderr.includes(SENTINEL), false, "stderr");
  assert.equal(JSON.stringify(sentinel.json).includes(SENTINEL), false, "envelope");
});

test("a confirmed probe run records its approval and grant and prints the envelope", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  const data = succeeded(await probe(fixture, probeRequest()), "a confirmed run");
  assert.deepEqual(Object.keys(data).sort(), ["approvalId", "grantId", "result", "runId"]);
  assert.equal(data.result.status, "complete");
  assert.equal(data.result.rowCount, 1);
  assert.equal(data.result.databaseId, "orders");
  assert.equal(data.result.grantRef, data.grantId);
  const approvals = approvalsOf(fixture, data.runId);
  assert.deepEqual(
    approvals.map((approval) => [approval.approvalId, approval.action, approval.binding.runId]),
    [[data.approvalId, "probe-execution", data.runId]]
  );
  const grants = grantsOf(fixture, data.runId);
  assert.deepEqual(
    grants.map((grant) => [grant.grantId, grant.capability, grant.runId]),
    [[data.grantId, "database-read", data.runId]]
  );
  assert.equal(Date.parse(grants[0].expiresAt) - Date.parse(grants[0].issuedAt), GRANT_LIFETIME_MS);
});

test("a completed probe run ends COMPLETED", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  const data = succeeded(await probe(fixture, probeRequest()), "a confirmed run");
  const run = runOf(fixture, data.runId);
  assert.equal(run.state, "COMPLETED");
  assert.equal(run.runKind, "probe");
});

test("the grant is revoked when the run ends", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace({
    workers: [SQLITE_WORKER, REFERENCE_WORKER],
    modes: { [REFERENCE_WORKER.ref]: "leak" }
  });
  if (WIN32) return refusedOnWindows(fixture);
  const completed = succeeded(await probe(fixture, probeRequest()), "a completed run");
  refused(await probe(fixture, probeRequest(), { worker: REFERENCE_WORKER }), "VES_PROBE_SECRET_LEAK", 5, "leak");
  const failed = runs(fixture).find((run) => run.runId !== completed.runId);
  assert.equal(runOf(fixture, completed.runId).state, "COMPLETED");
  assert.equal(failed.state, "FAILED");
  for (const [label, runId] of [
    ["completed", completed.runId],
    ["refused", failed.runId]
  ]) {
    const grants = grantsOf(fixture, runId);
    assert.equal(grants.length, 1, `${label} has one grant`);
    assert.ok(Number.isFinite(Date.parse(grants[0].revokedAt)), `${label} grant is revoked`);
  }
});

test("a refusal after the grant fails the run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace({
    workers: [REFERENCE_WORKER],
    modes: { [REFERENCE_WORKER.ref]: "leak" }
  });
  if (WIN32) return refusedOnWindows(fixture);
  refused(
    await probe(fixture, probeRequest(), { worker: REFERENCE_WORKER }),
    "VES_PROBE_SECRET_LEAK",
    5,
    "a worker that echoes its parameters"
  );
  const [run] = runs(fixture);
  assert.equal(run.runKind, "probe");
  assert.equal(run.state, "FAILED");
  assert.equal(approvalsOf(fixture, run.runId).length, 1);
  assert.equal(grantsOf(fixture, run.runId).length, 1);
});

test("a run whose digest is not typed back is aborted", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  const git = (file) => ["git", "git.exe"].includes(basename(file).toLowerCase());
  for (const [label, options] of [
    ["a mistyped digest", { answer: () => MISTYPED }],
    ["no terminal and no --confirm-stdin", { confirm: false, answer: null }]
  ]) {
    const before = runs(fixture).map((run) => run.runId);
    // why: the review is shown once the run exists, before its digest is read.
    let reviewedAt;
    const onStderr = (value) => {
      if (reviewedAt === undefined && value.startsWith("Approve probe run ")) reviewedAt = started.length;
    };
    started.length = 0;
    recording = true;
    let result;
    try {
      result = await probe(fixture, probeRequest(), { ...options, onStderr });
    } finally {
      recording = false;
    }
    refused(result, "VES_TASK_CONFIRMATION_REQUIRED", 5, label);
    const [run] = runs(fixture).filter((entry) => !before.includes(entry.runId));
    assert.equal(run.state, "ABORTED", label);
    assert.deepEqual(approvalsOf(fixture, run.runId), [], `${label} recorded an approval`);
    assert.deepEqual(grantsOf(fixture, run.runId), [], `${label} issued a grant`);
    assert.notEqual(reviewedAt, undefined, `${label} showed no review`);
    // why: the spy's positive control. The command locates its Workspace
    // through Git before the run exists, so a spy that recorded nothing would
    // fail here instead of passing every assertion of emptiness below.
    assert.ok(started.slice(0, reviewedAt).some(git), `${label} recorded no Git start before the review`);
    assert.deepEqual(started.slice(reviewedAt), [], `${label} started a process once its run existed`);
    // why: the signing passphrase is read before the run exists (AC 14), so
    // the credential store's own tool is the one start besides Git the
    // command makes, and it is over before the run is created.
    const others = started.filter((file) => !git(file) && !CREDENTIAL_TOOL.test(file));
    assert.deepEqual(others, [], `${label} started a process other than Git`);
  }
});

test("a probe of an absent or invalid registration creates no run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  refused(await probe(fixture, probeRequest(), { database: "invoices" }), "VES_DATABASE_NOT_FOUND", 5, "absent");
  const path = join(fixture.repository, ".verchestra", "databases", "orders.json");
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  assert.equal(statement.predicate.content.policy.maxRows, 100);
  statement.predicate.content.policy.maxRows = 100_000;
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  refused(await probe(fixture, probeRequest()), "VES_DATABASE_REGISTRATION_INVALID", 5, "maxRows edited after signing");
  noRun(fixture, "an absent or invalid registration");
});

test("a probe of an engine other than SQLite creates no run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace({ definitions: [ordersDefinition(), postgresDefinition()] });
  if (WIN32) return refusedOnWindows(fixture);
  refused(
    await probe(fixture, probeRequest(), { database: "orders-pg" }),
    "VES_PROBE_ENGINE_UNAVAILABLE",
    5,
    "a valid postgresql registration"
  );
  noRun(fixture, "a postgresql registration");
});

test("SQL the SQLite parser refuses creates no run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  for (const [sql, code] of [
    ["DELETE FROM orders", "VES_SQLITE_WRITE_DENIED"],
    ["SELECT 1; SELECT 2", "VES_SQLITE_BATCH_DENIED"],
    ["PRAGMA user_version", "VES_SQLITE_PRAGMA_DENIED"]
  ])
    refused(await probe(fixture, probeRequest({ sql, parameters: [] })), code, 5, sql);
  noRun(fixture, "refused SQL");
});

test("a request outside the registration or its policy creates no run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  for (const [label, request, code] of [
    ["purpose export", probeRequest({ purpose: "export" }), "VES_PROBE_PURPOSE_DENIED"],
    [
      "a statement reading main.customers",
      probeRequest({ sql: "SELECT id FROM main.customers WHERE id = ?" }),
      "VES_PROBE_OBJECT_DENIED"
    ],
    ["rowLimit 101", probeRequest({ bounds: { ...probeRequest().bounds, rowLimit: 101 } }), "VES_PROBE_BOUNDS_DENIED"]
  ])
    refused(await probe(fixture, request), code, 5, label);
  noRun(fixture, "a request outside the policy");
});

test("a worker approval that does not hold creates no run", TIMEOUT, async () => {
  const states = ["unapproved", "revoked", "expired", "entry-edited", "executable-changed"].map(workerNamed);
  const { fixture } = await probeWorkspace({
    workers: states,
    modes: Object.fromEntries(states.map((worker) => [worker.ref, null]))
  });
  if (WIN32) return refusedOnWindows(fixture);
  const [unapproved, revoked, expired, edited, changed] = states;
  const runtime = join(fixture.root, "worker-runtime");
  await writeFile(runtime, "runtime bytes, first build\n");
  await approveWorker(fixture, revoked);
  succeeded(
    await vestra(fixture, ["extension", "revoke", "--approval-ref", revoked.ref, ...keychain(fixture)]),
    "revoke"
  );
  await approveWorker(fixture, expired, { expires: new Date(Date.now() + 1_500).toISOString() });
  await approveWorker(fixture, edited);
  await approveWorker(fixture, changed, { executable: runtime });
  await writeFile(entryPath(fixture, edited), `${await readFile(entryPath(fixture, edited), "utf8")}// edited\n`);
  await writeFile(runtime, "runtime bytes, second build\n");
  await new Promise((resolve) => setTimeout(resolve, 1_600));
  for (const [worker, expected] of [
    [unapproved, "VES_PROBE_WORKSPACE_TRUST_APPROVAL"],
    [revoked, "VES_PROBE_WORKSPACE_TRUST_APPROVAL"],
    [expired, "VES_PROBE_WORKSPACE_TRUST_APPROVAL"],
    [edited, "VES_PROBE_HOST_ENTRY_DIGEST"],
    [changed, "VES_PROBE_HOST_LAUNCH_DIGEST"]
  ]) {
    const check = await vestra(fixture, ["extension", "check", "--approval-ref", worker.ref]);
    assert.equal(check.exitCode, 4, worker.ref);
    const failing = check.json.data.checks.find((row) => row.status === "fail");
    assert.equal(failing.code, expected, `${worker.ref}: extension check`);
    refused(await probe(fixture, probeRequest(), { worker }), failing.code, 5, worker.ref);
  }
  noRun(fixture, "a worker approval that does not hold");
});

test("a request file that is not a request creates no run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  // why: the reader runs before anything else is read, so on Windows the case
  // runs as on POSIX under a POSIX platform.
  const platform = WIN32 ? POSIX_PLATFORM : process.platform;
  const request = probeRequest();
  const { bounds, ...withoutBounds } = request;
  assert.ok(bounds !== undefined);
  const valid = JSON.stringify(request);
  const missing = join(fixture.root, "no-such-request.json");
  const argument = async (label, path) => {
    const argv = ["probe", "run", "--database", "orders", "--approval-ref", SQLITE_WORKER.ref];
    const result = await vestra(fixture, [...argv, ...(path === undefined ? [] : ["--request", path])], { platform });
    const envelope = refused(result, "VES_CLI_ARGUMENT_INVALID", 2, label);
    assert.deepEqual(envelope.safeDetails, { argument: "--request" }, label);
  };
  await argument("no --request", undefined);
  await argument("a missing file", missing);
  await argument("65,537 bytes", await jsonFile(fixture, valid.padEnd(65_537, " ")));
  await argument("text that is not JSON", await jsonFile(fixture, "{ not json\n"));
  await argument("an extra key", await jsonFile(fixture, { ...request, kind: "select" }));
  await argument("no bounds", await jsonFile(fixture, withoutBounds));
  await argument("schemaVersion 2", await jsonFile(fixture, { ...request, schemaVersion: 2 }));
  const padded = await jsonFile(fixture, valid.padEnd(65_536, " "));
  assert.equal((await readFile(padded)).length, 65_536);
  const passed = await vestra(
    fixture,
    ["probe", "run", "--database", "invoices", "--approval-ref", SQLITE_WORKER.ref, "--request", padded],
    { platform }
  );
  assert.equal(passed.exitCode, 5, "a valid request padded to 65,536 bytes passes the reader");
  assert.notEqual(passed.json.error.code, "VES_CLI_ARGUMENT_INVALID");
  if (!WIN32) assert.equal(passed.json.error.code, "VES_DATABASE_NOT_FOUND");
  noRun(fixture, "a request file that is not a request");
});

test("a probe run without the signing passphrase creates no run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  await storeItems([]);
  try {
    const envelope = refused(await probe(fixture, probeRequest()), "VES_TASK_NOT_CONFIGURED", 5, "no passphrase");
    assert.deepEqual(envelope.safeDetails, { requirement: SIGNING });
  } finally {
    await storeItems([SIGNING]);
  }
  noRun(fixture, "a run without the signing passphrase");
});

test("Windows refuses a probe run before reading anything", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const before = await credentialLookups();
  const missing = join(fixture.root, "no-such-request.json");
  const result = await probe(fixture, `@${missing}`, { platform: "win32" });
  refused(result, "VES_PROBE_HOST_PLATFORM_UNSUPPORTED", 5, "a missing request file on win32");
  assert.deepEqual(await credentialLookups(), before, "a credential was read");
  noRun(fixture, "a refused platform");
});

test("the worker gets only its approved launch environment", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace({
    workers: [REFERENCE_WORKER],
    modes: { [REFERENCE_WORKER.ref]: "report-environment" }
  });
  if (WIN32) return refusedOnWindows(fixture);
  const reports = [];
  const append = product.MemoryProbeResultSink.prototype.append;
  product.MemoryProbeResultSink.prototype.append = function observed(transactionId, rows) {
    reports.push(...rows.map((row) => structuredClone(row)));
    return append.call(this, transactionId, rows);
  };
  const lookups = (await credentialLookups()).length;
  let data;
  try {
    data = succeeded(await probe(fixture, probeRequest(), { worker: REFERENCE_WORKER }), "a reporting worker");
  } finally {
    product.MemoryProbeResultSink.prototype.append = append;
  }
  assert.equal(data.result.rowCount, 1);
  const asked = (await credentialLookups()).slice(lookups);
  assert.ok(asked.length > 0, "the credential store was never asked");
  assert.deepEqual([...new Set(asked.map((entry) => entry.account))], [SIGNING]);
  // why: macOS adds its text-encoding hint to every new process, and Node's
  // spawn adds NODE_V8_COVERAGE to an explicit environment in a coverage run;
  // neither is supplied by the host or the approval.
  const runtimeAdded = new Set(["__CF_USER_TEXT_ENCODING", "NODE_V8_COVERAGE"]);
  const [report] = reports;
  assert.deepEqual(
    report.environmentKeys.filter((key) => !runtimeAdded.has(key)),
    [...HOST_ENVIRONMENT, "PROBE_FIXTURE_MODE"].sort()
  );
});

test("task commands refuse a probe run", TIMEOUT, async () => {
  const { fixture } = await probeWorkspace();
  if (WIN32) return refusedOnWindows(fixture);
  const { runId } = succeeded(await probe(fixture, probeRequest()), "a completed run");
  const before = runOf(fixture, runId);
  for (const argv of [
    ["task", "status", "--run-id", runId],
    ["task", "resume", "--run-id", runId],
    ["task", "cancel", "--run-id", runId],
    ["task", "review", "--run-id", runId, "--outcome", "accepted", "--surface-digest", MISTYPED, "--confirm-stdin"]
  ]) {
    const result = await vestra(fixture, [...argv, ...keychain(fixture)], { input: `${MISTYPED}\n` });
    refused(result, "VES_TASK_RUN_NOT_FOUND", 5, argv[1]);
    assert.deepEqual(runOf(fixture, runId), before, `${argv[1]} changed the probe run`);
  }
});

test("main routes a vestra probe command to the probe command", TIMEOUT, async (t) => {
  const { main } = await import("../../apps/vestra-cli/src/main.ts");
  const root = await temporaryDirectory(t, "vpm-");
  const request = join(await temporaryDirectory(t, "vpr-"), "request.json");
  await writeFile(request, JSON.stringify(probeRequest()));
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
    const argv = ["probe", "run", "--database", "orders", "--approval-ref", "orders-sqlite", "--request", request];
    exitCode = await main("vestra", [...argv, "--output", "json"]);
  } finally {
    process.chdir(cwd);
    process.stdout.write = write;
  }
  const envelope = JSON.parse(stdout);
  assert.equal(exitCode, 5, stdout);
  assert.equal(envelope.command, "probe run");
  assert.equal(envelope.error.code, WIN32 ? "VES_PROBE_HOST_PLATFORM_UNSUPPORTED" : "VES_INIT_WORKSPACE_MISSING");
  assert.deepEqual(await readdir(root), []);
});
