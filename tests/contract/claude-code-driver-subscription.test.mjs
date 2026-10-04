// invariant: the subscription profile's interface, pinned. Its invocation is
// the mediated one without `--bare` (which would discard the subscription
// token) plus the two flags that take its place; the only credential it
// accepts is the subscription token; and it keeps the mediated profile's
// fail-closed checks. The labeled DETERMINISTIC FAKE `claude` stands in for
// Claude Code; no model is invoked.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  CLAUDE_MEDIATED_MINIMUM_VERSION,
  CLAUDE_MEDIATED_TOOLS,
  CLAUDE_PROFILE_CREDENTIAL_VARIABLES,
  CLAUDE_SUBSCRIPTION_SETTINGS,
  ClaudeCodeDriver
} from "../../packages/drivers/src/index.ts";
import {
  cleanupMediatedFixtures,
  fakeMediatedClaude,
  mediatedErrors,
  mediatedFixture
} from "../helpers/claude-mediated-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";

afterEach(cleanupMediatedFixtures);

const SUBSCRIPTION = "mediated-mcp-subscription";
const driver = (kind) =>
  new ClaudeCodeDriver({
    command: [process.execPath, fakeMediatedClaude],
    profile: { kind },
    resolveExecution: async () => assert.fail("not reached")
  });

test("each mediated profile names exactly one credential variable", () => {
  assert.deepEqual(
    { ...CLAUDE_PROFILE_CREDENTIAL_VARIABLES },
    { "mediated-mcp": "ANTHROPIC_API_KEY", "mediated-mcp-subscription": "CLAUDE_CODE_OAUTH_TOKEN" }
  );
  assert.equal(Object.isFrozen(CLAUDE_PROFILE_CREDENTIAL_VARIABLES), true);
});

test("the subscription settings switch off hooks and auto memory and nothing else", () => {
  assert.equal(CLAUDE_SUBSCRIPTION_SETTINGS, '{"disableAllHooks":true,"autoMemoryEnabled":false}');
  assert.deepEqual(JSON.parse(CLAUDE_SUBSCRIPTION_SETTINGS), { disableAllHooks: true, autoMemoryEnabled: false });
});

test("the subscription profile builds its exact qualified invocation", (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  assert.deepEqual(
    driver(SUBSCRIPTION).buildSubscriptionArguments("claude-sonnet-5", "/run/config/mcp.json").slice(1),
    [
      "--print",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--include-hook-events",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      "/run/config/mcp.json",
      "--tools",
      "",
      "--allowedTools",
      CLAUDE_MEDIATED_TOOLS.join(","),
      "--permission-mode",
      "dontAsk",
      "--permission-prompts",
      "none",
      "--no-chrome",
      "--setting-sources",
      "",
      "--settings",
      '{"disableAllHooks":true,"autoMemoryEnabled":false}',
      "--model",
      "claude-sonnet-5"
    ]
  );
  assert.equal(CLAUDE_MEDIATED_MINIMUM_VERSION, "2.1.282");
});

test("the two mediated invocations differ only by --bare and the flags that replace it", (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const bare = driver("mediated-mcp").buildMediatedArguments("claude-sonnet-5", "/run/config/mcp.json");
  const subscription = driver(SUBSCRIPTION).buildSubscriptionArguments("claude-sonnet-5", "/run/config/mcp.json");
  assert.deepEqual(
    bare.filter((argument) => !subscription.includes(argument)),
    ["--bare"]
  );
  assert.deepEqual(
    subscription.filter((argument) => !bare.includes(argument)),
    ["--include-hook-events", "--settings", CLAUDE_SUBSCRIPTION_SETTINGS]
  );
  for (const bypass of ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "bypassPermissions"])
    assert.equal(subscription.includes(bypass), false, bypass);
});

test("the subscription profile refuses to start without its token", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  for (const [environment, code] of [
    [{}, "VES_CLAUDE_CREDENTIAL_MISSING"],
    [{ ANTHROPIC_API_KEY: "sk-ant-not-a-subscription-token" }, "VES_CLAUDE_ENVIRONMENT_DENIED"]
  ]) {
    const fixture = await mediatedFixture({ kind: SUBSCRIPTION, execution: { environment } });
    await assert.rejects(fixture.run(), { code });
    assert.deepEqual(fixture.spawned, []);
  }
});

test("the subscription profile refuses a session that advertises a non-bridge tool", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await mediatedFixture({ kind: SUBSCRIPTION, scenario: "extra-tool" });
  const { events, closed } = await fixture.run();
  assert.deepEqual(mediatedErrors(events), ["VES_CLAUDE_TOOL_SURFACE_UNEXPECTED"]);
  assert.equal(closed.outcome, "failed");
  assert.deepEqual(fixture.invoked, []);
});
