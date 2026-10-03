// invariant: requalification of the Claude Code driver for structured results,
// the effective-authentication check, and quota signals (T4 of the Strands
// subscription integration). The production ClaudeCodeDriver runs against the
// DETERMINISTIC FAKE `claude` executable (fake-claude-mediated.mjs), whose
// `system/init`, `result`, and `rate_limit_event` messages carry the fields the
// installed 2.1.282 declares for them. No model is invoked; the installed
// Claude Code is only asked for `--version` and `--help`.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { afterEach, test } from "node:test";
import { promisify } from "node:util";

import { CLAUDE_MEDIATED_MINIMUM_VERSION } from "../../../packages/drivers/src/index.ts";
import {
  cleanupMediatedFixtures, mediatedFixture
} from "../../../tests/helpers/claude-mediated-fixture.mjs";
import { installedProviderPath } from "../../../tests/helpers/installed-provider.mjs";
import { WIN32_HOST, mediationRefusedOnWin32 } from "../../../tests/helpers/mediation-platform.mjs";
import { resolveClaudeCommand } from "../src/claude-code-driver.mjs";

const execFileAsync = promisify(execFile);
const PIN_REQUIRED = process.env.VES_REQUIRE_PINNED_PROVIDERS === "1";
const SUBSCRIPTION = "mediated-mcp-subscription";
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: { outcome: { enum: ["done", "blocked"] }, summary: { type: "string", maxLength: 8192 } }
};
const structuredOutput = { schema: SCHEMA, maxBytes: 4096 };

afterEach(cleanupMediatedFixtures);

// why: a sequence is pinned with every field but the session identifier,
// which is random per run.
function pinned(events) {
  return events.map(({ sequence, ...event }) => (event.type === "session.started" ? { type: event.type, sequence } : { ...event, sequence }));
}

const STARTED = [
  { type: "session.started", sequence: 0 },
  {
    type: "model.resolved",
    passportRef: { passportId: "passport_018f0000-0000-7000-8000-000000001504", revision: 1 },
    provider: "anthropic",
    resolvedModel: "claude-sonnet-5",
    sequence: 1
  }
];

test("a structured subscription session reports exactly its bounded result", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "structured", execution: { structuredOutput } });
  const { events, closed } = await fixture.run();
  assert.deepEqual(pinned(events), [
    ...STARTED,
    { type: "usage.updated", inputTokens: 11, outputTokens: 7, sequence: 2 },
    { type: "result.structured", value: { outcome: "done", summary: "structured by the fake" }, bytes: 53, sequence: 3 },
    { type: "session.closed", outcome: "completed", sequence: 4 }
  ]);
  assert.equal(closed.outcome, "completed");
  assert.deepEqual(fixture.invoked, []);
});

test("a structured session without an answer, or with one beyond its bound, ends failed with a stable code", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  for (const [scenario, maxBytes, code] of [
    ["structured-missing", 4096, "VES_CLAUDE_STRUCTURED_OUTPUT_MISSING"],
    ["structured-retries", 4096, "VES_CLAUDE_STRUCTURED_OUTPUT_MISSING"],
    ["structured", 52, "VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT"]
  ]) {
    const fixture = await mediatedFixture({
      kind: SUBSCRIPTION,
      scenario,
      execution: { structuredOutput: { schema: SCHEMA, maxBytes } }
    });
    const { events } = await fixture.run();
    const usage = events.find((event) => event.type === "usage.updated");
    assert.deepEqual(
      pinned(events),
      [
        ...STARTED,
        { type: "usage.updated", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, sequence: 2 },
        { type: "error", code, message: "Claude Code returned no usable structured result", retryable: false, sequence: 3 },
        { type: "session.closed", outcome: "failed", sequence: 4 }
      ],
      scenario
    );
  }
});

test("a rejected rate limit is one quota event with only a scope and the reported reset", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "rate-rejected" });
  const { events } = await fixture.run();
  assert.deepEqual(pinned(events), [
    ...STARTED,
    { type: "quota.exhausted", scope: "five_hour", resetsAt: "2026-09-21T14:13:20.000Z", sequence: 2 },
    { type: "usage.updated", inputTokens: 0, outputTokens: 0, sequence: 3 },
    { type: "error", code: "VES_CLAUDE_EXECUTION_FAILED", message: "Claude Code failed", retryable: true, sequence: 4 },
    { type: "session.closed", outcome: "failed", sequence: 5 }
  ]);
  const serialized = JSON.stringify(events);
  for (const dropped of ["private-session-id", "credits_required", "out_of_credits", "canUserPurchaseCredits", "usage limit"])
    assert.equal(serialized.includes(dropped), false, dropped);
});

test("an API-key source in a subscription session ends it before it is announced", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "api-key-source" });
  const { events } = await fixture.run();
  assert.deepEqual(pinned(events), [
    { type: "error", code: "VES_CLAUDE_AUTH_METHOD_MISMATCH", message: "Claude Code stream failed", retryable: false, sequence: 0 },
    { type: "session.closed", outcome: "failed", sequence: 1 }
  ]);
});

// Read-only probe of the installed Claude Code: `--version` and `--help` never
// invoke a model. A build at or above the mediated minimum must document the
// structured-output flag the structured invocation passes. A machine without
// Claude Code reports not configured, never a pass by omission.
test("the installed Claude Code documents --json-schema", async (t) => {
  const [bare, ...prefix] = resolveClaudeCommand();
  const command = await installedProviderPath(bare);
  if (command === undefined) {
    assert.equal(PIN_REQUIRED, false, "the fleet must install its pinned Claude Code");
    return t.diagnostic("Claude Code is not configured on this machine");
  }
  let versionText;
  let help;
  try {
    const options = { encoding: "utf8", timeout: 20_000, windowsHide: true };
    versionText = (await execFileAsync(command, [...prefix, "--version"], options)).stdout;
    help = (await execFileAsync(command, [...prefix, "--help"], options)).stdout;
  } catch (error) {
    assert.equal(PIN_REQUIRED, false, "the fleet must install its pinned Claude Code");
    assert.match(String(error.code), /^(ENOENT|EACCES|\d+)$/u);
    return t.diagnostic("Claude Code is not configured on this machine");
  }
  const installed = /^(\d+)\.(\d+)\.(\d+)/u.exec(versionText.trim())?.slice(1).map(Number);
  assert.ok(installed !== undefined, "the installed Claude Code reports a version");
  const minimum = CLAUDE_MEDIATED_MINIMUM_VERSION.split(".").map(Number);
  const below = installed.findIndex((part, index) => part !== minimum[index]);
  if (below !== -1 && installed[below] < minimum[below]) {
    assert.equal(PIN_REQUIRED, false, "the fleet pin is below the mediated minimum");
    return t.diagnostic(`Claude Code ${installed.join(".")} is below the mediated minimum`);
  }
  assert.match(help.replace(/\s+/gu, " "), /--json-schema <schema> JSON Schema for structured output validation/u);
});
