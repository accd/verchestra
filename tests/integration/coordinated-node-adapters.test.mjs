// invariant: the coordinated run's own node adapters, as the composition
// builds them over the production Claude Code and Codex drivers, end a node
// by the coordination rules: a provider that gave no structured result, or
// one the driver could not read or bound, fails its node with
// VES_COORDINATION_RESULT_INVALID or VES_COORDINATION_RESULT_TOO_LARGE
// (SSI-46, SSI-47), and nothing of it is persisted. The providers are the
// labeled deterministic fakes of the driver spikes.
import assert from "node:assert/strict";
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
    [["failed", [driverCode]]],
    "the node's end is recorded with the driver's own code"
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
});
