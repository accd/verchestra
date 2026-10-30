// invariant: S4 of .specs/features/sqlite-probe-worker/checks.md, the plan's
// independent test. Through the real `vestra` launcher, in a disposable
// Workspace: write Verchestra's SQLite worker with `vestra probe worker`,
// commit and register it, approve it with the running Node, the SQLite file
// and its extension id in its environment, register the file, and run one
// probe with its binding digest typed back. A worker approved without its
// database, or naming another component, fails its run. The probe host runs on
// Linux and macOS; on Windows the case writes the worker and asserts the
// platform refusal of `probe run` instead of skipping (XP-04).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { probePublicErrorRegistry } from "../../apps/vestra-cli/src/probe/probe-errors.ts";
import { probeLaunchDigest } from "../../packages/platform-node/src/probe-launch-digest.ts";
import {
  ORIGIN,
  bindingDigestOf,
  ordersDatabase,
  ordersDefinition,
  probeRequest
} from "../helpers/probe-run-fixture.mjs";
import { LINUX, WIN32, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";

const TIMEOUT = { timeout: 600_000 };
const BUILD_SCRIPT = fileURLToPath(new URL("../../scripts/build-probe-worker.mjs", import.meta.url));
const ORDERS = Object.freeze({
  skill: "acme-orders-sqlite",
  extension: "plugin:acme-orders-sqlite",
  ref: "orders-sqlite",
  entry: "probe/sqlite-worker.mjs"
});

before(() => {
  execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: "pipe", windowsHide: true });
});

afterEach(cleanupTaskFixtures);

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function vestra(fixture, argv, input = "") {
  const result = fixture.launch([...argv, "--output", "json"], input);
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
  if (code !== undefined) assert.equal(result.json.error.code, code, `${label}: ${JSON.stringify(result.json.error)}`);
  return result.json.error;
}

// why: the owner reads the review on stderr and types its binding digest back
// on stdin, as `--confirm-stdin` reads it.
function probeRun(fixture, worker, requestPath) {
  const argv = [
    "probe",
    "run",
    "--database",
    "orders",
    "--approval-ref",
    worker.ref,
    "--request",
    requestPath,
    "--confirm-stdin",
    ...fixture.keychainArgs,
    "--output",
    "json"
  ];
  return new Promise((resolve, reject) => {
    const child = fixture.launchAsync(argv);
    let stdout = "";
    let stderr = "";
    let answered = false;
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      const digest = bindingDigestOf(stderr);
      if (answered || digest === undefined) return;
      answered = true;
      child.stdin.end(`${digest}\n`);
    });
    child.on("error", reject);
    child.on("close", (status) => {
      let json;
      try {
        json = JSON.parse(stdout);
      } catch {
        json = undefined;
      }
      resolve({ status, stdout, stderr, json });
    });
  });
}

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

const runsOf = (fixture) =>
  storeRows(fixture, "SELECT run_id AS runId, state, run_kind AS runKind FROM runs ORDER BY rowid");
const grantsOf = (fixture, runId) =>
  storeRows(fixture, "SELECT grant_id AS grantId, revoked_at AS revokedAt FROM authority_grants WHERE run_id=?", runId);

// why: the worker the command writes, committed and registered as the owner
// does it: `vestra probe worker`, `git commit`, `vestra extension add`.
function writeAndRegister(fixture, worker) {
  const written = succeeded(
    vestra(fixture, ["probe", "worker", "--engine", "sqlite", "--entry", worker.entry]),
    `probe worker ${worker.entry}`
  );
  assert.equal(written.written, true);
  fixture.git(["add", "--", worker.entry]);
  fixture.git(["commit", "--quiet", "-m", `probe: ${worker.ref}`]);
  const flags = {
    skill: worker.skill,
    extension: worker.extension,
    entry: worker.entry,
    "approval-ref": worker.ref,
    version: "1.0.0",
    license: "MIT"
  };
  const add = Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]);
  succeeded(vestra(fixture, ["extension", "add", ...add, ...fixture.keychainArgs]), `extension add ${worker.ref}`);
  return written;
}

// why: the approval names the running Node and the worker's two variables; its
// launch digest is computed as an approver's own tool would and typed back.
async function approve(fixture, worker, environment) {
  const entry = join(fixture.repository, ...worker.entry.split("/"));
  const launchDigest = await probeLaunchDigest({
    executable: process.execPath,
    args: [],
    environment,
    entry: { path: entry, digest: sha256(readFileSync(entry)) }
  });
  const argv = [
    "extension",
    "approve",
    "--approval-ref",
    worker.ref,
    "--executable",
    process.execPath,
    ...Object.entries(environment).flatMap(([name, value]) => ["--env", `${name}=${value}`]),
    "--confirm-stdin",
    ...fixture.keychainArgs
  ];
  succeeded(vestra(fixture, argv, `${launchDigest}\n`), `extension approve ${worker.ref}`);
}

// why: the checks' fixture and steps 1 to 3 of the independent test.
async function journey() {
  const fixture = await taskFixture({ secretService: LINUX });
  fixture.git(["remote", "add", "origin", ORIGIN]);
  const database = join(fixture.root, "orders.sqlite");
  ordersDatabase(database);
  const requestPath = join(fixture.root, "request.json");
  await writeFile(requestPath, JSON.stringify(probeRequest()));
  const written = writeAndRegister(fixture, ORDERS);
  await approve(fixture, ORDERS, { PROBE_SQLITE_PATH: database, PROBE_COMPONENT_ID: ORDERS.extension });
  const definition = join(fixture.root, "orders.json");
  await writeFile(definition, JSON.stringify(ordersDefinition()));
  succeeded(vestra(fixture, ["database", "add", "--definition", definition, ...fixture.keychainArgs]), "database add");
  return { fixture, database, requestPath, written };
}

// why: a further reference to a worker the command writes, approved with the
// environment a case names.
async function another(fixture, name, environment) {
  const worker = {
    skill: `acme-${name}`,
    extension: `plugin:acme-${name}`,
    ref: name,
    entry: `probe/${name}.mjs`
  };
  writeAndRegister(fixture, worker);
  await approve(fixture, worker, environment(worker));
  return worker;
}

// invariant: the run a refused probe left: exactly one, ended FAILED, and its
// grant revoked.
function failedRun(fixture) {
  const runs = runsOf(fixture);
  assert.equal(runs.length, 1, JSON.stringify(runs));
  assert.deepEqual(
    { state: runs[0].state, runKind: runs[0].runKind },
    { state: "FAILED", runKind: "probe" },
    "the run ends FAILED"
  );
  const grants = grantsOf(fixture, runs[0].runId);
  assert.equal(grants.length, 1);
  assert.ok(Number.isFinite(Date.parse(grants[0].revokedAt)), "the grant carries a revocation");
}

async function refusedOnWindows() {
  const fixture = await taskFixture();
  const written = succeeded(
    vestra(fixture, ["probe", "worker", "--engine", "sqlite", "--entry", ORDERS.entry]),
    "probe worker on win32"
  );
  assert.equal(written.written, true);
  const requestPath = join(fixture.root, "request.json");
  await writeFile(requestPath, JSON.stringify(probeRequest()));
  refused(
    vestra(fixture, ["probe", "run", "--database", "orders", "--approval-ref", ORDERS.ref, "--request", requestPath]),
    "VES_PROBE_HOST_PLATFORM_UNSUPPORTED",
    5,
    "probe run on win32"
  );
  assert.deepEqual(runsOf(fixture), []);
}

test("the plan's independent test", TIMEOUT, async () => {
  if (WIN32) return refusedOnWindows();
  const { fixture, database, requestPath, written } = await journey();
  const entry = readFileSync(join(fixture.repository, ...ORDERS.entry.split("/")));
  assert.equal(written.digest, sha256(entry), "the printed digest is the written file's");
  const before = sha256(readFileSync(database));
  const data = succeeded(await probeRun(fixture, ORDERS, requestPath), "probe run");
  assert.equal(data.result.status, "complete");
  assert.equal(data.result.rowCount, 1);
  assert.equal(data.result.grantRef, data.grantId);
  assert.deepEqual(
    runsOf(fixture).map(({ runId, state, runKind }) => ({ runId, state, runKind })),
    [{ runId: data.runId, state: "COMPLETED", runKind: "probe" }]
  );
  assert.equal(sha256(readFileSync(database)), before, "the SQLite file's bytes are unchanged");
});

test("a worker approved without its database fails the run", TIMEOUT, async (t) => {
  if (WIN32) return refusedOnWindows();
  const { fixture, requestPath } = await journey();
  const worker = await another(fixture, "orders-unconfigured", (self) => ({ PROBE_COMPONENT_ID: self.extension }));
  const error = refused(await probeRun(fixture, worker, requestPath), undefined, 5, "a worker without its database");
  t.diagnostic(`refused with ${error.code}`);
  assert.ok(
    probePublicErrorRegistry.codes.includes(error.code),
    `${error.code} is not a code the probe family's registry declares`
  );
  failedRun(fixture);
});

test("a worker that names another component fails the run", TIMEOUT, async () => {
  if (WIN32) return refusedOnWindows();
  const { fixture, database, requestPath } = await journey();
  const worker = await another(fixture, "orders-renamed", () => ({
    PROBE_SQLITE_PATH: database,
    PROBE_COMPONENT_ID: ORDERS.extension
  }));
  refused(await probeRun(fixture, worker, requestPath), "VES_PROBE_HANDSHAKE_COMPONENT", 5, "another component");
  failedRun(fixture);
});
