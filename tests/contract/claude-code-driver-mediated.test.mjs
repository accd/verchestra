import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_BRIDGE_QUALIFIED_TOOLS } from "../../packages/agent-runtime/src/index.ts";
import {
  CLAUDE_MEDIATED_MINIMUM_VERSION,
  CLAUDE_MEDIATED_TOOLS,
  ClaudeCodeDriver
} from "../../packages/drivers/src/index.ts";
import { claudeFixture, fakeClaudePath } from "../helpers/claude-driver-fixture.mjs";

test("the driver allowlist and the bridge advertise the same five qualified tools", () => {
  assert.deepEqual([...CLAUDE_MEDIATED_TOOLS], [...MCP_BRIDGE_QUALIFIED_TOOLS]);
  assert.equal(CLAUDE_MEDIATED_TOOLS.length, 5);
  assert.ok(CLAUDE_MEDIATED_TOOLS.every((tool) => tool.startsWith("mcp__verchestra__")));
});

test("the T03 profile keeps its exact invocation for existing callers", () => {
  const args = new ClaudeCodeDriver(claudeFixture().dependencies()).buildArguments("claude-opus-4-8");
  assert.deepEqual(args.slice(1), [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--mcp-config",
    "{}",
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-chrome",
    "--setting-sources",
    "",
    "--model",
    "claude-opus-4-8"
  ]);
});

// invariant: the bridge reaches its controller over a Unix socket, so Windows
// refuses the mediated profile at construction, before any spawn; the exact
// invocation is asserted wherever the profile is supported.
test("the mediated profile refuses Windows before anything is spawned", () => {
  if (process.platform !== "win32") return;
  assert.throws(
    () =>
      new ClaudeCodeDriver({
        command: [process.execPath, fakeClaudePath],
        profile: { kind: "mediated-mcp" },
        resolveExecution: async () => assert.fail("not reached")
      }),
    { code: "VES_CLAUDE_MEDIATION_UNSUPPORTED" }
  );
});

test("the mediated profile builds its exact qualified invocation", () => {
  if (process.platform === "win32") return;
  const driver = new ClaudeCodeDriver({
    command: [process.execPath, fakeClaudePath],
    profile: { kind: "mediated-mcp" },
    resolveExecution: async () => assert.fail("not reached")
  });
  assert.deepEqual(driver.buildMediatedArguments("claude-sonnet-5", "/run/config/mcp.json").slice(1), [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--bare",
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
    "--model",
    "claude-sonnet-5"
  ]);
  assert.equal(CLAUDE_MEDIATED_MINIMUM_VERSION, "2.1.282");
});

test("the T03 profile refuses a mediation block before spawning", async () => {
  const fixture = claudeFixture({ mediation: { cwd: "/", bridge: { command: ["/bin/true"], environment: {} } } });
  const driver = new ClaudeCodeDriver(fixture.dependencies());
  await assert.rejects(
    driver.start(fixture.request(), () => undefined, new AbortController().signal),
    {
      code: "VES_CLAUDE_MEDIATION_INVALID"
    }
  );
  assert.equal(fixture.calls.spawn, 0);
});
