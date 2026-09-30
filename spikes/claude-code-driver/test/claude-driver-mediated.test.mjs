// T03 requalification for the mediated-mcp profile (AD-039, the mediated MCP bridge decision). The production
// ClaudeCodeDriver and the production MCP tool bridge run against a
// DETERMINISTIC FAKE `claude` executable (fake-claude-mediated.mjs). The only
// real-provider evidence is the read-only `--help` probe; no model is invoked.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, test } from "node:test";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../../packages/agent-runtime/src/index.ts";
import {
  CLAUDE_MEDIATED_MINIMUM_VERSION,
  CLAUDE_MEDIATED_TOOLS,
  ClaudeCodeDriver
} from "../../../packages/drivers/src/index.ts";
import { mockRequest } from "../../../tests/helpers/driver-protocol-fixture.mjs";
import { WIN32_HOST, mediationRefusedOnWin32 } from "../../../tests/helpers/mediation-platform.mjs";
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
    command: [process.execPath, fakeClaude, "--fixture-observations", observations],
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
  const observed = () => access(join(observations, "fake-claude-observation.json")).then(() => true, () => false);
  return { controller, driver, invoked, isolationRoot, observation, observed, payloads, run, spawned, worktree };
}

const errors = (events) => events.filter((event) => event.type === "error").map((event) => event.code);

test("fake claude completes the MCP handshake and reaches the controller through the bridge", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
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

test("the mediated invocation disables built-ins, allows only bridge tools, and never bypasses permissions", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
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

test("the child runs in the worktree with per-run identity directories and only the brokered credential", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
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
    // why: the fake echoes the key it received and the driver redacts only the
    // brokered value, so an exact `[REDACTED]` proves the child saw exactly the
    // brokered credential without the fake hashing or recording it.
    const { events } = await (await mediatedFixture({ scenario: "secret" })).run();
    assert.ok(events.some((event) => event.type === "content.delta" && event.text === "key:[REDACTED]"));
    assert.equal(JSON.stringify(events).includes("ambient-credential"), false);
  } finally {
    for (const [key, value] of [
      ["ANTHROPIC_API_KEY", previous.key],
      ["CLAUDE_CODE_SESSION", previous.session]
    ])
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});

test("reads outside the approved scope are denied at the bridge", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ scenario: "read-escape" });
  await fixture.run();
  const { toolResults } = await fixture.observation();
  assert.deepEqual(toolResults, [
    { name: "read_file", isError: true, text: "denied: VES_BRIDGE_PATH_INVALID" },
    { name: "read_file", isError: true, text: "denied: VES_BRIDGE_PATH_PROTECTED" }
  ]);
});

test("a session advertising a built-in tool fails closed", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ scenario: "extra-tool" });
  const { events, closed } = await fixture.run();
  assert.deepEqual(errors(events), ["VES_CLAUDE_TOOL_SURFACE_UNEXPECTED"]);
  assert.equal(closed.outcome, "failed");
});

test("a session whose bridge is not connected fails closed", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ scenario: "bridge-down" });
  const { events } = await fixture.run();
  assert.deepEqual(errors(events), ["VES_CLAUDE_BRIDGE_UNAVAILABLE"]);
});

test("the brokered credential is redacted from model output", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
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
  test(`${name} is refused before Claude Code is spawned`, async (t) => {
    if (WIN32_HOST) return mediationRefusedOnWin32(t);
    const fixture = await mediatedFixture({ execution });
    await assert.rejects(fixture.run(), { code });
    assert.deepEqual(fixture.spawned, []);
  });
}

test("the profile refuses a relative executable and non-allowlisted ambient values at construction", (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
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

test("the mediated profile requires at least the qualified Claude Code build", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
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

test("cancellation terminates the mediated session and still removes its isolation directory", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const fixture = await mediatedFixture({ scenario: "hang" });
  const controller = new AbortController();
  const pending = fixture.run(controller.signal);
  const deadline = Date.now() + 10_000;
  // why: abort only once the fake has recorded its identity directories and is
  // hanging; a fixed delay raced the MCP handshake on slower CI runners.
  while (!(await fixture.observed()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fixture.spawned.length, 1);
  controller.abort();
  const { events, closed } = await pending;
  assert.deepEqual(errors(events), ["VES_CLAUDE_ABORTED"]);
  assert.equal(closed.outcome, "cancelled");
  const { home } = await fixture.observation();
  await assert.rejects(access(home), { code: "ENOENT" });
});

const PIN_REQUIRED = process.env.VES_REQUIRE_PINNED_PROVIDERS === "1";

function atLeast(actual, minimum) {
  const [left, right] = [actual, minimum].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] > right[index];
  return true;
}

// why: the mediated profile needs an absolute executable; this resolves the
// same bare name the T03 probe runs, from the PATH the probe inherits.
async function absoluteClaude(command) {
  if (isAbsolute(command)) return command;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, command);
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  }
  return assert.fail("the installed Claude Code answered --version but is not on an absolute PATH entry");
}

// Read-only probe of the installed Claude Code: `--version` and `--help` never
// invoke a model. A build at or above the mediated minimum must carry every
// mediated flag; an older build must be refused by the mediated profile with its
// version code rather than launched with flags it lacks. The fleet pin must
// reach the minimum. A machine without Claude Code reports not configured,
// never a pass by omission.
test("every mediated flag exists in the installed Claude Code help", async (t) => {
  if (WIN32_HOST) return mediationRefusedOnWin32(t);
  const [command, ...prefix] = resolveClaudeCommand();
  let versionText;
  let help;
  try {
    const options = { encoding: "utf8", timeout: 20_000, windowsHide: true };
    versionText = (await execFileAsync(command, [...prefix, "--version"], options)).stdout;
    help = (await execFileAsync(command, [...prefix, "--help"], options)).stdout;
  } catch (error) {
    assert.equal(PIN_REQUIRED, false, "the fleet must install its pinned Claude Code");
    assert.match(String(error.code), /^(ENOENT|EACCES|\d+)$/u, "Claude Code is not configured on this machine");
    return;
  }
  const installed = /^(\d+\.\d+\.\d+)/u.exec(versionText.trim())?.[1];
  assert.ok(installed !== undefined, "the installed Claude Code reports a version");
  const qualified = atLeast(installed, CLAUDE_MEDIATED_MINIMUM_VERSION);
  if (PIN_REQUIRED) assert.ok(qualified, `the fleet pin ${installed} is below the mediated minimum`);
  const probe = await new ClaudeCodeDriver({
    command: [await absoluteClaude(command), ...prefix],
    profile: { kind: "mediated-mcp", environment: { PATH: process.env.PATH ?? "" } },
    resolveExecution: async () => assert.fail("not reached")
  }).probe();
  assert.equal(probe.version, installed);
  if (!qualified) {
    assert.equal(probe.available, false);
    assert.equal(probe.error.code, "VES_CLAUDE_VERSION_UNSUPPORTED");
    return;
  }
  assert.equal(probe.available, true);
  const flags = new ClaudeCodeDriver({
    command: [process.execPath, fakeClaude],
    profile: { kind: "mediated-mcp" },
    resolveExecution: async () => assert.fail("not reached")
  })
    .buildMediatedArguments("claude-sonnet-5", "/mcp.json")
    .filter((argument) => argument.startsWith("--"));
  for (const flag of flags) assert.ok(help.includes(flag), `installed Claude Code lacks ${flag}`);
});

test("the mediated version floor compares every component numerically", () => {
  assert.equal(atLeast("2.1.282", "2.1.282"), true);
  assert.equal(atLeast("2.1.300", "2.1.282"), true);
  assert.equal(atLeast("2.2.0", "2.1.282"), true);
  assert.equal(atLeast("2.1.168", "2.1.282"), false);
  assert.equal(atLeast("2.0.999", "2.1.282"), false);
});
