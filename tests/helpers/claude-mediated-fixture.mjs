// invariant: one fixture for both mediated Claude Code profiles. The production
// ClaudeCodeDriver and the production MCP tool bridge run against the labeled
// DETERMINISTIC FAKE `claude` executable (fake-claude-mediated.mjs); no model
// and no provider is ever contacted.
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryExecutionPayloadStore, McpToolBridgeController } from "../../packages/agent-runtime/src/index.ts";
import { ClaudeCodeDriver } from "../../packages/drivers/src/index.ts";
import { mockRequest } from "./driver-protocol-fixture.mjs";

export const fakeMediatedClaude = fileURLToPath(
  new URL("../../spikes/claude-code-driver/test/fake-claude-mediated.mjs", import.meta.url)
);
const relayEntry = fileURLToPath(
  new URL("../../packages/agent-runtime/src/execution/mcp-tool-bridge-main.ts", import.meta.url)
);
export const MEDIATED_CREDENTIAL = "qualification-credential-value";
const CREDENTIAL_VARIABLES = Object.freeze({
  "mediated-mcp": "ANTHROPIC_API_KEY",
  "mediated-mcp-subscription": "CLAUDE_CODE_OAUTH_TOKEN"
});
const roots = [];
const controllers = [];

export async function cleanupMediatedFixtures() {
  await Promise.all(controllers.splice(0).map((controller) => controller.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}

export const mediatedErrors = (events) => events.filter((event) => event.type === "error").map((event) => event.code);

export async function mediatedFixture(options = {}) {
  const kind = options.kind ?? "mediated-mcp";
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
    environment: { [CREDENTIAL_VARIABLES[kind]]: MEDIATED_CREDENTIAL },
    sensitiveValues: [MEDIATED_CREDENTIAL],
    mediation: {
      cwd: worktree,
      bridge: { command: [process.execPath, relayEntry], environment: controller.environment }
    },
    ...options.execution
  };
  const driver = new ClaudeCodeDriver({
    command: [process.execPath, fakeMediatedClaude, "--fixture-observations", observations],
    // why: the subscription profile refuses a machine with a managed Claude
    // Code policy; a fixture names an empty location so the host's own state
    // never decides a deterministic case.
    profile: {
      kind,
      environment: { TMPDIR: observations },
      isolationRoot,
      ...(kind === "mediated-mcp" ? {} : { managedPolicyPaths: [join(root, "no-managed-policy")] }),
      ...options.profile
    },
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
  const observed = () =>
    access(join(observations, "fake-claude-observation.json")).then(
      () => true,
      () => false
    );
  return { controller, driver, invoked, isolationRoot, observation, observed, payloads, root, run, spawned, worktree };
}

// why: the cancellation cases abort only once the fake has recorded its
// identity directories and is hanging; a fixed delay raced the MCP handshake
// on slower CI runners.
export async function abortOnceObserved(fixture) {
  const controller = new AbortController();
  const pending = fixture.run(controller.signal);
  const deadline = Date.now() + 10_000;
  while (!(await fixture.observed()) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
  const spawned = fixture.spawned.length;
  controller.abort();
  return { ...(await pending), spawned };
}
