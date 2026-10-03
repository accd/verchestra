// invariant: the structured-result, effective-authentication, and quota
// interface of the Claude Code driver (T4 of the Strands subscription
// integration; SSI-46, SSI-48, SSI-54, SSI-57, SSI-58). The production
// ClaudeCodeDriver runs against the labeled DETERMINISTIC FAKE `claude`
// (fake-claude-mediated.mjs), which emits the message shapes the installed
// 2.1.282 declares for `system/init`, `result`, and `rate_limit_event`. No
// model is invoked.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  CLAUDE_MEDIATED_TOOLS,
  CLAUDE_STRUCTURED_OUTPUT_TOOL,
  ClaudeCodeDriver
} from "../../packages/drivers/src/index.ts";
import {
  cleanupMediatedFixtures,
  fakeMediatedClaude,
  mediatedErrors,
  mediatedFixture
} from "../helpers/claude-mediated-fixture.mjs";
import { claudeFixture } from "../helpers/claude-driver-fixture.mjs";
import { WIN32_HOST, mediationRefusedOnWin32 } from "../helpers/mediation-platform.mjs";

afterEach(cleanupMediatedFixtures);

const SUBSCRIPTION = "mediated-mcp-subscription";
// why: a closed node-result shape of the kind the application will own (T5);
// the driver passes it on and never reads it.
const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: { outcome: { enum: ["done", "blocked"] }, summary: { type: "string", maxLength: 8192 } }
});
const SCHEMA_TEXT =
  '{"additionalProperties":false,"properties":{"outcome":{"enum":["done","blocked"]},"summary":{"maxLength":8192,"type":"string"}},"required":["outcome","summary"],"type":"object"}';
const structured = (maxBytes = 4096) => ({ structuredOutput: { schema: SCHEMA, maxBytes } });
const types = (events) => events.map((event) => (event.type === "error" ? `error:${event.code}` : event.type));
const builder = (kind) =>
  new ClaudeCodeDriver({
    command: [process.execPath, fakeMediatedClaude],
    profile: { kind },
    resolveExecution: async () => assert.fail("not reached")
  });

test("a structured session adds the schema and names the structured-output tool, and nothing else", (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  assert.equal(CLAUDE_STRUCTURED_OUTPUT_TOOL, "StructuredOutput");
  for (const [kind, build] of [
    ["mediated-mcp", (driver, ...rest) => driver.buildMediatedArguments(...rest)],
    [SUBSCRIPTION, (driver, ...rest) => driver.buildSubscriptionArguments(...rest)]
  ]) {
    const plain = build(builder(kind), "claude-sonnet-5", "/run/config/mcp.json");
    const withSchema = build(builder(kind), "claude-sonnet-5", "/run/config/mcp.json", SCHEMA_TEXT);
    const allowed = withSchema[withSchema.indexOf("--allowedTools") + 1];
    assert.equal(allowed, [...CLAUDE_MEDIATED_TOOLS, "StructuredOutput"].join(","), kind);
    assert.deepEqual(withSchema.slice(-4), ["--json-schema", SCHEMA_TEXT, "--model", "claude-sonnet-5"], kind);
    assert.deepEqual(
      withSchema.filter((argument) => !plain.includes(argument)),
      [allowed, "--json-schema", SCHEMA_TEXT],
      kind
    );
    assert.equal(plain.length + 2, withSchema.length, kind);
  }
});

test("a structured success becomes one bounded structured result and the structured-output call is no tool request", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  for (const scenario of ["structured", "structured-unlisted"]) {
    const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario, execution: structured() });
    const { events, closed } = await fixture.run();
    assert.deepEqual(
      types(events),
      ["session.started", "model.resolved", "usage.updated", "result.structured", "session.closed"],
      scenario
    );
    const result = events.find((event) => event.type === "result.structured");
    assert.deepEqual(result.value, { outcome: "done", summary: "structured by the fake" });
    // {"outcome":"done","summary":"structured by the fake"} is 53 bytes.
    assert.equal(result.bytes, 53);
    assert.equal(closed.outcome, "completed");
    const { argv } = await fixture.observation();
    assert.deepEqual(argv.slice(-4, -2), ["--json-schema", SCHEMA_TEXT]);
  }
});

test("a structured session fails when the provider gives no structured result", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  for (const [scenario, expected] of [
    [
      "structured-missing",
      [
        "session.started",
        "model.resolved",
        "usage.updated",
        "error:VES_CLAUDE_STRUCTURED_OUTPUT_MISSING",
        "session.closed"
      ]
    ],
    [
      "structured-retries",
      [
        "session.started",
        "model.resolved",
        "usage.updated",
        "error:VES_CLAUDE_STRUCTURED_OUTPUT_MISSING",
        "session.closed"
      ]
    ]
  ]) {
    const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario, execution: structured() });
    const { events, closed } = await fixture.run();
    assert.deepEqual(types(events), expected, scenario);
    assert.equal(closed.outcome, "failed", scenario);
  }
});

test("a structured result beyond its bound is refused before it is emitted", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "structured", execution: structured(52) });
  const { events, closed } = await fixture.run();
  assert.deepEqual(types(events), [
    "session.started",
    "model.resolved",
    "usage.updated",
    "error:VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT",
    "session.closed"
  ]);
  assert.equal(closed.outcome, "failed");
  assert.equal(JSON.stringify(events).includes("structured by the fake"), false);
  const large = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "structured-large", execution: structured() });
  assert.deepEqual(mediatedErrors((await large.run()).events), ["VES_CLAUDE_STRUCTURED_OUTPUT_LIMIT"]);
});

test("a session that did not ask for a structured result refuses the structured-output tool", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const listed = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "structured-tool-unasked" });
  assert.deepEqual(mediatedErrors((await listed.run()).events), ["VES_CLAUDE_TOOL_SURFACE_UNEXPECTED"]);
  const called = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "structured-call-unasked" });
  const { events } = await called.run();
  assert.deepEqual(
    events.filter((event) => event.type === "tool.requested").map((event) => event.name),
    ["StructuredOutput"],
    "an unasked structured-output call stays a tool request, which the adapter refuses"
  );
});

test("a structured output request is refused before spawn unless it is a bounded schema on a mediated profile", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  for (const structuredOutput of [
    { schema: SCHEMA },
    { schema: SCHEMA, maxBytes: 0 },
    { schema: SCHEMA, maxBytes: 1_048_577 },
    { schema: SCHEMA, maxBytes: 1.5 },
    { schema: [], maxBytes: 64 },
    { schema: { type: "object", description: "x".repeat(16_384) }, maxBytes: 64 },
    { schema: SCHEMA, maxBytes: 64, fallbackModel: "claude-haiku" }
  ]) {
    const fixture = await mediatedFixture({ kind: SUBSCRIPTION, execution: { structuredOutput } });
    await assert.rejects(fixture.run(), { code: "VES_CLAUDE_OUTPUT_SCHEMA_INVALID" }, JSON.stringify(structuredOutput));
    assert.deepEqual(fixture.spawned, []);
  }
  const open = claudeFixture({ structuredOutput: { schema: SCHEMA, maxBytes: 64 } });
  await assert.rejects(
    new ClaudeCodeDriver(open.dependencies()).start(open.request(), () => {}, new AbortController().signal),
    { code: "VES_CLAUDE_OUTPUT_SCHEMA_INVALID" }
  );
  assert.equal(open.calls.spawn, 0);
});

test("the subscription profile fails a session whose effective credential is not the subscription", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "api-key-source" });
  const { events, closed } = await fixture.run();
  assert.deepEqual(types(events), ["error:VES_CLAUDE_AUTH_METHOD_MISMATCH", "session.closed"]);
  assert.equal(closed.outcome, "failed");
  assert.deepEqual(fixture.invoked, [], "no tool effect reached the executor");
  const subscription = await mediatedFixture({ kind: SUBSCRIPTION });
  assert.deepEqual(mediatedErrors((await subscription.run()).events), []);
  // why: the bare profile authenticates with an API key by design, so its
  // reported source is that key and the session is not refused for it.
  const bare = await mediatedFixture({ kind: "mediated-mcp" });
  assert.deepEqual(mediatedErrors((await bare.run()).events), []);
});

test("a rejected rate limit reports quota exhaustion with the reset the provider gave", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  for (const [scenario, quota] of [
    ["rate-rejected", { type: "quota.exhausted", scope: "five_hour", resetsAt: "2026-09-21T14:13:20.000Z" }],
    ["rate-rejected-no-reset", { type: "quota.exhausted", scope: "seven_day" }]
  ]) {
    const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario });
    const { events, closed } = await fixture.run();
    assert.deepEqual(
      types(events),
      [
        "session.started",
        "model.resolved",
        "quota.exhausted",
        "usage.updated",
        "error:VES_CLAUDE_EXECUTION_FAILED",
        "session.closed"
      ],
      scenario
    );
    const { sequence, ...reported } = events.find((event) => event.type === "quota.exhausted");
    assert.equal(sequence, 2);
    assert.deepEqual(reported, quota, scenario);
    assert.equal(closed.outcome, "failed");
  }
});

test("a usage warning is recorded once and the session continues", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "rate-warning" });
  const { events, closed } = await fixture.run();
  const warnings = events.filter((event) => event.type === "warning");
  assert.deepEqual(
    warnings.map(({ code, message }) => ({ code, message })),
    [{ code: "VES_CLAUDE_QUOTA_WARNING", message: "Claude Code reported that a usage limit is near" }]
  );
  assert.equal(
    events.some((event) => event.type === "quota.exhausted"),
    false
  );
  assert.equal(closed.outcome, "completed");
  assert.equal(fixture.invoked.length, 1, "the write still reached the executor");
});
