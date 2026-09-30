// T03 requalification for the mediated-mcp profile (AD-039, the mediated MCP bridge decision). The production
// ClaudeCodeDriver and the production MCP tool bridge run against a
// DETERMINISTIC FAKE `claude` executable (fake-claude-mediated.mjs). The only
// real-provider evidence is the read-only `--help` probe; no model is invoked.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../../packages/agent-runtime/src/index.ts";
import { CLAUDE_MEDIATED_TOOLS, ClaudeCodeDriver } from "../../../packages/drivers/src/index.ts";
import { mockRequest } from "../../../tests/helpers/driver-protocol-fixture.mjs";
import { resolveClaudeCommand } from "../src/claude-code-driver.mjs";

const execFileAsync = promisify(execFile);
const fakeClaude = fileURLToPath(new URL("./fake-claude-mediated.mjs", import.meta.url));
const relayEntry = fileURLToPath(
  new URL("../../../packages/agent-runtime/src/execution/mcp-tool-bridge-main.ts", import.meta.url)
);
const credential = "qualification-credential-value";
const roots = [];
const controllers = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function mediatedFixture(options = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "verchestra-claude-mediated-")));
  roots.push(root);
  const worktree = join(root, "worktree");
  const observations = join(root, "observations");
  const isolationRoot = join(root, "isolation");
  await mkdir(join(worktree, "src"), { recursive: true });
  await mkdir(join(worktree, ".git"), { recursive: true });
  await mkdir(observations);
  await mkdir(isolationRoot);
  await writeFile(join(worktree, "src", "a.txt"), "alpha\n");
  await writeFile(join(worktree, ".git", "config"), "[core]\n");
  const invoked = [];
  const payloads = new InMemoryExecutionPayloadStore();
  const controller = await McpToolBridgeController.open({
    worktreePath: worktree,
    readScope: ["src"],
    protectedPaths: [".git"],
    taskId: "T405.4",
    capabilityGrantRef: "grant:writer:1",
    payloads,
    invokeTool: async (request) => {
      invoked.push(request);
      return { receiptRef: `receipt:${invoked.length}` };
    }
  });
  controllers.push(controller);
  const spawned = [];
  const execution = {
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "anthropic",
      resolvedModel: "claude-sonnet-5"
    },
    prompt: `scenario:${options.scenario ?? "read-write"}`,
    model: "claude-sonnet-5",
    environment: { ANTHROPIC_API_KEY: credential },
    sensitiveValues: [credential],
    mediation: {
      cwd: worktree,
      bridge: { command: [process.execPath, relayEntry], environment: controller.environment }
    },
    ...options.execution
  };
  const driver = new ClaudeCodeDriver({
    command: [process.execPath, fakeClaude],
    profile: { kind: "mediated-mcp", environment: { TMPDIR: observations }, isolationRoot },
    resolveExecution: async () => execution,
    onSpawn: (pid) => spawned.push(pid),
    terminateTree: async (pid) => process.kill(pid),
    ...options.dependencies
  });
  const run = async (signal = new AbortController().signal) => {
    const events = [];
    const session = await driver.start(mockRequest(), (event) => events.push(event), signal);
    const closed = await driver.close(session);
    return { events, closed };
  };
  const observation = async () =>
    JSON.parse(await readFile(join(observations, "fake-claude-observation.json"), "utf8"));
  return { controller, driver, invoked, isolationRoot, observation, payloads, run, spawned, worktree };
}

const errors = (events) => events.filter((event) => event.type === "error").map((event) => event.code);

test("fake claude completes the MCP handshake and reaches the controller through the bridge", async () => {
  const fixture = await mediatedFixture();
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
  assert.deepEqual(fixture.invoked[0].targetPaths, ["src/a.txt"]);
  assert.equal(await readFile(join(fixture.worktree, "src", "a.txt"), "utf8"), "alpha\n");
});

test("the mediated invocation disables built-ins, allows only bridge tools, and never bypasses permissions", async () => {
  const fixture = await mediatedFixture();
  await fixture.run();
  const { argv, mcpServers, mcpConfigMode } = await fixture.observation();
  const value = (flag) => argv[argv.indexOf(flag) + 1];
  for (const flag of ["--print", "--bare", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"])
    assert.ok(argv.includes(flag), flag);
  assert.equal(value("--tools"), "");
  assert.equal(value("--allowedTools"), CLAUDE_MEDIATED_TOOLS.join(","));
  assert.equal(value("--permission-mode"), "dontAsk");
  assert.equal(value("--permission-prompts"), "none");
  assert.equal(value("--setting-sources"), "");
  for (const forbidden of ["--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "bypassPermissions", "--add-dir"])
    assert.equal(argv.includes(forbidden), false, forbidden);
  assert.equal(argv.includes("scenario:read-write"), false);
  assert.deepEqual(mcpServers, ["verchestra"]);
  assert.equal(mcpConfigMode, 0o600);
});

test("the child runs in the worktree with per-run identity directories and only the brokered credential", async () => {
  const previous = { key: process.env.ANTHROPIC_API_KEY, session: process.env.CLAUDE_CODE_SESSION };
  process.env.ANTHROPIC_API_KEY = "ambient-credential";
  process.env.CLAUDE_CODE_SESSION = "ambient-session";
  try {
    const fixture = await mediatedFixture();
    await fixture.run();
    const observed = await fixture.observation();
    assert.equal(observed.cwd, fixture.worktree);
    assert.notEqual(observed.home, homedir());
    assert.ok(observed.home.startsWith(`${fixture.isolationRoot}/`));
    assert.ok(observed.configDirectory.startsWith(`${fixture.isolationRoot}/`));
    assert.equal(observed.credentialDigest, createHash("sha256").update(credential).digest("hex"));
    // why: macOS CoreFoundation injects __CF_USER_TEXT_ENCODING into every
    // process it starts; the driver does not pass it.
    const passed = observed.environmentKeys.filter((key) => !(process.platform === "darwin" && key === "__CF_USER_TEXT_ENCODING"));
    assert.deepEqual(passed, [
      "ANTHROPIC_API_KEY",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      "CLAUDE_CONFIG_DIR",
      "DISABLE_AUTOUPDATER",
      "HOME",
      "TMPDIR"
    ]);
    await assert.rejects(access(observed.home), { code: "ENOENT" });
    await assert.rejects(access(observed.configDirectory), { code: "ENOENT" });
  } finally {
    for (const [key, value] of [
      ["ANTHROPIC_API_KEY", previous.key],
      ["CLAUDE_CODE_SESSION", previous.session]
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("reads outside the approved scope are denied at the bridge", async () => {
  const fixture = await mediatedFixture({ scenario: "read-escape" });
  await fixture.run();
  const { toolResults } = await fixture.observation();
  assert.deepEqual(toolResults, [
    { name: "read_file", isError: true, text: "denied: VES_BRIDGE_PATH_INVALID" },
    { name: "read_file", isError: true, text: "denied: VES_BRIDGE_PATH_PROTECTED" }
  ]);
});

test("a session advertising a built-in tool fails closed", async () => {
  const fixture = await mediatedFixture({ scenario: "extra-tool" });
  const { events, closed } = await fixture.run();
  assert.deepEqual(errors(events), ["VES_CLAUDE_TOOL_SURFACE_UNEXPECTED"]);
  assert.equal(closed.outcome, "failed");
});

test("a session whose bridge is not connected fails closed", async () => {
  const fixture = await mediatedFixture({ scenario: "bridge-down" });
  const { events } = await fixture.run();
  assert.deepEqual(errors(events), ["VES_CLAUDE_BRIDGE_UNAVAILABLE"]);
});

test("the brokered credential is redacted from model output", async () => {
  const fixture = await mediatedFixture({ scenario: "secret" });
  const { events } = await fixture.run();
  assert.equal(JSON.stringify(events).includes(credential), false);
  assert.ok(events.some((event) => event.type === "content.delta" && event.text === "key:[REDACTED]"));
});

for (const [name, execution, code] of [
  ["a missing credential", { environment: {} }, "VES_CLAUDE_CREDENTIAL_MISSING"],
  ["an unredacted credential", { sensitiveValues: [] }, "VES_CLAUDE_CREDENTIAL_UNREDACTED"],
  ["an extra environment value", { environment: { ANTHROPIC_API_KEY: credential, HOME: "/" } }, "VES_CLAUDE_ENVIRONMENT_DENIED"],
  ["a missing mediation block", { mediation: undefined }, "VES_CLAUDE_MEDIATION_INVALID"],
  [
    "a relative bridge command",
    { mediation: { cwd: tmpdir(), bridge: { command: ["node", "bridge.mjs"], environment: {} } } },
    "VES_CLAUDE_MEDIATION_INVALID"
  ]
]) {
  test(`${name} is refused before Claude Code is spawned`, async () => {
    const fixture = await mediatedFixture({ execution });
    await assert.rejects(fixture.run(), { code });
    assert.deepEqual(fixture.spawned, []);
  });
}

test("the profile refuses a relative executable and non-allowlisted ambient values at construction", () => {
  const resolveExecution = async () => assert.fail("not reached");
  assert.throws(() => new ClaudeCodeDriver({ command: ["claude"], profile: { kind: "mediated-mcp" }, resolveExecution }), {
    code: "VES_CLAUDE_MEDIATION_INVALID"
  });
  assert.throws(
    () =>
      new ClaudeCodeDriver({
        command: [process.execPath, fakeClaude],
        profile: { kind: "mediated-mcp", environment: { HOME: "/" } },
        resolveExecution
      }),
    { code: "VES_CLAUDE_ENVIRONMENT_DENIED" }
  );
});

test("the mediated profile requires at least the qualified Claude Code build", async () => {
  const fixture = await mediatedFixture({ dependencies: { minimumVersion: "2.1.300" } });
  const probe = await fixture.driver.probe();
  assert.equal(probe.available, false);
  assert.equal(probe.error.code, "VES_CLAUDE_VERSION_UNSUPPORTED");
  assert.equal((await new ClaudeCodeDriver({
    command: [process.execPath, fakeClaude],
    profile: { kind: "mediated-mcp" },
    resolveExecution: async () => assert.fail("not reached")
  }).probe()).version, "2.1.282");
});

test("cancellation terminates the mediated session and still removes its isolation directory", async () => {
  const fixture = await mediatedFixture({ scenario: "hang" });
  const controller = new AbortController();
  const pending = fixture.run(controller.signal);
  const deadline = Date.now() + 10_000;
  while (fixture.spawned.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  await new Promise((resolve) => setTimeout(resolve, 300));
  controller.abort();
  const { events, closed } = await pending;
  assert.deepEqual(errors(events), ["VES_CLAUDE_ABORTED"]);
  assert.equal(closed.outcome, "cancelled");
  const { home } = await fixture.observation();
  await assert.rejects(access(home), { code: "ENOENT" });
});

// Read-only probe of the installed Claude Code: `--help` never invokes a model.
// Every flag the mediated profile passes must exist in that build. A machine
// without Claude Code reports not configured, never a pass by omission.
test("every mediated flag exists in the installed Claude Code help", async () => {
  const [command, ...prefix] = resolveClaudeCommand();
  let help;
  try {
    help = (await execFileAsync(command, [...prefix, "--help"], { encoding: "utf8", timeout: 20_000, windowsHide: true })).stdout;
  } catch (error) {
    assert.match(String(error.code), /^(ENOENT|EACCES|[0-9]+)$/u, "Claude Code is not configured on this machine");
    return;
  }
  const flags = new ClaudeCodeDriver({
    command: [process.execPath, fakeClaude],
    profile: { kind: "mediated-mcp" },
    resolveExecution: async () => assert.fail("not reached")
  })
    .buildMediatedArguments("claude-sonnet-5", "/mcp.json")
    .filter((argument) => argument.startsWith("--"));
  for (const flag of flags) assert.ok(help.includes(flag), `installed Claude Code lacks ${flag}`);
});
