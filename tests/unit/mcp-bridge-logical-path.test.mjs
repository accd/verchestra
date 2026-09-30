import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";

import { logicalSegments } from "../../packages/agent-runtime/src/execution/mcp-bridge-tools.ts";

// why: the reference is the pattern the linear scan replaced (CodeQL
// js/polynomial-redos); it is applied here only to short generated inputs.
const REFERENCE_LOGICAL_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*\\)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+/-]+$/u;

function referenceOutcome(value) {
  if (value === ".") return { segments: [] };
  if (!REFERENCE_LOGICAL_PATH.test(value)) return { code: "VES_BRIDGE_PATH_INVALID" };
  const segments = value.split("/");
  while (segments.length > 1 && segments.at(-1) === "") segments.pop();
  if (segments.some((segment) => segment === "" || segment === ".")) return { code: "VES_BRIDGE_PATH_INVALID" };
  if (segments.some((segment) => segment.toLowerCase() === ".git")) return { code: "VES_BRIDGE_PATH_PROTECTED" };
  return { segments };
}

function outcome(value) {
  try {
    return { segments: [...logicalSegments(value)] };
  } catch (error) {
    return { code: error.code };
  }
}

function* strings(alphabet, maximumLength) {
  let level = [""];
  yield "";
  for (let length = 1; length <= maximumLength; length += 1) {
    const next = [];
    for (const prefix of level)
      for (const character of alphabet) {
        next.push(prefix + character);
        yield prefix + character;
      }
    level = next;
  }
}

test("the linear logical-path check agrees with the replaced pattern on every short input", () => {
  let compared = 0;
  for (const value of strings(["a", "G", ".", "/", "\\", ":", "-", "é"], 6)) {
    assert.deepEqual(outcome(value), referenceOutcome(value), JSON.stringify(value));
    compared += 1;
  }
  assert.equal(compared, 299_593);
});

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
