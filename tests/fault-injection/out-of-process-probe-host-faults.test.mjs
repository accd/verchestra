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
// why: TST-005 (#598). The cut is timed from when the host starts ending the
// worker, not from when the tree is dead, and held to the bound by a ratio:
// the supervisor's own timer starts it, so it begins within one more bound. How
// long a process tree takes to die varies by runner; the test timeout fails a
// kill that never completes.
const CUT_WITHIN_BOUNDS = 2;
const OPTIONS = { timeout: 30_000 };
// why: these workers report descendants they start first, which takes two
// Node startups. On a loaded macOS x64 runner that outlasted 400 ms (fleet run
// 40704061361), so the bound fired before the report and the case had nothing
// to check. The bound is not what these cases measure.
const REPORTING_BOUNDS = { ...BOUNDS, timeoutMs: 3_000 };

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

// why: registered before anything can fail, so the processes a worker reported
// are killed even when an assertion stops the case early; a survivor holding
// the worker's output would otherwise keep this test process alive.
function reapObserved(t, results) {
  t.after(() => {
    const pids = results.observed.flatMap((row) => Object.values(row)).filter((pid) => Number.isSafeInteger(pid));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  });
}

// why: "hang-ignore-eof" survives the end of its input, so only the host's own
// process group reaches it; a worker started outside a group of its own
// (`detached: false`) outlives this case (#570).
for (const [label, mode] of [
  ["during execution", "hang"],
  ["during execution while ignoring the end of its input", "hang-ignore-eof"],
  ["before answering its handshake", "hang-handshake"]
]) {
  test(`a worker that hangs ${label} is killed at the time bound`, OPTIONS, async (t) => {
    if (WIN32_HOST) return probeHostRefusedOnWin32(t);
    const fixture = await spawnedProbe({ mode, request: { bounds: BOUNDS } });
    const started = Date.now();
    let cutAt;
    const terminate = fixture.transport.terminate.bind(fixture.transport);
    fixture.transport.terminate = () => {
      cutAt ??= Date.now() - started;
      return terminate();
    };
    await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
    assert.ok(cutAt >= BOUNDS.timeoutMs, `the cut began at ${cutAt}ms, before the bound`);
    assert.ok(
      cutAt < CUT_WITHIN_BOUNDS * BOUNDS.timeoutMs,
      `the cut began at ${cutAt}ms, past ${CUT_WITHIN_BOUNDS} times the ${BOUNDS.timeoutMs}ms bound`
    );
    assert.equal(fixture.framed.terminated, true);
    assert.equal(await eventuallyDead(fixture.transport.pid), true);
    assert.equal(fixture.results.commits, 0);
    assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
  });
}

test("a worker that forks grandchildren has its whole tree killed, including a setsid escapee", async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  const fixture = await spawnedProbe({ mode: "fork", results, request: { bounds: REPORTING_BOUNDS } });
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

// invariant: #569, PHC-05. The worker is still running when the host ends it, so
// a child that left its process group keeps its parent until the kill.
test("a setsid child of a worker that completes its stream is ended with the tree", OPTIONS, async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  reapObserved(t, results);
  const fixture = await spawnedProbe({ mode: "setsid-child", results });
  const envelope = await fixture.supervisor.execute();
  const [{ escaped }] = results.observed;
  assert.equal(envelope.status, "complete");
  assert.equal(await eventuallyDead(escaped), true, "the setsid child is dead");
  assert.equal(await eventuallyDead(fixture.transport.pid), true);
});

test("a grandchild linked through a child in its own group is ended at the time bound", OPTIONS, async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  reapObserved(t, results);
  const fixture = await spawnedProbe({ mode: "setsid-tree", results, request: { bounds: REPORTING_BOUNDS } });
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_TIMEOUT" });
  const [tree] = results.observed;
  assert.ok(Number.isSafeInteger(tree?.grandchild), "the worker reported its tree before the bound");
  const { child, grandchild } = tree;
  assert.equal(await eventuallyDead(child), true, "the child in its own group is dead");
  assert.equal(await eventuallyDead(grandchild), true, "its grandchild is dead");
  assert.equal(results.rollbacks, 1);
});

// invariant: #569, PHC-06. A worker that exited first orphaned its children, so
// its stream does not complete even after its final frame. The host is held
// until the worker has exited, which a worker can always arrange.
test("a worker that exits after its final frame fails the probe and commits nothing", OPTIONS, async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  reapObserved(t, results);
  const fixture = await spawnedProbe({ mode: "setsid-child-exit", results });
  const terminate = fixture.transport.terminate.bind(fixture.transport);
  fixture.transport.terminate = async () => {
    const exited = () =>
      fixture.transport.diagnostics().exitCode !== null || fixture.transport.diagnostics().signal !== null;
    while (!exited()) await new Promise((resolve) => setTimeout(resolve, 10));
    return terminate();
  };
  await assert.rejects(fixture.supervisor.execute(), { code: "VES_PROBE_WORKER_EXITED" });
  assert.equal(results.rollbacks, 1);
  assert.equal(results.commits, 0);
  assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
});

// invariant: #569, PHC-07. The grandchild was orphaned before the host stopped
// anything, so no table links it, but it still holds the worker's stderr.
test("a descendant that outlives the kill while holding the worker's output fails the probe", OPTIONS, async (t) => {
  if (WIN32_HOST) return probeHostRefusedOnWin32(t);
  const results = new ObservingResultSink();
  reapObserved(t, results);
  const fixture = await spawnedProbe({
    mode: "double-fork-holder",
    results,
    request: { bounds: REPORTING_BOUNDS },
    limits: { exitWaitMs: 300 }
  });
  await assert.rejects(fixture.supervisor.execute(), (error) => {
    assert.equal(error.code, "VES_PROBE_HOST_TERMINATION_INCOMPLETE", "it outranks the timeout");
    assert.equal(error.revokeGrant, true);
    return true;
  });
  const [holder] = results.observed;
  assert.ok(Number.isSafeInteger(holder?.escaped), "the worker reported its orphaned grandchild");
  assert.equal(results.rollbacks, 1);
  assert.equal(results.commits, 0);
  assert.equal(fixture.framed.parameterFrameZeroized, true, "a failed termination still zeroizes");
  assert.equal(fixture.transport.diagnostics().workDirectoryRemoved, true);
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
