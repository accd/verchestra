// invariant: coordinated runs (Task Request v2) end to end through the real
// `vestra` binary: plan, approve, start, status, cancel, and review drive an
// agent, a graph, and a swarm of the DETERMINISTIC FAKE `claude` and `codex`
// executables (tests/helpers/task-cli-fakes) on subscriptions, inside one
// governed executor run, to the same gates, verifier, and human review as a
// single-session run. Graph and swarm runs go through the pinned Strands SDK;
// no provider is contacted and no product code carries a test hook.
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import { DARWIN, cleanupTaskFixtures } from "../helpers/task-cli-fixture.mjs";
import {
  EXECUTIONS,
  TIMEOUT,
  approved,
  coordinatedFixture,
  ledger,
  logLines,
  ok,
  reviewed,
  running,
  startArguments,
  status,
  visits,
  waitFor
} from "../helpers/task-coordinated-fixture.mjs";

after(cleanupTaskFixtures);

test("an agent run is planned, approved, run on the native engine, verified, and accepted", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await coordinatedFixture(EXECUTIONS.agent);
  const plan = await approved(fixture);
  const run = ok(fixture.launch(startArguments(fixture, plan.runId)), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  assert.deepEqual(visits(fixture, plan.runId), ["build#1:completed"]);
  const [visit] = ledger(fixture, plan.runId).visits;
  assert.match(visit.changeDigestBefore, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(visit.receiptCount, 1);
  const results = readdirSync(join(fixture.stateRoot, "tasks", plan.runId, "coordination", "results"));
  assert.equal(results.length, 1);
  const [claude] = logLines(fixture, "fake-claude.log");
  assert.ok(claude.argv.includes("--json-schema"), "the node asked Claude Code for its closed schema");
  assert.equal(claude.credentialVariable, "CLAUDE_CODE_OAUTH_TOKEN");
  const inReview = status(fixture, plan.runId);
  assert.equal(inReview.evidence.verificationVerdict, "PASS");
  assert.equal(inReview.checkpoints.budget.consumedTokens, 26);
  assert.equal(inReview.checkpoints.budget.billing, "subscription");
  const accepted = reviewed(fixture, plan.runId, run.surfaceDigest);
  assert.equal(accepted.state, "COMPLETED");
  assert.match(accepted.capsuleId, /^[a-f0-9]{64}$/u);
  assert.equal(fixture.git(["show", `vestra/${plan.runId}/T1:src/value.txt`]), "new");
});

test(
  "a graph runs its Codex readers and Claude Code writer in order through the SDK, one run, one verifier",
  TIMEOUT,
  async () => {
    if (!DARWIN) return;
    const fixture = await coordinatedFixture(EXECUTIONS.graph);
    const plan = await approved(fixture);
    assert.deepEqual(plan.review.selectedPassports, [
      "codex:gpt-5.2-codex",
      "claude-code:claude-sonnet-5",
      "codex:gpt-5.2-codex",
      "codex:gpt-5.2-codex"
    ]);
    const run = ok(fixture.launch(startArguments(fixture, plan.runId)), "start");
    assert.equal(run.state, "HUMAN_REVIEW");
    assert.deepEqual(visits(fixture, plan.runId), ["plan#1:completed", "build#1:completed", "review#1:completed"]);
    // invariant: each Codex node ran read-only with no tool, from the Workspace
    // login, in the run's worktree, which is not the user's checkout.
    const nodes = logLines(fixture, "fake-codex-node.log");
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0].cwd, nodes[1].cwd);
    assert.deepEqual(
      nodes.map((entry) => entry.accountChecked),
      [true, true],
      "each Codex node read its account and rate limits before its turn"
    );
    assert.notEqual(nodes[0].cwd, fixture.repository);
    const sessions = logLines(fixture, "fake-codex.log");
    assert.equal(sessions.length, 3, "two nodes and the verifier");
    for (const session of sessions) {
      assert.equal(session.sandbox, "read-only");
      assert.equal(session.tools, 0);
      assert.equal(session.login, "chatgpt");
      assert.equal(session.environmentKeys.includes("OPENAI_API_KEY"), false);
    }
    // invariant: SSI-19. The verifier judged the commit alone: no node's
    // answer reached its prompt.
    const verifierTurns = logLines(fixture, "fake-codex-turn.log");
    assert.deepEqual(
      verifierTurns.map((entry) => entry.nodeResultInPrompt),
      [false]
    );
    // why: 11 + 7 for the writer, 5 + 3 for each Codex node and the verifier,
    // on the run's one ledger.
    const budget = status(fixture, plan.runId).checkpoints.budget;
    assert.equal(budget.consumedTokens, 42);
    assert.equal(budget.usageEvents, 4);
    assert.equal(budget.consumedCostUsd, "not billed (subscription)");
    assert.equal(reviewed(fixture, plan.runId, run.surfaceDigest).state, "COMPLETED");
  }
);

test("a swarm hands work from the writer to the reviewer and ends where the reviewer ends it", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await coordinatedFixture(EXECUTIONS.swarm);
  const plan = await approved(fixture);
  const run = ok(fixture.launch(startArguments(fixture, plan.runId)), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  assert.deepEqual(visits(fixture, plan.runId), ["writer#1:completed", "reviewer#1:completed"]);
  assert.equal(ledger(fixture, plan.runId).roundState, "completed");
  assert.equal(fixture.git(["show", `vestra/${plan.runId}/T1:src/value.txt`]), "new");
});

test("cancel reaches a running node: its provider stops and the coordinated run is aborted", TIMEOUT, async (t) => {
  if (!DARWIN) return;
  const execution = structuredClone(EXECUTIONS.graph);
  execution.nodes[0].instructions = "Read the scope and never answer. node-hang";
  const fixture = await coordinatedFixture(execution);
  const plan = await approved(fixture);
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = new Promise((resolve) => child.once("close", (code) => resolve(code)));
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  const hung = () => logLines(fixture, "fake-codex-node.log").find((entry) => entry.hang === true)?.pid;
  t.after(() => {
    child.kill("SIGKILL");
    const pid = hung();
    if (pid !== undefined && running(pid)) process.kill(pid, "SIGKILL");
  });
  await waitFor(() => hung() !== undefined);
  assert.equal(running(hung()), true);
  const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
  assert.equal(cancelled.stopped, true);
  assert.equal(await finished, 1);
  assert.equal(JSON.parse(stdout).data.status, "ABORTED");
  await waitFor(() => !running(hung()), 10_000).catch(() => undefined);
  assert.equal(running(hung()), false, "the node's provider outlived the cancel");
  assert.equal(status(fixture, plan.runId).state, "ABORTED");
  assert.equal(logLines(fixture, "fake-claude.log").length, 0, "no node after the cancelled one started");
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
});
