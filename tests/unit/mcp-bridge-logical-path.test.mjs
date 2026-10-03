import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import { logicalSegments } from "../../packages/agent-runtime/src/execution/mcp-bridge-tools.ts";

function outcome(value) {
  try {
    return { segments: [...logicalSegments(value)] };
  } catch (error) {
    return { code: error.code };
  }
}

test("named logical paths keep their exact segments and refusal codes", () => {
  assert.deepEqual(outcome("."), { segments: [] });
  assert.deepEqual(outcome("src/a.txt"), { segments: ["src", "a.txt"] });
  assert.deepEqual(outcome("src/nested///"), { segments: ["src", "nested"] });
  for (const value of ["", "/etc/passwd", "C:/repo", "src\\a.txt", "src/../x", "..", "src/..", "a b", 7, undefined])
    assert.deepEqual(outcome(value), { code: "VES_BRIDGE_PATH_INVALID" }, String(value));
  for (const value of ["src//a", "./src", "src/./a"])
    assert.deepEqual(outcome(value), { code: "VES_BRIDGE_PATH_INVALID" }, value);
  for (const value of [".git", "src/.GIT/config", ".Git/"])
    assert.deepEqual(outcome(value), { code: "VES_BRIDGE_PATH_PROTECTED" }, value);
});

test("long separator runs are validated in bounded time", () => {
  const run = "/".repeat(100_000);
  const adversarial = [
    [`a${run}b`, { code: "VES_BRIDGE_PATH_INVALID" }],
    [`a${run}!`, { code: "VES_BRIDGE_PATH_INVALID" }],
    [`a${run}`, { segments: ["a"] }],
    [`${"a/".repeat(50_000)}..`, { code: "VES_BRIDGE_PATH_INVALID" }],
    [`${"a/".repeat(50_000)}\\`, { code: "VES_BRIDGE_PATH_INVALID" }]
  ];
  const started = performance.now();
  for (const [value, expected] of adversarial) assert.deepEqual(outcome(value), expected);
  assert.ok(performance.now() - started < 1_000, "logical-path validation must stay linear");
});
