import assert from "node:assert/strict";
import { test } from "node:test";

import { ProbeConcurrencyGate } from "../../packages/extension-host/src/index.ts";
import { workerFixture } from "../helpers/probe-worker-fixture.mjs";

test("timeout cancels then terminates an unresponsive worker and rolls back", async () => {
  const fixture = await workerFixture({
    request: { bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 } },
    worker: { delayMs: 100 }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(fixture.worker.cancelled, true);
  assert.equal(fixture.worker.terminated, true);
  assert.equal(fixture.results.commits, 0);
});

test("worker crash after a chunk produces no partial promoted evidence", async () => {
  const fixture = await workerFixture({ worker: { failAfterChunks: 1 } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_WORKER_FAILURE" });
  assert.equal(fixture.results.rollbacks, 1);
  assert.equal(fixture.results.commits, 0);
});

test("result sink failure cancels worker and rolls back", async () => {
  const fixture = await workerFixture();
  fixture.results.failAppend = true;
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_RESULT_FAILURE" });
  assert.equal(fixture.worker.cancelled, true);
  assert.equal(fixture.results.commits, 0);
});

test("concurrency gate rejects excess work without starting worker", async () => {
  const gate = new ProbeConcurrencyGate();
  const first = await workerFixture({ worker: { delayMs: 50 } });
  const second = await workerFixture();
  first.supervisor.concurrency = gate;
  second.supervisor.concurrency = gate;
  const pending = first.supervisor.execute();
  await assert.rejects(second.supervisor.execute(), { code: "VES_PROBE_CONCURRENCY_LIMIT" });
  await pending;
  assert.equal(second.worker.calls.length, 0);
});

test("concurrency lease releases after failure", async () => {
  const gate = new ProbeConcurrencyGate();
  const failed = await workerFixture({ worker: { failAfterChunks: 0 } });
  failed.supervisor.concurrency = gate;
  await assert.rejects(failed.supervisor.execute());
  const retry = await workerFixture();
  retry.supervisor.concurrency = gate;
  assert.equal((await retry.supervisor.execute()).status, "complete");
});

test("cancellation failure still terminates worker and rolls back", async () => {
  const fixture = await workerFixture({
    worker: { delayMs: 100, cancelFails: true },
    request: { bounds: { timeoutMs: 10, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 } }
  });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  assert.equal(fixture.worker.terminated, true);
  assert.equal(fixture.results.commits, 0);
});
