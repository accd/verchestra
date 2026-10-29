// invariant: a probe's protected request is JSON (.specs/features/probe-run/
// plan.md, AD-086), so a worker that echoes it into a string value returns it
// escaped. The supervisor refuses that echo as it refuses the bytes as they
// are, and still completes a result that carries neither.
import assert from "node:assert/strict";
import { test } from "node:test";

import { workerFixture } from "../helpers/probe-worker-fixture.mjs";

const REQUEST = JSON.stringify({ schemaVersion: 1, sql: "SELECT id FROM main.orders WHERE id = ?", parameters: [7] });

test("the supervisor refuses a result that echoes a JSON protected request", async () => {
  for (const [label, row] of [
    ["the request as a string value", { echo: REQUEST }],
    ["the request as it is, nested", JSON.parse(`{"echo":${REQUEST}}`)],
    ["a plain secret", { echo: "sensitive-probe-parameter" }]
  ]) {
    const parameter = label === "a plain secret" ? "sensitive-probe-parameter" : REQUEST;
    const { supervisor, results } = await workerFixture({ parameter, worker: { chunks: [[row]] } });
    await assert.rejects(supervisor.execute(), { code: "VES_PROBE_SECRET_LEAK" }, label);
    assert.equal(results.commits, 0, `${label} committed a result`);
  }
  const { supervisor } = await workerFixture({ parameter: REQUEST, worker: { chunks: [[{ id: 7, status: "paid" }]] } });
  const result = await supervisor.execute();
  assert.equal(result.status, "complete");
  assert.equal(result.rowCount, 1);
});
