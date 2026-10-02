import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { WIN32_HOST, verifierRefusedOnWin32 } from "../helpers/codex-verifier-fixture.mjs";
import { eventually, eventuallyDead, isAlive } from "../helpers/process-liveness.mjs";
import { assertTreeRunning } from "../helpers/process-tree-fixture.mjs";

// invariant: a hang-up or a termination request while a provider runs (ADP-4,
// C4-4). A provider leads a process group of its own, so the terminal's
// signals no longer reach it; the command stops every provider tree it started
// and then ends as the signal would have ended it, and nothing is recorded
// after the signal. The command here is a real child process: the labeled
// stand-in tests/helpers/provider-interrupt-child.mjs, which composes the
// production provider processes, the production drivers and the labeled fake
// providers. The journeys through the `vestra` binary are in
// tests/e2e/task-cli-e2e.test.mjs.
//
// On Windows the governed task path is refused before a provider is reachable,
// and a signal there cannot be handled this way, so each case asserts that
// refusal instead. Every process started here is the stand-in, the fake, or
// one of the fake's two idle descendants, and each is killed by its id.

const CHILD = fileURLToPath(new URL("../helpers/provider-interrupt-child.mjs", import.meta.url));
const started = [];
after(() => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
    }
  }
});

function command(kind, mode) {
  const child = spawn(process.execPath, [CHILD, kind, mode], { stdio: ["ignore", "pipe", "pipe"] });
  started.push(child.pid);
  const reports = [];
  let pending = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    const lines = `${pending}${chunk}`.split("\n");
    pending = lines.pop();
    reports.push(...lines.filter(Boolean).map((line) => JSON.parse(line)));
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const ended = new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
  // invariant: resolves with the tree the fake named, or with nothing when the
  // command ended first, so a broken stand-in fails the case, not hangs it.
  const tree = async () => {
    const report = await Promise.race([
      eventually(() => reports.find((entry) => entry.tree !== undefined), 30_000),
      ended.then(() => undefined)
    ]);
    started.push(...Object.values(report?.tree ?? {}));
    return report;
  };
  // why: the product writes nothing to stderr when a tree was stopped; the
  // runtime's own warnings are not the product's.
  const reported = () => stderr.split("\n").filter((line) => line.startsWith("vestra:"));
  return { child, reports, ended, tree, reported };
}

for (const kind of ["claude", "codex"]) {
  for (const signal of ["SIGHUP", "SIGTERM"]) {
    test(
      `${signal} while ${kind} runs stops its whole tree and ends the command by that signal, with nothing recorded after it`,
      { timeout: 60_000 },
      async (t) => {
        if (WIN32_HOST) return verifierRefusedOnWin32(t);
        const run = command(kind, "tree");
        const report = await run.tree();
        assert.ok(report, "the command ended before its provider named its processes");
        assertTreeRunning(report.tree);
        assert.deepEqual(run.reports[0], { before: [0, 0, 0] });
        assert.deepEqual(
          report.during,
          [1, 1, 0],
          "the two interrupts are handled while the provider runs; SIGINT is not"
        );
        run.child.kill(signal);
        assert.deepEqual(await run.ended, { code: null, signal });
        for (const [name, pid] of Object.entries(report.tree))
          assert.equal(await eventuallyDead(pid), true, `${name} outlived the command`);
        assert.deepEqual(
          run.reports.filter((entry) => entry.effect !== undefined || entry.continued !== undefined),
          [],
          "the command recorded something after the signal"
        );
        assert.deepEqual(run.reported(), [], "a tree that was stopped is not reported as running");
      }
    );
  }
}

// invariant: a tree that will not die cannot keep the command alive. The tree
// routine of this stand-in never returns, and the command still ends by the
// signal once the backstop has passed.
test(
  "a tree routine that never returns does not keep the interrupted command alive",
  { timeout: 60_000 },
  async (t) => {
    if (WIN32_HOST) return verifierRefusedOnWin32(t);
    const run = command("claude", "stuck");
    const report = await run.tree();
    assert.ok(report, "the command ended before its provider named its processes");
    const interruptedAt = Date.now();
    run.child.kill("SIGTERM");
    assert.deepEqual(await run.ended, { code: null, signal: "SIGTERM" });
    const waited = Date.now() - interruptedAt;
    assert.ok(waited >= 1_500, `the command ended after ${waited}ms, before the tree routine could have answered`);
    assert.ok(waited < 15_000, `the command ended only after ${waited}ms`);
    assert.equal(isAlive(report.tree.provider), true, "the provider was stopped although the tree routine never ran");
    assert.deepEqual(
      run.reports.filter((entry) => entry.effect !== undefined || entry.continued !== undefined),
      []
    );
  }
);

test("a session that ends by itself is not held back, and its interrupt handlers are gone afterwards", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  for (const kind of ["claude", "codex"]) {
    const run = command(kind, "complete");
    assert.deepEqual(await run.ended, { code: 0, signal: null }, kind);
    assert.deepEqual(
      run.reports,
      [{ before: [0, 0, 0] }, { effect: true }, { continued: true, after: [0, 0, 0] }],
      kind
    );
    assert.deepEqual(run.reported(), []);
  }
});
