// invariant: the independent test of .specs/features/probe-run/plan.md. Through
// the real `vestra` launcher, in a disposable Workspace: register a SQLite
// database, register and approve a SQLite worker whose approved argument names
// the file, run one probe with its binding digest typed back, see its run
// completed and its grant revoked, see `task status` refuse the run, and see a
// second run with a mistyped digest aborted with no grant. The probe host runs
// on Linux and macOS; on Windows the case asserts the platform refusal instead
// of skipping (XP-04).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { probeLaunchDigest } from "../../packages/platform-node/src/probe-launch-digest.ts";
import {
  SQLITE_WORKER,
  bindingDigestOf,
  databaseArgument,
  installWorkers,
  ordersDatabase,
  ordersDefinition,
  probeRequest
} from "../helpers/probe-run-fixture.mjs";
import { LINUX, WIN32, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";

const TIMEOUT = { timeout: 600_000 };
const MISTYPED = `sha256:${"0".repeat(64)}`;

afterEach(cleanupTaskFixtures);

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
  assert.equal(result.json.error.code, code, `${label}: ${JSON.stringify(result.json.error)}`);
}

// why: the owner reads the review on stderr and types its binding digest, or
// another one, back on stdin, as `--confirm-stdin` reads it.
function probeRun(fixture, requestPath, typed) {
  const argv = [
    "probe",
    "run",
    "--database",
    "orders",
    "--approval-ref",
    SQLITE_WORKER.ref,
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
      child.stdin.end(`${typed(digest)}\n`);
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

const stateOf = (fixture, runId) =>
  storeRows(fixture, "SELECT state, run_kind AS runKind FROM runs WHERE run_id=?", runId)[0];
const grantsOf = (fixture, runId) =>
  storeRows(fixture, "SELECT grant_id AS grantId, revoked_at AS revokedAt FROM authority_grants WHERE run_id=?", runId);

test("the plan's independent test", TIMEOUT, async () => {
  const fixture = await taskFixture({ secretService: LINUX });
  const requestPath = join(fixture.root, "request.json");
  await writeFile(requestPath, JSON.stringify(probeRequest()));
  if (WIN32) {
    refused(
      vestra(fixture, [
        "probe",
        "run",
        "--database",
        "orders",
        "--approval-ref",
        "orders-sqlite",
        "--request",
        requestPath
      ]),
      "VES_PROBE_HOST_PLATFORM_UNSUPPORTED",
      5,
      "probe run on win32"
    );
    return;
  }
  await installWorkers(fixture, [SQLITE_WORKER]);
  const database = join(fixture.root, "orders.sqlite");
  ordersDatabase(database);
  const definition = join(fixture.root, "orders.json");
  await writeFile(definition, JSON.stringify(ordersDefinition()));

  // `database add`, `extension add` and `extension approve` set up the worker.
  succeeded(vestra(fixture, ["database", "add", "--definition", definition, ...fixture.keychainArgs]), "database add");
  const flags = {
    skill: SQLITE_WORKER.skill,
    extension: SQLITE_WORKER.extension,
    entry: SQLITE_WORKER.entry,
    "approval-ref": SQLITE_WORKER.ref,
    version: "1.0.0",
    license: "MIT"
  };
  const add = Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]);
  succeeded(vestra(fixture, ["extension", "add", ...add, ...fixture.keychainArgs]), "extension add");
  const entry = join(fixture.repository, ...SQLITE_WORKER.entry.split("/"));
  const args = [databaseArgument(database)];
  const launchDigest = await probeLaunchDigest({
    executable: process.execPath,
    args,
    entry: { path: entry, digest: `sha256:${createHash("sha256").update(readFileSync(entry)).digest("hex")}` }
  });
  const approve = [
    "extension",
    "approve",
    "--approval-ref",
    SQLITE_WORKER.ref,
    "--executable",
    process.execPath,
    ...args.flatMap((value) => ["--arg", value]),
    "--confirm-stdin",
    ...fixture.keychainArgs
  ];
  succeeded(vestra(fixture, approve, `${launchDigest}\n`), "extension approve");

  // `probe run` with the digest typed back reads one order.
  const completed = await probeRun(fixture, requestPath, (digest) => digest);
  const data = succeeded(completed, "probe run");
  assert.equal(data.result.status, "complete");
  assert.equal(data.result.rowCount, 1);
  assert.equal(data.result.grantRef, data.grantId);
  assert.deepEqual(stateOf(fixture, data.runId), { state: "COMPLETED", runKind: "probe" });
  const [grant] = grantsOf(fixture, data.runId);
  assert.equal(grant.grantId, data.grantId);
  assert.ok(Number.isFinite(Date.parse(grant.revokedAt)), "the grant is revoked");

  // `task status` refuses the probe run.
  const status = vestra(fixture, ["task", "status", "--run-id", data.runId, ...fixture.keychainArgs]);
  assert.equal(status.status, 5, `${status.stdout}\n${status.stderr}`);
  assert.equal(status.json.ok, false);
  assert.deepEqual(stateOf(fixture, data.runId), { state: "COMPLETED", runKind: "probe" });

  // A second run with a mistyped digest is aborted, with no grant.
  const mistyped = await probeRun(fixture, requestPath, () => MISTYPED);
  refused(mistyped, "VES_TASK_CONFIRMATION_REQUIRED", 5, "a mistyped digest");
  const aborted = storeRows(fixture, "SELECT run_id AS runId FROM runs WHERE run_id != ?", data.runId);
  assert.equal(aborted.length, 1);
  assert.deepEqual(stateOf(fixture, aborted[0].runId), { state: "ABORTED", runKind: "probe" });
  assert.deepEqual(grantsOf(fixture, aborted[0].runId), []);
});
