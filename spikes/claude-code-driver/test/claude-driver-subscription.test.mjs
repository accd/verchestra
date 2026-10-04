// invariant: requalification of the mediated Claude Code driver for a
// subscription credential (the subscription provider authentication decision
// in .specs/STATE.md). The production ClaudeCodeDriver and the production MCP
// tool bridge run against the DETERMINISTIC FAKE `claude` executable
// (fake-claude-mediated.mjs), which itself refuses an invocation whose
// arguments or credential variable are not the profile's. No model is invoked
// and no real subscription token is used.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { CLAUDE_MEDIATED_TOOLS, ClaudeCodeDriver } from "../../../packages/drivers/src/index.ts";
import {
  MEDIATED_CREDENTIAL as token,
  abortOnceObserved,
  cleanupMediatedFixtures,
  fakeMediatedClaude as fakeClaude,
  mediatedErrors as errors,
  mediatedFixture
} from "../../../tests/helpers/claude-mediated-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../../../tests/helpers/mediation-platform.mjs";

const SUBSCRIPTION = "mediated-mcp-subscription";
const subscriptionFixture = (options = {}) => mediatedFixture({ kind: SUBSCRIPTION, ...options });

afterEach(cleanupMediatedFixtures);

test("the subscription profile completes the MCP handshake and reaches the controller through the bridge", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await subscriptionFixture();
  const { events, closed } = await fixture.run();
  assert.deepEqual(errors(events), []);
  assert.equal(closed.outcome, "completed");
  assert.deepEqual(
    events.filter((event) => event.type === "tool.requested").map((event) => event.name),
    ["mcp__verchestra__read_file", "mcp__verchestra__write_file"]
  );
  assert.ok(events.some((event) => event.type === "content.delta" && event.text === "read:alpha\n"));
  assert.deepEqual(
    events.filter((event) => event.type === "usage.updated").map(({ inputTokens, outputTokens }) => [inputTokens, outputTokens]),
    [[11, 7]]
  );
  const digest = createHash("sha256").update("implemented by the fake\n").digest("hex");
  assert.equal(fixture.invoked.length, 1);
  assert.equal(fixture.invoked[0].payloadRef, `payload:sha256:${digest}`);
  assert.equal(await readFile(join(fixture.worktree, "src", "a.txt"), "utf8"), "alpha\n");
});

test("the subscription invocation is exact, never bare, and never bypasses permissions", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await subscriptionFixture();
  await fixture.run();
  const { argv, mcpServers, mcpConfigMode } = await fixture.observation();
  const mcpConfig = argv[argv.indexOf("--mcp-config") + 1];
  assert.deepEqual(argv, [
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
    mcpConfig,
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
  ]);
  for (const forbidden of [
    "--bare",
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "bypassPermissions",
    "--add-dir",
    "--plugin-dir"
  ])
    assert.equal(argv.includes(forbidden), false, forbidden);
  assert.equal(argv.includes("scenario:read-write"), false);
  assert.equal(argv.some((argument) => argument.includes(token)), false);
  assert.ok(mcpConfig.startsWith(`${fixture.isolationRoot}/`));
  assert.deepEqual(mcpServers, ["verchestra"]);
  assert.equal(mcpConfigMode, 0o600);
});

test("the child runs in an empty per-run directory with only the brokered token, never an ambient session", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const ambient = {
    ANTHROPIC_API_KEY: "ambient-api-key",
    ANTHROPIC_AUTH_TOKEN: "ambient-bearer",
    CLAUDE_CODE_OAUTH_TOKEN: "ambient-subscription-token",
    CLAUDE_CODE_SESSION: "ambient-session",
    CLAUDE_CONFIG_DIR: join(tmpdir(), "ambient-claude-config")
  };
  const previous = Object.fromEntries(Object.keys(ambient).map((key) => [key, process.env[key]]));
  Object.assign(process.env, ambient);
  try {
    const fixture = await subscriptionFixture();
    await fixture.run();
    const observed = await fixture.observation();
    assert.notEqual(observed.cwd, fixture.worktree);
    assert.ok(observed.cwd.startsWith(`${fixture.isolationRoot}/`));
    assert.equal(observed.workingDirectoryEntries, 0);
    assert.notEqual(observed.home, homedir());
    assert.ok(observed.home.startsWith(`${fixture.isolationRoot}/`));
    assert.ok(observed.configDirectory.startsWith(`${fixture.isolationRoot}/`));
    assert.notEqual(observed.configDirectory, ambient.CLAUDE_CONFIG_DIR);
    // why: macOS CoreFoundation injects __CF_USER_TEXT_ENCODING into every
    // process it starts; the driver does not pass it.
    const passed = observed.environmentKeys.filter(
      (key) => !(process.platform === "darwin" && key === "__CF_USER_TEXT_ENCODING")
    );
    assert.deepEqual(passed, [
      "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
      "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS",
      "CLAUDE_CODE_DISABLE_CLAUDE_MDS",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      "CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL",
      "CLAUDE_CODE_DISABLE_TERMINAL_TITLE",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CONFIG_DIR",
      "DISABLE_AUTOUPDATER",
      "HOME",
      "TMPDIR"
    ]);
    for (const directory of [observed.cwd, observed.home, observed.configDirectory])
      await assert.rejects(access(directory), { code: "ENOENT" });
    // why: the fake echoes the token it received and the driver redacts only
    // the brokered value, so an exact `[REDACTED]` proves the child saw the
    // brokered token and not the ambient one, without recording either.
    const { events } = await (await subscriptionFixture({ scenario: "secret" })).run();
    assert.ok(events.some((event) => event.type === "content.delta" && event.text === "key:[REDACTED]"));
    for (const value of Object.values(ambient)) assert.equal(JSON.stringify(events).includes(value), false);
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

for (const [scenario, code] of [
  ["extra-tool", "VES_CLAUDE_TOOL_SURFACE_UNEXPECTED"],
  ["bridge-down", "VES_CLAUDE_BRIDGE_UNAVAILABLE"],
  ["extra-server", "VES_CLAUDE_TOOL_SURFACE_UNEXPECTED"],
  ["hook", "VES_CLAUDE_HOOK_UNEXPECTED"]
]) {
  test(`a subscription session in the ${scenario} state fails closed`, async (t) => {
    if (WIN32_HOST) return windowsMediationPath(t);
    const fixture = await subscriptionFixture({ scenario });
    const { events, closed } = await fixture.run();
    assert.deepEqual(errors(events), [code]);
    assert.equal(closed.outcome, "failed");
    assert.equal(events.some((event) => event.type === "tool.requested"), false);
    assert.deepEqual(fixture.invoked, []);
  });
}

test("a hook event or a second MCP server does not fail the API-key profile, which runs bare", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  for (const scenario of ["hook", "extra-server"]) {
    const { events, closed } = await (await mediatedFixture({ scenario })).run();
    assert.deepEqual(errors(events), [], scenario);
    assert.equal(closed.outcome, "completed", scenario);
  }
});

test("the subscription token is redacted from model output", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await subscriptionFixture({ scenario: "secret" });
  const { events } = await fixture.run();
  assert.equal(JSON.stringify(events).includes(token), false);
  assert.ok(events.some((event) => event.type === "content.delta" && event.text === "key:[REDACTED]"));
});

for (const [name, execution, code] of [
  ["a missing token", { environment: {} }, "VES_CLAUDE_CREDENTIAL_MISSING"],
  ["an empty token", { environment: { CLAUDE_CODE_OAUTH_TOKEN: "" } }, "VES_CLAUDE_CREDENTIAL_MISSING"],
  ["an API key instead of the token", { environment: { ANTHROPIC_API_KEY: token } }, "VES_CLAUDE_ENVIRONMENT_DENIED"],
  [
    "an API key beside the token",
    { environment: { CLAUDE_CODE_OAUTH_TOKEN: token, ANTHROPIC_API_KEY: "sk-ant-other" } },
    "VES_CLAUDE_ENVIRONMENT_DENIED"
  ],
  [
    "a redirected config directory",
    { environment: { CLAUDE_CODE_OAUTH_TOKEN: token, CLAUDE_CONFIG_DIR: "/" } },
    "VES_CLAUDE_ENVIRONMENT_DENIED"
  ],
  ["an unredacted token", { sensitiveValues: [] }, "VES_CLAUDE_CREDENTIAL_UNREDACTED"],
  ["a missing mediation block", { mediation: undefined }, "VES_CLAUDE_MEDIATION_INVALID"]
]) {
  test(`${name} is refused before the subscription profile spawns Claude Code`, async (t) => {
    if (WIN32_HOST) return windowsMediationPath(t);
    const fixture = await subscriptionFixture({ execution });
    await assert.rejects(fixture.run(), { code });
    assert.deepEqual(fixture.spawned, []);
  });
}

test("the API-key profile refuses the subscription token before spawning", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await mediatedFixture({ execution: { environment: { CLAUDE_CODE_OAUTH_TOKEN: token } } });
  await assert.rejects(fixture.run(), { code: "VES_CLAUDE_ENVIRONMENT_DENIED" });
  assert.deepEqual(fixture.spawned, []);
});

test("a machine-wide managed policy refuses the subscription profile before any spawn", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const probe = await subscriptionFixture();
  const file = join(probe.root, "managed-settings.json");
  const populated = join(probe.root, "policy-directory");
  const empty = join(probe.root, "empty-policy-directory");
  await writeFile(file, "{}\n");
  await mkdir(populated);
  await writeFile(join(populated, "CLAUDE.md"), "managed instructions\n");
  await mkdir(empty);
  for (const present of [file, populated]) {
    const fixture = await subscriptionFixture({ profile: { managedPolicyPaths: [join(probe.root, "absent"), present] } });
    await assert.rejects(fixture.run(), { code: "VES_CLAUDE_MANAGED_POLICY_PRESENT" });
    assert.deepEqual(fixture.spawned, []);
  }
  const clear = await subscriptionFixture({ profile: { managedPolicyPaths: [join(probe.root, "absent"), empty] } });
  assert.deepEqual(errors((await clear.run()).events), []);
  // hazard: a policy location that cannot be listed is present, never absent.
  const unreadable = join(probe.root, "unreadable-policy-directory");
  await mkdir(unreadable);
  await writeFile(join(unreadable, "managed-settings.json"), "{}\n");
  await chmod(unreadable, 0o000);
  try {
    const fixture = await subscriptionFixture({ profile: { managedPolicyPaths: [unreadable] } });
    await assert.rejects(fixture.run(), { code: "VES_CLAUDE_MANAGED_POLICY_PRESENT" });
    assert.deepEqual(fixture.spawned, []);
  } finally {
    await chmod(unreadable, 0o700);
  }
});

test("the subscription profile is validated at construction", (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const resolveExecution = async () => assert.fail("not reached");
  const command = [process.execPath, fakeClaude];
  assert.throws(() => new ClaudeCodeDriver({ command: ["claude"], profile: { kind: SUBSCRIPTION }, resolveExecution }), {
    code: "VES_CLAUDE_MEDIATION_INVALID"
  });
  assert.throws(
    () => new ClaudeCodeDriver({ command, profile: { kind: SUBSCRIPTION, environment: { HOME: "/" } }, resolveExecution }),
    { code: "VES_CLAUDE_ENVIRONMENT_DENIED" }
  );
  assert.throws(
    () => new ClaudeCodeDriver({ command, profile: { kind: SUBSCRIPTION, managedPolicyPaths: ["relative"] }, resolveExecution }),
    { code: "VES_CLAUDE_MEDIATION_INVALID" }
  );
  // why: a profile that runs bare cannot be told to skip a check it never makes.
  assert.throws(
    () => new ClaudeCodeDriver({ command, profile: { kind: "mediated-mcp", managedPolicyPaths: [] }, resolveExecution }),
    { code: "VES_CLAUDE_MEDIATION_INVALID" }
  );
  assert.throws(() => new ClaudeCodeDriver({ command, profile: { kind: "mediated" }, resolveExecution }), {
    code: "VES_CLAUDE_MEDIATION_INVALID"
  });
});

test("the subscription profile requires at least the qualified Claude Code build", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await subscriptionFixture({ dependencies: { minimumVersion: "2.1.300" } });
  const probe = await fixture.driver.probe();
  assert.equal(probe.available, false);
  assert.equal(probe.error.code, "VES_CLAUDE_VERSION_UNSUPPORTED");
  await assert.rejects(fixture.run(), { code: "VES_CLAUDE_VERSION_UNSUPPORTED" });
  assert.deepEqual(fixture.spawned, []);
});

test("cancellation terminates the subscription session and still removes its isolation directory", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const fixture = await subscriptionFixture({ scenario: "hang" });
  const { events, closed, spawned } = await abortOnceObserved(fixture);
  assert.equal(spawned, 1);
  assert.deepEqual(errors(events), ["VES_CLAUDE_ABORTED"]);
  assert.equal(closed.outcome, "cancelled");
  const { home, cwd } = await fixture.observation();
  await assert.rejects(access(home), { code: "ENOENT" });
  await assert.rejects(access(cwd), { code: "ENOENT" });
});
