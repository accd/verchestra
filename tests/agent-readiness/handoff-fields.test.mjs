import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHandoff } from "../../scripts/agent-readiness.mjs";

const FIELDS = {
  schema: "verchestra-feature-handoff/v1",
  feature: "example-feature",
  issue: "123",
  status: "in_progress",
  branch: "feature/example",
  baseRevision: "0123456789012345678901234567890123456789",
  lastCompletedTask: "T2",
  nextTask: "T3",
  lastGate: "pnpm gate:quick",
  updatedAt: "2026-07-25T00:00:00Z"
};

function handoff(overrides = {}) {
  const fields = { ...FIELDS, ...overrides };
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n\n# Notes\n`;
}

test("a handoff whose fields are all valid parses, with nullable fields accepting null", () => {
  const parsed = parseHandoff(handoff({ issue: "null", lastCompletedTask: "null", lastGate: "null" }));
  assert.equal(parsed.issue, null);
  assert.equal(parsed.lastCompletedTask, null);
  assert.equal(parsed.lastGate, null);
  assert.equal(parsed.body, "\n# Notes\n");
});

for (const [label, overrides, problem] of [
  ["another schema", { schema: "verchestra-feature-handoff/v2" }, "unsupported schema"],
  ["an uppercase feature slug", { feature: "Example" }, "invalid feature"],
  ["a zero issue", { issue: "0" }, "invalid issue"],
  ["a non-numeric issue", { issue: "abc" }, "invalid issue"],
  ["an unknown status", { status: "done" }, "invalid status"],
  ["an empty branch", { branch: "" }, "invalid branch"],
  ["a short base revision", { baseRevision: "abc123" }, "invalid baseRevision"],
  ["a last task outside the T<n> form", { lastCompletedTask: "task-2" }, "invalid lastCompletedTask"],
  ["a null next task", { nextTask: "null" }, "invalid nextTask"],
  ["a numeric last gate", { lastGate: "7" }, "invalid lastGate"],
  ["a local timestamp", { updatedAt: "2026-07-25 00:00" }, "updatedAt must be ISO-8601 UTC"]
]) {
  test(`a handoff is refused for ${label}`, () => {
    assert.throws(() => parseHandoff(handoff(overrides), "x/handoff.md"), { message: `x/handoff.md: ${problem}` });
  });
}

test("the first invalid field in contract order names the refusal", () => {
  assert.throws(() => parseHandoff(handoff({ updatedAt: "yesterday", status: "done", feature: "Bad" })), {
    message: "handoff.md: invalid feature"
  });
  assert.throws(() => parseHandoff(handoff({ updatedAt: "yesterday", lastGate: "7" })), {
    message: "handoff.md: invalid lastGate"
  });
});

test("a missing field is reported before any field is validated", () => {
  const source = handoff({ schema: "wrong" }).replace("nextTask: T3\n", "");
  assert.throws(() => parseHandoff(source), { message: "handoff.md: missing nextTask" });
});
