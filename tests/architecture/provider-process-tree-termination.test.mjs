// invariant: stopping a Claude Code or Codex provider stops its whole process
// tree (ADP-4). Three things must hold together for that, and each is a line a
// later change could drop without a behaviour test on the pull request's own
// platform noticing: the provider child run that both drivers use starts the
// provider in a process group of its own, the task composition hands every
// provider driver the tree terminator, and nothing in the task composition
// signals one process alone.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(join(repositoryRoot, path), "utf8");
// why: a comment may name a signal to explain a decision; only code counts.
const code = (source) =>
  source
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:\/\/|\*|\/\*)/u.test(line))
    .join("\n");

const TASK_ROOT = "apps/vestra-cli/src/task";
const taskSources = readdirSync(join(repositoryRoot, TASK_ROOT))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, source: code(read(`${TASK_ROOT}/${name}`)) }));
const PROVIDER_DRIVER = /\bnew\s+(?:ClaudeCodeDriver|CodexDriver)\s*\(/gu;
const CHILD_RUN = "packages/drivers/src/provider-child-run.ts";

// why: the spawn, the stop and every other end of the provider live in the
// provider child run (ADR2-3); a driver hands it the terminator the
// composition injected and starts no process of its own.
for (const driver of ["claude-code-driver.ts", "codex-driver.ts"]) {
  test(`${driver} runs its provider through the provider child run and hands it the injected terminator`, () => {
    const source = code(read(`packages/drivers/src/${driver}`));
    assert.match(source, /\brunProviderChild\(\{/u);
    assert.doesNotMatch(source, /\bspawn\b/u, "the driver starts a process itself");
    assert.match(source, /processTreeTerminator\(dependencies\.terminateTree\)/u);
    assert.match(source, /\bterminateTree: this\.#terminateTree\b/u);
    assert.doesNotMatch(source, /process\.kill\(/u, "the driver signals a process itself");
  });
}

test("the provider child run starts its provider in a process group of its own and stops it through one terminator", () => {
  const source = code(read(CHILD_RUN));
  assert.match(source, /\bspawn\([^;]*?\bdetached: OWN_PROCESS_GROUP\b/su);
  assert.match(source, /\bsingleTermination\(this\.#run\.terminateTree, pid\)/u);
  assert.doesNotMatch(source, /process\.kill\(/u, "the child run signals a process itself");
});

test("a provider leads its own process group everywhere but on Windows, and the fallback signals that group", () => {
  const source = code(read("packages/drivers/src/driver-process-tree.ts"));
  assert.match(source, /export const OWN_PROCESS_GROUP = process\.platform !== "win32";/u);
  assert.match(source, /process\.kill\(OWN_PROCESS_GROUP \? -pid : pid\)/u);
  assert.doesNotMatch(source, /@verchestra\/platform-node/u, "a driver may not import a sibling adapter");
});

// invariant: a provider session of the task composition comes from the
// command's provider processes, which give the driver the tree terminator and
// learn the provider's process from `onSpawn`, so that an interrupt can stop it.
test("the task composition hands every provider driver it builds the tree terminator and its spawn observer", () => {
  const builders = taskSources.filter(({ source }) => source.match(PROVIDER_DRIVER) !== null);
  assert.deepEqual(
    builders.map(({ name }) => name),
    ["task-codex.ts", "task-implementer.ts"]
  );
  for (const { name, source } of builders) {
    const built = source.match(PROVIDER_DRIVER).length;
    assert.equal(
      source.match(/\bterminateTree: (?:session|provider)\.terminateTree\b/gu)?.length,
      built,
      `${name} builds a provider driver without the tree terminator`
    );
    assert.equal(
      source.match(/\bonSpawn: (?:session|provider)\.onSpawn\b/gu)?.length,
      built,
      `${name} builds a provider driver the command cannot stop on an interrupt`
    );
    assert.match(source, /\b(?:session|provider) = [A-Za-z.]*providers\.session\("(?:Claude Code|Codex)"\)/u);
    assert.match(source, /await (?:session|provider)\.end\(\)/u, `${name} never ends its provider session`);
  }
});

test("the tree terminator is platform-node's, and no task source signals a provider itself", () => {
  const owner = code(read(`${TASK_ROOT}/task-process-tree.ts`));
  assert.match(owner, /import \{ terminateProcessTree \} from "@verchestra\/platform-node";/u);
  assert.match(owner, /options\.terminateTree \?\? terminateProcessTree/u);
  // why: signal 0 only asks whether a process exists, which the Run record
  // does for the process that drives a run. The one other signal a task
  // source sends is to the command itself, to end as the signal it received
  // would have ended it.
  const signals = /process\.kill\((?![^)]*,\s*0\))(?!process\.pid, signal\))/u;
  assert.deepEqual(
    taskSources.filter(({ source }) => signals.test(source)).map(({ name }) => name),
    []
  );
  assert.equal(owner.match(/process\.kill\(/gu)?.length, 1, "the provider processes send one signal: to the command");
});

// invariant: a hang-up and a termination request are the provider processes'
// to answer, and only while a provider runs; SIGINT stays the run's cancel.
test("the interrupt handlers are the provider processes', and SIGINT is not among them", () => {
  const owner = code(read(`${TASK_ROOT}/task-process-tree.ts`));
  assert.match(owner, /INTERRUPT_SIGNALS: readonly InterruptSignal\[\] = \["SIGHUP", "SIGTERM"\]/u);
  assert.doesNotMatch(owner, /SIGINT/u);
  const run = code(read(`${TASK_ROOT}/task-run.ts`));
  assert.match(run, /process\.once\("SIGINT", interrupt\)/u);
  assert.match(run, /if \(!providers\.running\(\)\) interrupt\(\);/u);
  assert.deepEqual(
    taskSources.filter(({ source }) => /"SIGHUP"/u.test(source)).map(({ name }) => name),
    ["task-process-tree.ts"]
  );
});

// invariant: a provider child is ended through the tree termination on every
// path, not only when a session is stopped. A driver that signals its child
// itself reaches that one process and leaves its descendants.
for (const driver of ["claude-code-driver.ts", "codex-driver.ts"]) {
  test(`${driver} never signals its provider process itself`, () => {
    const source = code(read(`packages/drivers/src/${driver}`));
    assert.doesNotMatch(source, /\.kill\(/u, "the driver signals one process instead of terminating its tree");
    assert.doesNotMatch(
      source,
      /\b(?:singleTermination|unawaitedTermination)\b/u,
      "the driver ends its provider outside the provider child run"
    );
  });
}

test("the provider child run ends its provider only through the termination of its tree", () => {
  const source = code(read(CHILD_RUN));
  assert.doesNotMatch(source, /\.kill\(/u, "the child run signals one process instead of terminating its tree");
  assert.match(source, /\bunawaitedTermination\(/u);
});
