// invariant: S3 of .specs/features/sqlite-probe-worker/checks.md. The worker
// process is the bundle `scripts/build-probe-worker.mjs` writes, run as it is
// shipped: directly with `node` for its configuration (C10), and through the
// real spawned transport, the framed protocol and the supervisor over a real
// SQLite file (C11, C12). The spawned probe host runs on Linux and macOS; on
// Windows those cases assert its platform refusal instead of skipping (XP-04).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { before, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DatabaseRegistry,
  MemoryDatabaseRegistrationStore,
  ProbePlanner,
  normalizeDatabaseRegistration
} from "../../packages/data-probe/src/index.ts";
import {
  FramedProbeWorker,
  MemoryProbeResultSink,
  MemoryProtectedParameterBroker,
  ProbeWorkerSupervisor
} from "../../packages/extension-host/src/index.ts";
import { SpawnedProbeWorker, probeLaunchDigest } from "../../packages/platform-node/src/index.ts";
import { sqliteStatement } from "../../apps/vestra-cli/src/probe/probe-statement.ts";
import { policy, registration, workspaceId } from "../helpers/database-probe-fixture.mjs";
import { ordersDatabase } from "../helpers/probe-run-fixture.mjs";
import { ObservingResultSink } from "../helpers/spawned-probe-worker-fixture.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const WIN32 = process.platform === "win32";
const BUILD_SCRIPT = fileURLToPath(new URL("../../scripts/build-probe-worker.mjs", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../../apps/vestra-cli/dist/sqlite-probe-worker.mjs", import.meta.url));
const COMPONENT = "plugin:acme-orders-sqlite";
const SQL = "SELECT id, status FROM main.orders WHERE id = ?";
const MAXIMUM_MESSAGE_BYTES = 65_536;

before(() => {
  execFileSync(process.execPath, [BUILD_SCRIPT], { stdio: "pipe", windowsHide: true });
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

// why: the fixture of the checks: a SQLite file whose `main.orders` holds
// (1, paid), (2, pending) and (3, shipped).
async function ordersFile(t) {
  const directory = await temporaryDirectory(t, "verchestra-sqlite-worker-");
  const path = join(directory, "orders.sqlite");
  ordersDatabase(path);
  return path;
}

// why: the worker started as the host starts it, with an environment built
// from nothing; Windows needs its system root to start Node at all.
function runWorker(environment) {
  return spawnSync(process.execPath, [BUNDLE], {
    env: { ...(WIN32 ? { SystemRoot: process.env.SystemRoot } : {}), ...environment },
    input: "",
    windowsHide: true,
    timeout: 30_000
  });
}

test("the worker exits before the handshake without its configuration", async (t) => {
  const database = await ordersFile(t);
  const configured = {
    VERCHESTRA_PROBE_WORKSPACE_ID: workspaceId,
    PROBE_SQLITE_PATH: database,
    PROBE_COMPONENT_ID: COMPONENT
  };
  // why: the control. Configured, the worker waits for the host and ends with
  // its input, so a refusal below is the configuration's and nothing else's.
  const control = runWorker(configured);
  assert.equal(control.status, 0, control.stderr.toString());
  assert.equal(control.stdout.length, 0);
  const without = (name) => Object.fromEntries(Object.entries(configured).filter(([key]) => key !== name));
  for (const [label, environment] of [
    ["no PROBE_SQLITE_PATH", without("PROBE_SQLITE_PATH")],
    ["no PROBE_COMPONENT_ID", without("PROBE_COMPONENT_ID")],
    ["an empty PROBE_SQLITE_PATH", { ...configured, PROBE_SQLITE_PATH: "" }],
    ["an empty PROBE_COMPONENT_ID", { ...configured, PROBE_COMPONENT_ID: "" }],
    ["a relative PROBE_SQLITE_PATH", { ...configured, PROBE_SQLITE_PATH: "orders.sqlite" }],
    ["a dot-relative PROBE_SQLITE_PATH", { ...configured, PROBE_SQLITE_PATH: "./data/orders.sqlite" }]
  ]) {
    const result = runWorker(environment);
    assert.equal(result.status, 5, `${label}: ${result.stderr.toString()}`);
    assert.equal(result.stdout.length, 0, `${label}: the worker wrote to stdout`);
  }
});

// why: the plan the supervisor serves, made by the real planner over a SQLite
// registration of `orders`, and the protected request the worker decodes.
async function ordersPlan() {
  const sqlite = registration({
    engine: "sqlite",
    databaseId: "orders",
    approvedSchemas: ["main"],
    policyRef: "orders"
  });
  const registry = new DatabaseRegistry({ store: new MemoryDatabaseRegistrationStore() });
  await registry.register(sqlite);
  const request = { purpose: "schema-discovery", sql: SQL, parameters: [1], bounds: {} };
  const statement = sqliteStatement(request, normalizeDatabaseRegistration(sqlite));
  const plan = await new ProbePlanner({ registry, adapters: [statement.adapter] }).plan(
    {
      schemaVersion: 1,
      workspaceId,
      requestId: "probe-request-001",
      databaseId: "orders",
      purpose: "schema-discovery",
      operation: statement.operation,
      bounds: { timeoutMs: 20_000, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 },
      grantRef: "capability-grant-001"
    },
    policy({ policyRef: "orders", allowedObjects: ["main.orders"], maxTimeoutMs: 20_000 })
  );
  return { plan, statement };
}

// why: the framed worker, with every handshake it reads kept for the case.
class ObservedFramedWorker extends FramedProbeWorker {
  handshakes = [];

  async handshake() {
    const handshake = await super.handshake();
    this.handshakes.push(handshake);
    return handshake;
  }
}

// why: the bundle launched as an approved launch is: the running Node, no
// arguments, and the two approved variables, measured as the host measures it.
async function launchWorker(environment, platform) {
  const launch = {
    executable: process.execPath,
    args: [],
    entry: { path: BUNDLE, digest: sha256(readFileSync(BUNDLE)) },
    environment
  };
  return SpawnedProbeWorker.launch({
    ...launch,
    approvedLaunchDigest: await probeLaunchDigest(launch),
    workspaceId,
    ...(platform === undefined ? {} : { platform })
  });
}

async function supervisedProbe(environment, results) {
  const { plan, statement } = await ordersPlan();
  const transport = await launchWorker(environment);
  const framed = new ObservedFramedWorker({ transport, workspaceId, maximumMessageBytes: MAXIMUM_MESSAGE_BYTES });
  const parameters = new MemoryProtectedParameterBroker();
  parameters.set(plan.operation.protectedRequestRef, statement.protectedRequest);
  const supervisor = new ProbeWorkerSupervisor({
    worker: framed,
    parameters,
    results,
    plan,
    expectedComponent: { id: COMPONENT, digest: sha256(readFileSync(BUNDLE)) },
    maximumMessageBytes: MAXIMUM_MESSAGE_BYTES
  });
  try {
    return {
      framed,
      outcome: await supervisor.execute().then(
        (value) => ({ value }),
        (error) => ({ error })
      )
    };
  } finally {
    await transport.terminate().catch(() => undefined);
  }
}

// invariant: XP-04. On Windows the launch the cases below make is refused for
// the platform before anything starts.
async function refusedOnWindows(database) {
  await assert.rejects(launchWorker({ PROBE_SQLITE_PATH: database, PROBE_COMPONENT_ID: COMPONENT }), {
    code: "VES_PROBE_HOST_PLATFORM_UNSUPPORTED"
  });
}

test("the bundled worker answers a probe over a real SQLite file", async (t) => {
  const database = await ordersFile(t);
  if (WIN32) return refusedOnWindows(database);
  const before = sha256(readFileSync(database));
  const results = new ObservingResultSink();
  const { framed, outcome } = await supervisedProbe(
    { PROBE_SQLITE_PATH: database, PROBE_COMPONENT_ID: COMPONENT },
    results
  );
  assert.equal(outcome.error, undefined, outcome.error?.stack);
  assert.equal(outcome.value.status, "complete");
  assert.equal(outcome.value.rowCount, 1);
  assert.deepEqual(results.observed, [{ id: 1, status: "paid" }]);
  assert.equal(results.commits, 1);
  assert.equal(framed.handshakes.length, 1);
  assert.deepEqual(framed.handshakes[0].component, { id: COMPONENT, digest: sha256(readFileSync(BUNDLE)) });
  assert.equal(sha256(readFileSync(database)), before, "the SQLite file's bytes are unchanged");
});

test("a worker that names another component is refused at the handshake", async (t) => {
  const database = await ordersFile(t);
  if (WIN32) return refusedOnWindows(database);
  const results = new MemoryProbeResultSink();
  const { framed, outcome } = await supervisedProbe(
    { PROBE_SQLITE_PATH: database, PROBE_COMPONENT_ID: "plugin:another-worker" },
    results
  );
  assert.equal(outcome.error?.code, "VES_PROBE_HANDSHAKE_COMPONENT", outcome.error?.stack);
  assert.equal(framed.handshakes[0].component.id, "plugin:another-worker");
  assert.equal(results.commits, 0, "no result is committed");
});
