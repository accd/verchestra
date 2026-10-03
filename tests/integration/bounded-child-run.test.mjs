// invariant: one routine runs a child of platform-node to a time and an
// output bound (ADR2-5). It starts the child in a process group of its own
// off Windows, keeps what both streams carried up to the limit, stops the
// group once at the timeout or the limit, and reports how the child ended;
// the gate runner and the activation health gate keep only their verdicts.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { runBoundedChild } from "../../packages/platform-node/src/bounded-child-run.ts";
import { isAlive } from "../helpers/process-liveness.mjs";
import { reap, WIN32_HOST } from "../helpers/process-tree-fixture.mjs";

const workDirectory = await mkdtemp(join(tmpdir(), "verchestra-bounded-child-"));
after(() => rm(workDirectory, { recursive: true, force: true }));

// why: the child sees only what it needs to start; the test runner's own
// variables would change what a nested Node prints.
const ENVIRONMENT = Object.freeze(
  Object.fromEntries(
    ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "TEMP", "TMP"]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]])
  )
);

const INCOMPLETE = () => assert.fail("the routine reported a group that outlived its termination");

function bounded(source, overrides = {}) {
  return runBoundedChild({
    executable: process.execPath,
    args: ["-e", source],
    cwd: workDirectory,
    env: ENVIRONMENT,
    timeoutMs: 10_000,
    outputLimitBytes: 1_000_000,
    incomplete: INCOMPLETE,
    ...overrides
  });
}

// why: a Node child that a group kill ends reports the signal on POSIX;
// TerminateProcess on Windows surfaces as exit status 1 with no signal.
const KILLED = WIN32_HOST ? { exitCode: 1, signal: null } : { exitCode: null, signal: "SIGKILL" };

test("a child that exits by itself reports its exit, both streams in arrival order, and every byte", async () => {
  const observed = { stdout: [], stderr: [] };
  const observation = await bounded(
    [
      'process.stdout.write("out-1;");',
      'setTimeout(() => { process.stderr.write("err-1;");',
      '  setTimeout(() => { process.stdout.write("out-2"); process.exitCode = 3; }, 100); }, 100);'
    ].join("\n"),
    { observe: (stream, chunk) => observed[stream].push(chunk) }
  );
  assert.equal(observation.ended, "exited");
  assert.equal(observation.output.toString("utf8"), "out-1;err-1;out-2");
  assert.equal(observation.exitCode, 3);
  assert.equal(observation.signal, null);
  assert.equal(observation.timedOut, false);
  assert.equal(observation.outputLimitExceeded, false);
  assert.equal(observation.stdoutBytes, 11);
  assert.equal(observation.stderrBytes, 6);
  assert.equal(Buffer.concat(observed.stdout).toString("utf8"), "out-1;out-2");
  assert.equal(Buffer.concat(observed.stderr).toString("utf8"), "err-1;");
});

test("output past the limit stops the child's group and keeps only the limit, while the observer sees it all", async () => {
  let observedBytes = 0;
  const observation = await bounded('process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000);', {
    outputLimitBytes: 64,
    observe: (_stream, chunk) => {
      observedBytes += chunk.byteLength;
    }
  });
  assert.equal(observation.ended, "exited");
  assert.equal(observation.outputLimitExceeded, true);
  assert.equal(observation.timedOut, false);
  assert.equal(observation.output.toString("utf8"), "x".repeat(64));
  assert.ok(observation.stdoutBytes > 64, `${observation.stdoutBytes} bytes were counted`);
  assert.equal(observedBytes, observation.stdoutBytes);
  assert.deepEqual({ exitCode: observation.exitCode, signal: observation.signal }, KILLED);
});

test("a child past its timeout is stopped with its group before the run settles", async (t) => {
  let descendant;
  reap(t, () => (descendant === undefined ? [] : [descendant]));
  const observation = await bounded(
    [
      'const { spawn } = require("node:child_process");',
      'const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "process.stdout.write(String(grandchild.pid));",
      "setInterval(() => {}, 1000);"
    ].join("\n"),
    { timeoutMs: 1_000 }
  );
  descendant = Number(observation.output.toString("utf8"));
  assert.ok(Number.isSafeInteger(descendant) && descendant > 0, "the child named its descendant");
  assert.equal(observation.ended, "exited");
  assert.equal(observation.timedOut, true);
  assert.equal(observation.outputLimitExceeded, false);
  assert.deepEqual({ exitCode: observation.exitCode, signal: observation.signal }, KILLED);
  assert.equal(isAlive(descendant), false, "the descendant outlived the run");
});

test("a child that cannot be started is reported as such, not thrown", async () => {
  const observation = await bounded("", { executable: join(workDirectory, "absent", "node") });
  assert.equal(observation.ended, "spawn-failed");
  assert.equal(observation.error.code, "ENOENT");
});

test("a child ended by a signal of its own reports how it ended, and the run did not stop it", async () => {
  const observation = await bounded('process.kill(process.pid, "SIGKILL");');
  assert.equal(observation.ended, "exited");
  assert.deepEqual({ exitCode: observation.exitCode, signal: observation.signal }, KILLED);
  assert.equal(observation.timedOut, false);
  assert.equal(observation.outputLimitExceeded, false);
});
