import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ObservingResultSink,
  WIN32_HOST,
  eventuallyDead,
  isAlive,
  probeHostRefusedOnWin32,
  spawnedProbe
} from "../helpers/spawned-probe-worker-fixture.mjs";

const BOUNDS = { timeoutMs: 400, rowLimit: 100, byteLimit: 100_000, concurrencyLimit: 1 };
// why: the bound is the supervisor's time limit plus the terminator's own
// verified wait; anything slower means the hang was not cut at the bound.
const CEILING_MS = BOUNDS.timeoutMs + 1_500;

function reap(t, pids) {
  t.after(() => {
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  });
}

for (const [label, mode] of [
  ["during execution", "hang"],
  ["before answering its handshake", "hang-handshake"]
]) {
  test(`a worker that hangs ${label} is killed at the time bound`, async (t) => {
    if (WIN32_HOST) return probeHostRefusedOnWin32(t);
    const fixture = await spawnedProbe({ mode, request: { bounds: BOUNDS } });
    const started = Date.now();
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= BOUNDS.timeoutMs, `returned at ${elapsed}ms, before the bound`);
    assert.ok(elapsed < CEILING_MS, `returned at ${elapsed}ms, well past the bound`);
    assert.equal(fixture.framed.terminated, true);
    assert.equal(await eventuallyDead(fixture.transport.pid), true);
    assert.equal(fixture.results.commits, 0);
    assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
  });
}

test("a worker that forks grandchildren has its whole tree killed, including a setsid escapee", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  const fixture = await spawnedProbe({ mode: "fork", results, request: { bounds: BOUNDS } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  const [descendants] = results.observed;
  assert.ok(Number.isSafeInteger(descendants?.sameGroup), "the worker reported its same-group grandchild");
  assert.ok(Number.isSafeInteger(descendants?.escaped), "the worker reported its setsid grandchild");
  reap(t, [descendants.sameGroup, descendants.escaped]);
  assert.equal(await eventuallyDead(fixture.transport.pid), true, "the worker is dead");
  assert.equal(await eventuallyDead(descendants.sameGroup), true, "the same-group grandchild is dead");
  assert.equal(await eventuallyDead(descendants.escaped), true, "the setsid grandchild is dead");
  assert.equal(results.rollbacks, 1);
  assert.equal(results.commits, 0);
});

test("a worker that exits mid-stream produces no partial promoted evidence", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({ mode: "exit-mid-stream" });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_WORKER_EXITED" });
  assert.equal(fixture.results.rollbacks, 1);
  assert.equal(fixture.results.commits, 0);
  assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
});

test("an external abort kills the worker tree and rolls back", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const fixture = await spawnedProbe({ mode: "hang" });
  const controller = new AbortController();
  const pending = fixture.supervisor.execute(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(isAlive(fixture.transport.pid), true, "the worker was running when the abort arrived");
  controller.abort();
  await assert.rejects(pending, { code: "VES_PROBE_ABORTED" });
  assert.equal(fixture.framed.cancelled, true);
  assert.equal(await eventuallyDead(fixture.transport.pid), true);
  assert.equal(fixture.results.commits, 0);
});
