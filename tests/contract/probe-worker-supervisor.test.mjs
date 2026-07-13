import assert from "node:assert/strict";
import { test } from "node:test";

import { workerFixture } from "../helpers/probe-worker-fixture.mjs";

test("worker executes only after principal and session read-only evidence", async () => {
  const { supervisor, worker } = await workerFixture();
  const result = await supervisor.execute();
  assert.deepEqual(worker.calls.slice(0, 4), ["handshake", "identity", "session", "execute"]);
  assert.equal(result.status, "complete");
});

test("bounded chunks commit one protected result envelope", async () => {
  const { supervisor, results } = await workerFixture({ worker: { chunks: [[{ id: 1 }], [{ id: 2 }]] } });
  const result = await supervisor.execute();
  assert.equal(result.rowCount, 2);
  assert.match(result.protectedResultRef, /^protected-result:/u);
  assert.equal(results.commits, 1);
  assert.equal(results.rollbacks, 0);
});

test("result envelope binds plan, query, database, run, bounds, and classifications", async () => {
  const { supervisor, plan } = await workerFixture();
  const result = await supervisor.execute();
  assert.deepEqual(
    [result.planDigest, result.queryFingerprint, result.databaseId, result.grantRef],
    [plan.planDigest, plan.statementFingerprint, plan.databaseId, plan.grantRef]
  );
  assert.deepEqual(result.parameterClassifications, ["internal"]);
  assert.deepEqual(result.bounds, plan.bounds);
});

test("protected parameter bytes are zeroized after worker execution", async () => {
  const { supervisor, parameters } = await workerFixture();
  await supervisor.execute();
  assert.equal(
    parameters.lastDelivered.every((byte) => byte === 0),
    true
  );
});

test("successful execution requests no cancellation", async () => {
  const { supervisor, worker } = await workerFixture();
  await supervisor.execute();
  assert.equal(worker.cancelled, false);
  assert.equal(worker.terminated, false);
});

test("result rows remain behind protected reference", async () => {
  const { supervisor } = await workerFixture({ worker: { chunks: [[{ email: "a@example.test" }]] } });
  const result = await supervisor.execute();
  assert.equal(JSON.stringify(result).includes("a@example.test"), false);
});

test("empty bounded result commits deterministically", async () => {
  const { supervisor } = await workerFixture({ worker: { chunks: [] } });
  const result = await supervisor.execute();
  assert.equal(result.rowCount, 0);
  assert.equal(result.byteCount, 0);
});

test("repeat execution yields a distinct result reference but same content digest", async () => {
  const first = await workerFixture();
  const second = await workerFixture();
  const a = await first.supervisor.execute();
  const b = await second.supervisor.execute();
  assert.equal(a.resultDigest, b.resultDigest);
  assert.notEqual(a.protectedResultRef, b.protectedResultRef);
});
