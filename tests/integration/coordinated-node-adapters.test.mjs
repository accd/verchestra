// invariant: the coordinated run's own node adapters, as the composition
// builds them over the production Claude Code and Codex drivers, end a node
// by the coordination rules: a provider that gave no structured result, or
// one the driver could not read or bound, fails its node with
// VES_COORDINATION_RESULT_INVALID or VES_COORDINATION_RESULT_TOO_LARGE
// (SSI-46, SSI-47), and nothing of it is persisted; and a node reads only
// inside its own read scope (SSI-42). The providers are the labeled
// deterministic fakes of the driver spikes.
import assert from "node:assert/strict";
import { chmod, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { verifierRefusedOnWin32 } from "../helpers/codex-verifier-fixture.mjs";
import { WIN32_HOST, compositionFixture, withFakeCodexModel } from "../helpers/coordinated-composition-fixture.mjs";
import { coordinatedRequest, rejectsWith } from "../helpers/coordinated-driver-fixture.mjs";
import { windowsMediationPath } from "../helpers/mediation-platform.mjs";

const visits = (records) => records.ledger.visits.map((entry) => `${entry.nodeId}#${entry.visit}:${entry.state}`);
const finished = (executor) =>
  executor.state.checkpoints.filter((entry) => entry.stage.endsWith(":driver-finished")).map((entry) => entry.data);

function claudeAgent(instructions, limits) {
  return coordinatedRequest("agent", (raw) => {
    raw.execution.nodes[0].instructions = instructions;
    if (limits !== undefined) raw.execution.limits = limits;
  });
}

// why: a plan has one writer at least, so a Codex node runs as the reader
// that starts a graph; its Claude Code writer answers the fake's structured
// result.
function codexGraph(limits) {
  return withFakeCodexModel(
    coordinatedRequest("graph", (raw) => {
      raw.execution.nodes[1].instructions = "scenario:structured";
      if (limits !== undefined) raw.execution.limits = limits;
    })
  );
}

async function refusedNode(fixture, nodeId, code, driverCode) {
  await assert.rejects(fixture.run(), rejectsWith(code));
  assert.deepEqual(visits(fixture.records), [`${nodeId}#1:failed`]);
  assert.equal(fixture.records.ledger.visits[0].failureCode, code);
  assert.equal(fixture.records.results.size, 0, "a refused result is never persisted");
  assert.equal(fixture.records.ledger.roundState, "failed");
  assert.deepEqual(
    finished(fixture.executor).map((data) => [data.outcome, data.errorCodes]),
    driverCode === undefined ? [] : [["failed", [driverCode]]],
    "a session's end is recorded with the driver's own code"
  );
}

test("a Claude Code node that answers no structured result, or runs out of retries, fails as RESULT_INVALID", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  for (const scenario of ["structured-missing", "structured-retries"]) {
    const fixture = await compositionFixture(t, claudeAgent(`scenario:${scenario}`));
    await refusedNode(fixture, "build", "VES_COORDINATION_RESULT_INVALID", "VES_CLAUDE_STRUCTURED_OUTPUT_MISSING");
  }
});

test("a Claude Code node whose structured result is over the node bound fails as RESULT_TOO_LARGE", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  // why: the fake's oversized answer is 8,192 characters of summary, past a
  // node bound of 4,096 bytes and inside the schema's own bound.
  const fixture = await compositionFixture(t, claudeAgent("scenario:structured-large", { nodeResultBytes: 4096 }));
  await refusedNode(fixture, "build", "VES_COORDINATION_RESULT_TOO_LARGE", "VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT");
});

test("a Codex node with no answer or an unreadable one fails as RESULT_INVALID, and one over the bound as RESULT_TOO_LARGE", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  for (const [mode, code, driverCode] of [
    ["structured-missing", "VES_COORDINATION_RESULT_INVALID", "VES_CODEX_STRUCTURED_OUTPUT_MISSING"],
    ["structured-invalid", "VES_COORDINATION_RESULT_INVALID", "VES_CODEX_STRUCTURED_OUTPUT_INVALID"],
    ["structured-large", "VES_COORDINATION_RESULT_TOO_LARGE", "VES_CODEX_STRUCTURED_OUTPUT_LIMIT"]
  ]) {
    const fixture = await compositionFixture(t, codexGraph({ nodeResultBytes: 4096 }), { codex: { mode } });
    await refusedNode(fixture, "plan", code, driverCode);
  }
});

test("nodes that answer within their bound complete, each result persisted by digest", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const fixture = await compositionFixture(t, codexGraph());
  assert.deepEqual(await fixture.run(), { status: "completed", outputRefs: [] });
  assert.deepEqual(visits(fixture.records), ["plan#1:completed", "build#1:completed", "review#1:completed"]);
  // why: both fakes give the same answer, so its one canonical text is one
  // persisted result that the three visits name.
  assert.deepEqual([...fixture.records.results.keys()], [fixture.records.ledger.visits[0].resultDigest]);
  assert.equal(new Set(fixture.records.ledger.visits.map((entry) => entry.resultDigest)).size, 1);
  assert.deepEqual(
    finished(fixture.executor).map((data) => [data.outcome, data.errorCodes]),
    [
      ["completed", []],
      ["completed", []],
      ["completed", []]
    ]
  );
  // invariant: SSI-17. Each node's usage names its own provider and no
  // other.
  assert.deepEqual(
    fixture.executor.state.usage.map((event) => event.provider),
    ["openai", "anthropic", "openai"]
  );
});

// invariant: SSI-42 and TM-004. Where the task's change scope is wider than a
// node's read scope, the node still reads only inside its own: a Claude Code
// node's bridge refuses the read, and a Codex node's working directory is a
// read-only view of that scope alone, removed when the node ends.
const SCOPED_FILES = Object.freeze({
  "src/a.txt": "alpha\n",
  "lib/b.txt": "beta\n",
  "lib/nested/c.txt": "gamma\n",
  "lib/secret/key.txt": "protected\n",
  "lib/image.bin": "\u0000binary"
});

function changeScopeWiderThanNodes(raw) {
  raw.task.changeScope = ["src", "lib"];
  raw.task.protectedPaths = [".git", ".verchestra/policy", "lib/secret"];
}

// why: the fake's read-write scenario reads src/a.txt, writes it, and gives
// no structured result, so each run below ends as RESULT_INVALID after its
// tool calls are observed.
function claudeReader(readScope, writeScope, scenario = "read-write") {
  return coordinatedRequest("agent", (raw) => {
    changeScopeWiderThanNodes(raw);
    Object.assign(raw.execution.nodes[0], { readScope, writeScope, instructions: `scenario:${scenario}` });
  });
}

test("a Claude Code node is refused a read inside the change scope but outside its own read scope", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const narrow = await compositionFixture(t, claudeReader(["lib"], ["lib/nested"]), { files: SCOPED_FILES });
  await assert.rejects(narrow.run(), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
  const [read, write] = (await narrow.claudeObservation()).toolResults;
  assert.deepEqual(read, { name: "read_file", isError: true, text: "denied: VES_BRIDGE_SCOPE_DENIED" });
  assert.deepEqual(write, { name: "write_file", isError: true, text: "denied: VES_COORDINATION_SCOPE_DENIED" });
  assert.deepEqual(narrow.executor.state.tools, [], "no effect reached the executor");
  const wide = await compositionFixture(t, claudeReader(["src", "lib"], ["src"]), { files: SCOPED_FILES });
  await assert.rejects(wide.run(), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
  const [allowed] = (await wide.claudeObservation()).toolResults;
  assert.equal(allowed.text, "alpha\n", "the same read inside the node's read scope is answered");
  assert.notEqual(allowed.isError, true);
});

function codexReaders(planScope = ["lib"]) {
  return withFakeCodexModel(
    coordinatedRequest("graph", (raw) => {
      changeScopeWiderThanNodes(raw);
      const [plan, build, review] = raw.execution.nodes;
      plan.readScope = planScope;
      Object.assign(build, { readScope: ["src", "lib"], writeScope: ["src"], instructions: "scenario:structured" });
      review.readScope = ["src"];
    })
  );
}

const viewOf = (views, nodeId) => views.find((view) => view.cwd.includes(`-${nodeId}-1`));

test("a Codex node works in a read-only view of its read scope alone, never the worktree, removed when it ends", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const fixture = await compositionFixture(t, codexReaders(), { files: SCOPED_FILES, codex: { observeView: true } });
  await mkdir(join(fixture.root, "outside"));
  await writeFile(join(fixture.root, "outside", "victim.txt"), "outside the worktree\n");
  await symlink(join(fixture.root, "outside"), join(fixture.worktree, "lib", "link"), "junction");
  await symlink(join(fixture.worktree, "src", "a.txt"), join(fixture.worktree, "lib", "a-link.txt"));
  assert.deepEqual(await fixture.run(), { status: "completed", outputRefs: [] });
  const views = await fixture.codexViews();
  assert.equal(views.length, 2, "one view for each Codex node");
  assert.deepEqual(viewOf(views, "plan").entries, [
    { path: ".", kind: "directory", writable: false },
    { path: "lib", kind: "directory", writable: false },
    { path: "lib/b.txt", kind: "file", writable: false, text: "beta\n" },
    { path: "lib/nested", kind: "directory", writable: false },
    { path: "lib/nested/c.txt", kind: "file", writable: false, text: "gamma\n" }
  ]);
  assert.deepEqual(
    viewOf(views, "review").entries.map((entry) => entry.path),
    [".", "src", "src/a.txt"]
  );
  for (const view of views) {
    assert.notEqual(view.cwd, fixture.worktree);
    assert.ok(view.cwd.startsWith(join(fixture.sessionsRoot, "codex-node-")), view.cwd);
  }
  assert.deepEqual(await readdir(fixture.sessionsRoot), [], "every node's view and home were removed");
});

// why: a node killed mid-session (a crash) leaves its read-only view behind,
// and a resume runs the same visit at the same path.
test("a Codex node runs again over the read-only view a killed session left behind", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const fixture = await compositionFixture(t, codexReaders(), { files: SCOPED_FILES, codex: { observeView: true } });
  const stale = join(fixture.sessionsRoot, "codex-node-run_018f0b6d-7b1a-7abc-8def-612345678901-plan-1", "scope");
  await mkdir(join(stale, "lib"), { recursive: true });
  await writeFile(join(stale, "lib", "stale.txt"), "left by a killed session\n", { mode: 0o400 });
  for (const directory of [join(stale, "lib"), stale]) await chmod(directory, 0o500);
  assert.deepEqual(await fixture.run(), { status: "completed", outputRefs: [] });
  assert.equal(
    viewOf(await fixture.codexViews(), "plan").entries.some((entry) => entry.path === "lib/stale.txt"),
    false,
    "the new view holds nothing of the old one"
  );
  assert.deepEqual(await readdir(fixture.sessionsRoot), []);
});

test("a Codex node whose read scope is beyond the view's bound fails before its session, and leaves nothing", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  const files = { ...SCOPED_FILES, "lib/large.txt": "x".repeat(1_048_577) };
  const fixture = await compositionFixture(t, codexReaders(), { files, codex: { observeView: true } });
  await refusedNode(fixture, "plan", "VES_BRIDGE_VIEW_LIMIT", undefined);
  assert.deepEqual(await fixture.codexViews(), [], "no Codex session started");
  assert.deepEqual(await readdir(fixture.sessionsRoot), []);
});

// invariant: SSI-49 at the composition. A node result that names what the
// run withholds (here a credential its Codex sessions are given to redact)
// is refused before it is persisted or handed to a later node.
test("the composition refuses a node result that holds a credential of the run", async (t) => {
  if (WIN32_HOST) return verifierRefusedOnWin32(t);
  // why: the fakes answer a fixed text; a Codex credential that is part of it
  // stands for a model that wrote its credential into its answer.
  const fixture = await compositionFixture(t, codexGraph(), { codex: { credential: "structured by the fake" } });
  await assert.rejects(fixture.run(), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
  assert.deepEqual(visits(fixture.records), ["plan#1:failed"]);
  assert.equal(fixture.records.results.size, 0);
  assert.deepEqual(
    finished(fixture.executor).map((data) => data.outcome),
    ["completed"],
    "the session answered; its answer was refused"
  );
});

// invariant: SSI-58. A provider's warning is recorded by its code in the
// node's `driver-finished` checkpoint, for a Claude Code node (a usage limit
// near, `allowed_warning`) and a Codex node (a built-in effect denied), and
// the session went on after it.
test("each node adapter records a provider's warning code in the node's end", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const claude = await compositionFixture(t, claudeReader(["src"], ["src"], "rate-warning"), { files: SCOPED_FILES });
  await assert.rejects(claude.run(), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
  assert.deepEqual(finished(claude.executor), [
    {
      outcome: "failed",
      toolRequests: 1,
      writes: 1,
      deletes: 0,
      denied: 0,
      errorCodes: ["VES_CLAUDE_STRUCTURED_OUTPUT_MISSING"],
      warningCodes: ["VES_CLAUDE_QUOTA_WARNING"]
    }
  ]);
  assert.equal(claude.executor.state.tools.length, 1, "the write after the warning reached the executor");
  const codex = await compositionFixture(t, codexGraph(), { codex: { mode: "command-approval" } });
  await assert.rejects(codex.run(), rejectsWith("VES_COORDINATION_RESULT_INVALID"));
  assert.deepEqual(finished(codex.executor), [
    {
      outcome: "failed",
      toolRequests: 0,
      errorCodes: ["VES_CODEX_STRUCTURED_OUTPUT_MISSING"],
      warningCodes: ["VES_CODEX_BUILTIN_TOOL_DENIED"]
    }
  ]);
});
