import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { nullableText } from "../../packages/memory/src/stored-text.ts";
import { storedText } from "../../packages/platform-node/src/runtime-store/runtime-sqlite.ts";
import { offlineGuard } from "../../packages/self-test/src/index.ts";
import { cleanup, opened, run, runId } from "../helpers/runtime-store-fixture.mjs";

// SonarCloud S6551 (T8): these sites passed a value that could be an object to
// String(), which would render it as "[object Object]" or a comma-joined byte
// list. A TEXT column now reads back only as text, failing closed otherwise,
// and the self-test guard describes a non-text host or port without
// stringifying it.

afterEach(cleanup);

const corrupt = () => Object.assign(new Error("corrupt"), { code: "VES_TEST_CORRUPT" });

test("a runtime TEXT column reads back only as a string", () => {
  assert.equal(storedText("run_1"), "run_1");
  for (const value of [new Uint8Array([1, 2]), 7, {}, undefined]) {
    assert.throws(() => storedText(value), { code: "VES_RUNTIME_CORRUPT" });
  }
});

test("a nullable memory TEXT column reads back as a string or null", () => {
  assert.equal(nullableText(null, corrupt), null);
  assert.equal(nullableText("2026-07-16T12:00:00.000Z", corrupt), "2026-07-16T12:00:00.000Z");
  for (const value of [new Uint8Array([1, 2]), 7, {}, undefined]) {
    assert.throws(() => nullableText(value, corrupt), { code: "VES_TEST_CORRUPT" });
  }
});

test("a run's optional text columns read back verbatim", async () => {
  const { dbPath, store } = await opened();
  store.createRun(run());
  assert.deepEqual(
    Object.keys(store.getRun(runId)).filter((key) => key.endsWith("RunId") || key === "implementationActorId"),
    []
  );
  const db = new DatabaseSync(dbPath);
  db.prepare(
    `UPDATE runs SET approval_binding_digest=?, implementation_actor_id=?, predecessor_run_id=?, successor_run_id=?
     WHERE run_id=?`
  ).run("sha256:binding", "actor:implementer", "run_predecessor", "run_successor", runId);
  db.close();
  const snapshot = store.getRun(runId);
  assert.deepEqual(snapshot.approval, { bindingDigest: "sha256:binding" });
  assert.equal(snapshot.implementationActorId, "actor:implementer");
  assert.equal(snapshot.predecessorRunId, "run_predecessor");
  assert.equal(snapshot.successorRunId, "run_successor");
});

test("a sync state whose projection remote version is not text is refused", async () => {
  const { store } = await opened();
  const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-7123456789ab";
  const stateDigest = `sha256:${"b".repeat(64)}`;
  const state = {
    workspaceId,
    stateDigest,
    generations: [],
    ingestionManifests: [],
    projects: [],
    projections: [
      {
        projectionId: "projection_1",
        projectId: "project_1",
        connectorId: "connector_1",
        canonicalDigest: `sha256:${"c".repeat(64)}`,
        observedRemoteDigest: `sha256:${"d".repeat(64)}`,
        observedRemoteVersion: { version: 7 }
      }
    ]
  };
  assert.throws(() => store.saveSyncState(workspaceId, JSON.stringify(state), stateDigest), {
    code: "VES_RUNTIME_CONSTRAINT",
    message: "Workspace sync projection remote version is invalid"
  });
  assert.equal(store.getSyncState(workspaceId), undefined);
});

test("the offline guard names a non-text host or port without stringifying it", () => {
  const guard = offlineGuard();
  try {
    assert.throws(() => new net.Socket().connect({ host: "a.invalid", port: 80 }));
    assert.throws(() => new net.Socket().connect({ host: "b.invalid", port: { toString: () => "x" } }));
    assert.throws(() => http.request({ hostname: { name: "c" }, path: "/p" }));
    assert.throws(() => http.request({ host: "d.invalid", path: "/q" }));
  } finally {
    guard.restore();
  }
  assert.deepEqual(
    guard.attempts().map((attempt) => attempt.target),
    ["a.invalid:80", "b.invalid:", "unknown-host/p", "d.invalid/q"]
  );
});
