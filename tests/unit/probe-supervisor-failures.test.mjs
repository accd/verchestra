import assert from "node:assert/strict";
import { test } from "node:test";

import { workerFixture } from "../helpers/probe-worker-fixture.mjs";

test("a result sink failure is reported as a storage failure and the rows roll back", async () => {
  const fixture = await workerFixture();
  fixture.results.failAppend = true;
  await assert.rejects(fixture.supervisor.execute(), {
    code: "VES_PROBE_RESULT_FAILURE",
    message: "Protected Probe result storage failed"
  });
  assert.equal(fixture.results.rollbacks, 1);
  assert.equal(fixture.results.commits, 0);
});

for (const [name, worker, code, message] of [
  [
    "missing principal evidence",
    { omitIdentity: true },
    "VES_PROBE_IDENTITY_INVALID",
    "Probe principal evidence is missing"
  ],
  [
    "principal evidence for another database",
    { identityDatabaseId: "database:other", principalReadOnly: false },
    "VES_PROBE_IDENTITY_INVALID",
    "Probe principal evidence is invalid"
  ],
  [
    "a writable principal",
    { principalReadOnly: false, sessionReadOnly: false },
    "VES_PROBE_IDENTITY_NOT_READ_ONLY",
    "Database principal is not read-only"
  ],
  [
    "session evidence for another plan",
    { sessionPlanDigest: `sha256:${"9".repeat(64)}`, sessionReadOnly: false },
    "VES_PROBE_SESSION_INVALID",
    "Probe session evidence is invalid"
  ],
  [
    "a writable transaction",
    { transactionReadOnly: false },
    "VES_PROBE_SESSION_NOT_READ_ONLY",
    "Database session and transaction must be read-only"
  ]
]) {
  test(`${name} is refused before the worker executes the plan`, async () => {
    const fixture = await workerFixture({ worker });
    await assert.rejects(fixture.supervisor.execute(), { code, message });
    assert.equal(fixture.worker.calls.includes("execute"), false);
    assert.equal(fixture.results.commits, 0);
  });
}

test("a result chunk that echoes the protected parameter is refused and rolled back", async () => {
  const fixture = await workerFixture({
    parameter: "secret-parameter",
    worker: { chunks: [[{ echo: "secret-parameter" }]] }
  });
  await assert.rejects(fixture.supervisor.execute(), {
    code: "VES_PROBE_SECRET_LEAK",
    message: "Probe result contains protected parameter material"
  });
  assert.equal(fixture.results.rollbacks, 1);
});

test("a successful run reports the counted rows and bytes it committed", async () => {
  const fixture = await workerFixture({ worker: { chunks: [[{ id: 1 }], [{ id: 2 }, { id: 3 }]] } });
  const result = await fixture.supervisor.execute();
  assert.equal(result.status, "complete");
  assert.equal(result.rowCount, 3);
  assert.equal(result.byteCount, Buffer.byteLength('[{"id":1}]') + Buffer.byteLength('[{"id":2},{"id":3}]'));
  assert.equal(fixture.results.commits, 1);
});
