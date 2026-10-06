// invariant: PPR-08, end to end through the real `vestra` binary with the
// DETERMINISTIC FAKE `claude` and `codex` executables (tests/helpers/
// task-cli-fakes), steered by fixture flags. Before the run's first
// transition, the worktree, and the implementer's allowance, `start` and
// `resume` ask the Workspace's Codex login which of the run's Codex models it
// offers, and one it does not is `not configured` (`codex-model-unavailable`),
// named on the terminal, with the run as it was. The fake offers
// `gpt-5.2-codex` alone, and `codex-model-missing` makes it offer none of the
// run's. Every case runs on macOS, Linux, and Windows.
import assert from "node:assert/strict";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import { cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
import {
  CODEX,
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  logLines,
  startArguments,
  status
} from "../helpers/task-coordinated-fixture.mjs";

after(cleanupTaskFixtures);

// why: the fakes read their flags from the fixture's private log directory.
const flag = (fixture, name) => writeFile(join(fixture.scratch, name), "");
const unflag = (fixture, name) => unlink(join(fixture.scratch, name));

// why: a node on a model the fake's account does not list, while the verifier's
// is listed, so only the node's name can refuse the run.
const NODE_MODEL = "gpt-6-sol";
const GRAPH_WITH_UNOFFERED_NODE = Object.freeze({
  ...EXECUTIONS.graph,
  nodes: EXECUTIONS.graph.nodes.map((node) =>
    node.nodeId === "plan" ? { ...node, driver: { ...CODEX, model: NODE_MODEL } } : node
  )
});

function refusedAsUnavailable(result) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.equal(result.json?.error?.code, "VES_TASK_NOT_CONFIGURED", `${result.stdout}${result.stderr}`);
  assert.deepEqual(result.json.error.safeDetails, { requirement: "codex-model-unavailable" });
}

// invariant: the run is as `plan` and `approve` left it: authorized, no process,
// no worktree beside the repository's own, and neither provider started.
function assertUntouched(fixture, runId) {
  const after = status(fixture, runId);
  assert.equal(after.state, "EXECUTION_AUTHORIZED");
  assert.equal(after.activeProcess, false);
  assert.equal(after.lastOutcome, null);
  assert.deepEqual(logLines(fixture, "fake-claude.log"), [], "the implementer was started");
  assert.deepEqual(logLines(fixture, "fake-codex-turn.log"), [], "a verifier turn was opened");
  assert.equal(
    fixture
      .git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((line) => line.startsWith("worktree ")).length,
    1,
    "a worktree was made"
  );
}

test(
  "a verifier whose model the account does not offer is refused at start, before anything is done",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(EXECUTIONS.agent);
    const plan = await approved(fixture);
    await flag(fixture, "codex-model-missing");
    const start = fixture.launch(startArguments(fixture, plan.runId));
    refusedAsUnavailable(start);
    assert.match(start.stderr, /does not offer: gpt-5\.2-codex/u);
    assertUntouched(fixture, plan.runId);
    await unflag(fixture, "codex-model-missing");
    const again = fixture.launch(startArguments(fixture, plan.runId));
    assert.equal(again.status, 0, `${again.stderr}${again.stdout}`);
  }
);

test(
  "a Codex node whose model the account does not offer is refused at start, naming that model alone",
  TIMEOUT,
  async () => {
    const fixture = await coordinatedFixture(GRAPH_WITH_UNOFFERED_NODE);
    const plan = await approved(fixture);
    const start = fixture.launch(startArguments(fixture, plan.runId));
    refusedAsUnavailable(start);
    assert.match(start.stderr, new RegExp(`does not offer: ${NODE_MODEL}\\.`, "u"));
    assert.doesNotMatch(start.stderr, /gpt-5\.2-codex/u, "an offered model was named");
    assertUntouched(fixture, plan.runId);
  }
);

// invariant: `resume` asks the same question as `start`, so a run suspended at
// its verifier is not resumed onto a model its account no longer offers.
test("a suspended run is refused at resume when its verifier's model is no longer offered", TIMEOUT, async () => {
  const fixture = await coordinatedFixture(EXECUTIONS.agent);
  const plan = await approved(fixture);
  await flag(fixture, "codex-quota");
  const suspended = fixture.launch(startArguments(fixture, plan.runId));
  assert.equal(suspended.json?.data?.state, "VERIFYING", `${suspended.stdout}${suspended.stderr}`);
  await unflag(fixture, "codex-quota");
  await flag(fixture, "codex-model-missing");
  const resume = fixture.launch([
    "task",
    "resume",
    "--run-id",
    plan.runId,
    ...fixture.keychainArgs,
    "--output",
    "json"
  ]);
  refusedAsUnavailable(resume);
  const after = status(fixture, plan.runId);
  assert.deepEqual([after.state, after.lastOutcome], ["VERIFYING", "SUSPENDED"]);
  assert.deepEqual(logLines(fixture, "fake-codex-turn.log"), [], "the verifier opened a turn");
});
