// invariant: the records T4 of the Strands subscription integration adds carry
// no token, session, personal data, provider prose, or machine-local path
// (SSI-49, SSI-81, TM-015): the new Driver events, the adapter's checkpoints,
// the structured-result payload, and the quota refusal. The production drivers
// run against their labeled DETERMINISTIC FAKES (fake-claude-mediated.mjs,
// fake-codex-app-server.mjs); no model is invoked.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { DriverExecutionAdapter, InMemoryExecutionPayloadStore } from "../../packages/agent-runtime/src/index.ts";
import { CODEX_STRUCTURED_MINIMUM_VERSION, ClaudeCodeDriver, CodexDriver } from "../../packages/drivers/src/index.ts";
import { fakeMediatedClaude } from "../helpers/claude-mediated-fixture.mjs";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";
import { mockRequest } from "../helpers/driver-protocol-fixture.mjs";
import { cleanupBridges, relayEntry } from "../helpers/mcp-bridge-fixture.mjs";
import { WIN32_HOST, windowsMediationPath } from "../helpers/mediation-platform.mjs";
import { executorInput } from "../helpers/task-executor-fixture.mjs";

const TOKEN = "subscription-token-security-value";
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: { outcome: { enum: ["done", "blocked"] }, summary: { type: "string", maxLength: 8192 } }
};
const roots = [];
after(async () => {
  await cleanupBridges();
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

// why: everything the fakes say that a record must never carry: the account
// e-mail and identifier, the purchase offer, the provider's own prose, and the
// private session, thread, and turn identities.
const PROVIDER_PRIVATE = [
  "owner@example.invalid",
  "private-account-id",
  "upgrade-offer-text",
  "Upgrade to Pro",
  "hit your usage limit",
  "private-session-id",
  "private-thread-id",
  "private-turn-id",
  "credits_required",
  "out_of_credits",
  "canUserPurchaseCredits"
];

function assertClean(label, value, extra = []) {
  const serialized = JSON.stringify(value);
  for (const needle of [...PROVIDER_PRIVATE, ...extra])
    assert.equal(serialized.includes(needle), false, `${label} carries ${needle}`);
}

test("the Codex account checks and quota signals keep no account data or provider prose in any event", async () => {
  for (const [mode, rateLimits] of [
    ["structured", undefined],
    ["usage-limit", undefined],
    ["rate-limit-reached", undefined],
    ["success", JSON.stringify({ ordinaryUsageAllowed: false })],
    ["success", JSON.stringify({ rateLimits: { credits: { hasCredits: true, unlimited: false, balance: "9" } } })]
  ]) {
    const fixture = codexFixture({
      environment: {
        FAKE_CODEX_MODE: mode,
        ...(rateLimits === undefined ? {} : { FAKE_CODEX_RATE_LIMITS: rateLimits })
      },
      structuredOutput: { schema: SCHEMA, maxBytes: 4096 },
      subscriptionOnly: true
    });
    const events = [];
    const sent = [];
    const driver = new CodexDriver(
      fixture.dependencies({
        minimumVersion: undefined,
        probeEnvironment: { FAKE_CODEX_VERSION: CODEX_STRUCTURED_MINIMUM_VERSION },
        onMessageSent: (message) => sent.push(message)
      })
    );
    const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
    const closed = await driver.close(session);
    assertClean(`codex ${mode}`, { events, closed, session });
    // why: what the client sends back carries the thread it was given, which
    // is protocol, but never an account field it read.
    const echoed = JSON.stringify(sent);
    for (const needle of ["owner@example.invalid", "private-account-id", "upgrade-offer-text"])
      assert.equal(echoed.includes(needle), false, `codex ${mode} sent ${needle}`);
    for (const event of events.filter((entry) => entry.type === "quota.exhausted"))
      assert.deepEqual(
        Object.keys(event).filter((key) => !["type", "scope", "resetsAt", "sequence"].includes(key)),
        []
      );
  }
});

async function claudeThroughAdapter(scenario) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "verchestra-structured-security-")));
  roots.push(root);
  const worktree = join(root, "worktree");
  const isolationRoot = join(root, "isolation");
  await mkdir(join(worktree, "src"), { recursive: true });
  await mkdir(isolationRoot);
  const input = executorInput();
  const request = {
    workspaceId: input.workspaceId,
    runId: input.runId,
    task: { ...input.task, changeScope: ["src"], protectedPaths: [".git"] },
    worktreeRef: "worktree:security",
    contextRef: "context:security",
    checkpoint: undefined,
    capabilityGrantRefs: ["grant:writer:1"]
  };
  const checkpoints = [];
  const payloads = new InMemoryExecutionPayloadStore();
  const adapter = new DriverExecutionAdapter({
    resolveWorktree: async () => worktree,
    payloads,
    bridgeCommand: [process.execPath, relayEntry],
    createSession: async ({ worktreePath, bridge }) => ({
      model: "claude-sonnet-5",
      startRequest: mockRequest(),
      driver: new ClaudeCodeDriver({
        command: [process.execPath, fakeMediatedClaude],
        profile: { kind: "mediated-mcp-subscription", isolationRoot, managedPolicyPaths: [join(root, "no-policy")] },
        terminateTree: async (pid) => process.kill(pid),
        resolveExecution: async () => ({
          passport: {
            passportId: "passport_018f0000-0000-7000-8000-000000001504",
            revision: 1,
            provider: "anthropic",
            resolvedModel: "claude-sonnet-5"
          },
          prompt: `scenario:${scenario}`,
          model: "claude-sonnet-5",
          environment: { CLAUDE_CODE_OAUTH_TOKEN: TOKEN },
          sensitiveValues: [TOKEN],
          mediation: { cwd: worktreePath, bridge },
          structuredOutput: { schema: SCHEMA, maxBytes: 4096 }
        })
      })
    })
  });
  const control = {
    signal: undefined,
    checkpoint: async (stage, data) => {
      checkpoints.push({ stage, data });
      return `checkpoint:${checkpoints.length}`;
    },
    reportUsage: () => undefined,
    invokeTool: async () => ({ receiptRef: "receipt:1" })
  };
  const outcome = await adapter.execute(request, control).then(
    (result) => ({ result }),
    (error) => ({ error })
  );
  return { ...outcome, checkpoints, payloads, root };
}

test("a structured Claude session hands on only its canonical answer, with no token, session, or path", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { result, checkpoints, payloads, root } = await claudeThroughAdapter("structured");
  assert.equal(result.status, "completed");
  assert.equal(result.outputRefs.length, 1);
  const payload = Buffer.from(await payloads.get(result.outputRefs[0])).toString("utf8");
  assert.equal(payload, '{"outcome":"done","summary":"structured by the fake"}');
  assertClean("checkpoints, result, and payload", { checkpoints, result, payload }, [TOKEN, root, tmpdir()]);
  assert.equal(JSON.stringify(checkpoints).includes("structured by the fake"), false, "no answer text in a checkpoint");
});

test("a Claude quota refusal carries only its code, scope, and reset", async (t) => {
  if (WIN32_HOST) return windowsMediationPath(t);
  const { error, checkpoints, root } = await claudeThroughAdapter("rate-rejected");
  assert.equal(error.code, "VES_DRIVER_QUOTA_EXHAUSTED");
  assert.deepEqual(error.quota, { scope: "five_hour", resetsAt: "2026-09-21T14:13:20.000Z" });
  assertClean("quota refusal", { code: error.code, message: error.message, quota: error.quota, checkpoints }, [
    TOKEN,
    root,
    tmpdir()
  ]);
});
