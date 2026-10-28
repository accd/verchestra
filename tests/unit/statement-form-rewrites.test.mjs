import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  ApprovalRecorder,
  ApprovalRequester,
  ApprovalVerifier,
  CapabilityBroker,
  TaskScheduleCoordinator
} from "../../packages/application/src/index.ts";
import { SqliteReadConnection } from "../../packages/data-probe/src/sqlite-adapter.ts";
import { MemoryVectorIndex } from "../../packages/memory/src/memory-vector-index.ts";
import { terminateStoppedTree } from "../../packages/platform-node/src/process-tree-terminator.ts";
import { authorityFixture, grantRequest, intent } from "../helpers/authority-fixture.mjs";
import { publishedFixture } from "../helpers/handoff-fixture.mjs";
import { flush, scheduleInput, scheduleTask, schedulerPorts } from "../helpers/task-scheduler-fixture.mjs";

// SonarCloud S878, S6509, S1854, S2933, S7749 (T8): a comma expression became
// a block, a redundant Boolean call and two dead stores were removed, a field
// assigned once became readonly, and a fractional numeric separator was
// dropped. These pin the behaviour each rewritten statement carries.

test("a capability grant keeps its constraints in order and refuses an authority-bearing one", async () => {
  const fixture = authorityFixture();
  const approval = await new ApprovalRecorder(fixture).record(new ApprovalRequester(fixture).request(intent()), {
    kind: "human",
    id: "reviewer@example.test"
  });
  const policy = { authorize: async () => ({ decision: "allow", policyViewDigest: approval.binding.policyDigest }) };
  const broker = new CapabilityBroker({ ...fixture, approvals: new ApprovalVerifier(fixture), policy });
  const grant = await broker.grant(grantRequest(approval, { constraints: ["max-bytes:1", "path-prefix:a/"] }));
  assert.deepEqual(grant.constraints, ["max-bytes:1", "path-prefix:a/"]);
  assert.equal(Object.isFrozen(grant.constraints), true);
  for (const constraints of [["path-prefix:a/", "inherited"], ["not a value"], []]) {
    await assert.rejects(broker.grant(grantRequest(approval, { constraints })), {
      code: "VES_CAPABILITY_SCOPE_INVALID"
    });
  }
});

test("a schedule without a signal completes and an aborted signal cancels it", async () => {
  const plain = schedulerPorts();
  const completed = new TaskScheduleCoordinator(plain.ports).execute(scheduleInput([scheduleTask("T1")]));
  await flush();
  plain.release("T1");
  assert.equal((await completed).status, "completed");

  const controller = new AbortController();
  const aborted = schedulerPorts();
  const pending = new TaskScheduleCoordinator(aborted.ports).execute(
    scheduleInput([scheduleTask("T1"), scheduleTask("T2", { dependencies: ["T1"] })]),
    { signal: controller.signal }
  );
  await flush();
  controller.abort();
  aborted.release("T1");
  const report = await pending;
  assert.equal(report.status, "cancelled");
  assert.deepEqual(aborted.state.started, ["T1"]);
});

test("a Handoff records its sealed capsule before the final record", async () => {
  const { state, published } = await publishedFixture();
  assert.equal(published.status, "HANDED_OFF");
  const sealed = state.calls.indexOf("capsule:seal");
  assert.deepEqual(state.calls.slice(sealed, sealed + 3), ["capsule:seal", "progress:CAPSULE_SEALED", "final:save"]);
});

test("a SQLite read connection reports query-only mode from the open database", async () => {
  const root = await mkdtemp(join(tmpdir(), "verchestra-query-only-"));
  try {
    const path = join(root, "orders.db");
    const seed = new DatabaseSync(path);
    seed.exec("CREATE TABLE orders (id INTEGER)");
    seed.close();
    const connection = new SqliteReadConnection({ databaseId: "orders", path });
    try {
      assert.equal((await connection.inspectPrincipal()).queryOnly, true);
      const session = await connection.configureAuthorization({ objects: [{ name: "orders" }], functions: [] });
      assert.deepEqual([session.queryOnly, session.authorizer], [true, true]);
    } finally {
      connection.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an embedding value is bounded by the largest Float32 magnitude", () => {
  const index = new MemoryVectorIndex({ dbPath: "unused.db", mode: "preferred" });
  const build = (value) => ({
    schemaVersion: 1,
    workspaceId: "workspace-1",
    projectId: "project-1",
    authorityDigest: `sha256:${"a".repeat(64)}`,
    model: { provider: "fixture", modelId: "fixture-1d", revision: "r1", dimensions: 1, distance: "l2" },
    vectors: [
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        sourceId: "source-1",
        chunkId: "chunk-1",
        contentDigest: `sha256:${"b".repeat(64)}`,
        embedding: [value]
      }
    ]
  });
  // why: an accepted embedding passes validation and only then meets the
  // unopened index.
  for (const value of [3.402823466e38, -3.402823466e38, 0, -0]) {
    assert.throws(() => index.buildGeneration(build(value)), { code: "VES_VECTOR_UNAVAILABLE" }, String(value));
  }
  for (const value of [3.402823467e38, -3.402823467e38, Number.MAX_VALUE]) {
    assert.throws(
      () => index.buildGeneration(build(value)),
      { code: "VES_VECTOR_INPUT_INVALID", message: "embedding value is invalid" },
      String(value)
    );
  }
});

test("a stopped tree whose process table fails rethrows that failure and still kills the group", async () => {
  const refused = () => {
    throw new Error("incomplete");
  };
  if (process.platform === "win32") {
    await assert.rejects(
      terminateStoppedTree(process.pid, { exited: () => false, incomplete: refused }),
      /incomplete/u
    );
    return;
  }
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });
  await once(child, "spawn");
  const exited = once(child, "exit");
  await assert.rejects(
    terminateStoppedTree(child.pid, {
      exited: () => false,
      incomplete: refused,
      table: async () => {
        throw new Error("table unreadable");
      }
    }),
    /table unreadable/u
  );
  const [, signal] = await exited;
  assert.equal(signal, "SIGKILL");
});
