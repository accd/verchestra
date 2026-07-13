import assert from "node:assert/strict";
import { test } from "node:test";

import { workerFixture } from "../helpers/probe-worker-fixture.mjs";

for (const [label, worker, code] of [
  ["overprivileged principal", { principalReadOnly: false }, "VES_PROBE_IDENTITY_NOT_READ_ONLY"],
  ["missing principal evidence", { omitIdentity: true }, "VES_PROBE_IDENTITY_INVALID"],
  ["writable session", { sessionReadOnly: false }, "VES_PROBE_SESSION_NOT_READ_ONLY"],
  ["writable transaction", { transactionReadOnly: false }, "VES_PROBE_SESSION_NOT_READ_ONLY"]
]) {
  test(`${label} fails before query execution`, async () => {
    const fixture = await workerFixture({ worker });
    await assert.rejects(fixture.supervisor.execute(), { code });
    assert.equal(fixture.worker.calls.includes("execute"), false);
    assert.equal(fixture.results.commits, 0);
  });
}

test("row overflow cancels and rolls back all partial output", async () => {
  const fixture = await workerFixture({ worker: { chunks: [Array.from({ length: 101 }, (_, id) => ({ id }))] } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_ROW_LIMIT" });
  assert.equal(fixture.worker.cancelled, true);
  assert.equal(fixture.results.rollbacks, 1);
  assert.equal(fixture.results.commits, 0);
});

test("byte overflow cancels and rolls back all partial output", async () => {
  const fixture = await workerFixture({ worker: { chunks: [[{ value: "x".repeat(100_001) }]] } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_BYTE_LIMIT" });
  assert.equal(fixture.results.commits, 0);
});

test("secret echoed in a row is detected, cancelled, and never committed", async () => {
  const secret = "sensitive-probe-parameter";
  const fixture = await workerFixture({ parameter: secret, worker: { chunks: [[{ leaked: secret }]] } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SECRET_LEAK" });
  assert.equal(fixture.results.commits, 0);
  assert.equal(JSON.stringify(fixture.results).includes(secret), false);
});

test("worker error is sanitized and partial output rolls back", async () => {
  const fixture = await workerFixture({ worker: { failAfterChunks: 1, errorMessage: "password=top-secret" } });
  await assert.rejects(fixture.supervisor.execute(), {
    code: "VES_PROBE_WORKER_FAILURE",
    message: "Probe worker failed"
  });
  assert.equal(fixture.results.commits, 0);
});

test("foreign database identity evidence fails closed", async () => {
  const fixture = await workerFixture({ worker: { identityDatabaseId: "other" } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_IDENTITY_INVALID" });
});

test("foreign plan digest in session evidence fails closed", async () => {
  const fixture = await workerFixture({ worker: { sessionPlanDigest: `sha256:${"9".repeat(64)}` } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_SESSION_INVALID" });
});

test("external abort cancels worker and rolls back", async () => {
  const fixture = await workerFixture({ worker: { delayMs: 100 } });
  const controller = new AbortController();
  const pending = fixture.supervisor.execute(controller.signal);
  controller.abort();
  await assert.rejects(pending, { code: "VES_PROBE_ABORTED" });
  assert.equal(fixture.worker.cancelled, true);
  assert.equal(fixture.results.commits, 0);
});

test("result envelope contains no parameter, row, connection, or credential material", async () => {
  const fixture = await workerFixture({ parameter: "private-parameter" });
  const serialized = JSON.stringify(await fixture.supervisor.execute());
  for (const prohibited of ["private-parameter", "credentialValue", "connectionString", '"rows"'])
    assert.equal(serialized.includes(prohibited), false);
});
