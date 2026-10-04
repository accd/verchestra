// invariant: the structured-result, account, quota, and method-allowlist
// interface of the Codex driver (T4 of the Strands subscription integration;
// SSI-46, SSI-48, SSI-55..58). The production CodexDriver runs against the
// labeled DETERMINISTIC FAKE `codex app-server` (fake-codex-app-server.mjs),
// whose messages follow the protocol 0.159.3 generates. No model is invoked.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CODEX_CLIENT_METHODS,
  CODEX_PLAN_TYPES,
  CODEX_STRUCTURED_MINIMUM_VERSION,
  CodexDriver,
  codexWireFrame
} from "../../packages/drivers/src/codex-driver.ts";
import { codexFixture } from "../helpers/codex-driver-fixture.mjs";

const SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: { outcome: { enum: ["done", "blocked"] }, summary: { type: "string", maxLength: 8192 } }
});
// why: the canonical form the driver sends, members in RFC 8785 order.
const CANONICAL_SCHEMA = {
  additionalProperties: false,
  properties: { outcome: { enum: ["done", "blocked"] }, summary: { maxLength: 8192, type: "string" } },
  required: ["outcome", "summary"],
  type: "object"
};
const DENIED = [
  "account/rateLimitResetCredit/consume",
  "account/sendAddCreditsNudgeEmail",
  "account/login/start",
  "account/login/cancel",
  "account/logout",
  "account/usage/read",
  "command/exec",
  "fs/writeFile"
];
const types = (events) => events.map((event) => (event.type === "error" ? `error:${event.code}` : event.type));

// why: a session on the build that has the new protocol, unless a case names
// another; the fake reports the version the probe environment spells.
async function run({
  mode = "success",
  execution = {},
  version = CODEX_STRUCTURED_MINIMUM_VERSION,
  environment = {}
} = {}) {
  const fixture = codexFixture({ environment: { FAKE_CODEX_MODE: mode, ...environment }, ...execution });
  const sent = [];
  const events = [];
  const accounts = [];
  const driver = new CodexDriver(
    fixture.dependencies({
      minimumVersion: undefined,
      probeEnvironment: { FAKE_CODEX_VERSION: version },
      onMessageSent: (message) => sent.push(message),
      onAccount: (account) => accounts.push(account)
    })
  );
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  const closed = await driver.close(session);
  return {
    events,
    closed,
    sent,
    methods: sent.filter((message) => message.method).map((message) => message.method),
    accounts,
    fixture
  };
}

const structured = (maxBytes = 4096) => ({ structuredOutput: { schema: SCHEMA, maxBytes } });

test("the client allowlist names exactly the methods a session sends, and no credit or login method", () => {
  assert.deepEqual(CODEX_CLIENT_METHODS, [
    "initialize",
    "initialized",
    "account/read",
    "account/rateLimits/read",
    "model/list",
    "thread/start",
    "turn/start",
    "turn/interrupt"
  ]);
  assert.equal(Object.isFrozen(CODEX_CLIENT_METHODS), true);
  for (const method of DENIED) assert.equal(CODEX_CLIENT_METHODS.includes(method), false, method);
  assert.equal(
    CODEX_CLIENT_METHODS.some((method) => /credit|login|logout|nudge/iu.test(method)),
    false
  );
});

test("a frame naming a method outside the allowlist is refused, and a response frame passes", () => {
  for (const method of [...DENIED, "", 5, null, "Initialize"])
    assert.throws(
      () => codexWireFrame({ method, id: 9, params: {} }),
      { code: "VES_CODEX_METHOD_DENIED" },
      String(method)
    );
  for (const method of CODEX_CLIENT_METHODS)
    assert.equal(codexWireFrame({ method, id: 1, params: {} }), JSON.stringify({ method, id: 1, params: {} }));
  assert.equal(
    codexWireFrame({ id: 60, result: { decision: "decline" } }),
    '{"id":60,"result":{"decision":"decline"}}'
  );
});

test("every message a session sends, in every mode the fake plays, is on the allowlist", async () => {
  for (const [mode, execution] of [
    ["success", {}],
    ["structured", { ...structured(), subscriptionOnly: true }],
    ["usage-limit", { subscriptionOnly: true }],
    ["rate-limit-reached", { subscriptionOnly: true }],
    ["command-approval", {}]
  ]) {
    const { methods } = await run({ mode, execution });
    assert.ok(methods.length >= 5, mode);
    for (const method of methods) assert.ok(CODEX_CLIENT_METHODS.includes(method), `${mode} sent ${method}`);
  }
});

test("a session that asks for neither keeps the T04 conversation", async () => {
  const { methods, events } = await run({ version: "0.115.0" });
  assert.deepEqual(methods, ["initialize", "initialized", "model/list", "thread/start", "turn/start"]);
  assert.deepEqual(types(events), [
    "session.started",
    "model.resolved",
    "content.delta",
    "usage.updated",
    "session.closed"
  ]);
});

test("a structured turn carries the canonical schema and its final agent message becomes the bounded result", async () => {
  for (const mode of ["structured", "structured-commentary"]) {
    const { events, closed, sent } = await run({ mode, execution: structured() });
    const turnStart = sent.find((message) => message.method === "turn/start");
    assert.deepEqual(turnStart.params.outputSchema, CANONICAL_SCHEMA, mode);
    assert.deepEqual(Object.keys(turnStart.params.outputSchema), Object.keys(CANONICAL_SCHEMA), mode);
    const result = events.find((event) => event.type === "result.structured");
    assert.deepEqual(result.value, { outcome: "done", summary: "structured by the fake" }, mode);
    // {"outcome":"done","summary":"structured by the fake"} is 53 bytes.
    assert.equal(result.bytes, 53);
    assert.deepEqual(types(events).slice(-3), ["usage.updated", "result.structured", "session.closed"], mode);
    assert.equal(closed.outcome, "completed", mode);
  }
  const plain = await run({ mode: "structured" });
  assert.equal(
    Object.hasOwn(plain.sent.find((message) => message.method === "turn/start").params, "outputSchema"),
    false
  );
  assert.equal(
    plain.events.some((event) => event.type === "result.structured"),
    false
  );
});

test("a structured turn without a readable answer, or with one beyond its bound, fails with a stable code", async () => {
  for (const [mode, maxBytes, code] of [
    ["structured-missing", 4096, "VES_CODEX_STRUCTURED_OUTPUT_MISSING"],
    ["structured-invalid", 4096, "VES_CODEX_STRUCTURED_OUTPUT_INVALID"],
    ["structured-large", 4096, "VES_CODEX_STRUCTURED_OUTPUT_LIMIT"],
    ["structured", 52, "VES_CODEX_STRUCTURED_OUTPUT_LIMIT"]
  ]) {
    const { events, closed } = await run({ mode, execution: structured(maxBytes) });
    assert.deepEqual(types(events).slice(-3), ["usage.updated", `error:${code}`, "session.closed"], mode);
    assert.equal(closed.outcome, "failed", mode);
    assert.equal(
      events.some((event) => event.type === "result.structured"),
      false,
      mode
    );
  }
  const exact = await run({ mode: "structured", execution: structured(53) });
  assert.equal(exact.events.find((event) => event.type === "result.structured").bytes, 53);
});

test("a session that uses the new protocol is refused before spawn below its floor, and the T04 floor is unchanged", async () => {
  for (const execution of [structured(), { subscriptionOnly: true }, { accountOnly: true }]) {
    const fixture = codexFixture({ ...execution });
    const driver = new CodexDriver(
      fixture.dependencies({ minimumVersion: undefined, probeEnvironment: { FAKE_CODEX_VERSION: "0.159.2" } })
    );
    await assert.rejects(
      driver.start(fixture.request(), () => {}, new AbortController().signal),
      {
        code: "VES_CODEX_VERSION_UNSUPPORTED"
      }
    );
    assert.equal(fixture.calls.spawn, 0);
  }
  assert.equal(CODEX_STRUCTURED_MINIMUM_VERSION, "0.159.3");
  const older = await run({ version: "0.115.0" });
  assert.equal(older.closed.outcome, "completed");
});

test("a malformed structured or subscription request is refused before spawn", async () => {
  for (const [execution, code] of [
    [{ structuredOutput: { schema: SCHEMA } }, "VES_CODEX_OUTPUT_SCHEMA_INVALID"],
    [{ structuredOutput: { schema: SCHEMA, maxBytes: 0 } }, "VES_CODEX_OUTPUT_SCHEMA_INVALID"],
    [{ structuredOutput: { schema: "{}", maxBytes: 64 } }, "VES_CODEX_OUTPUT_SCHEMA_INVALID"],
    [{ subscriptionOnly: false }, "VES_CODEX_SUBSCRIPTION_INVALID"],
    [{ subscriptionOnly: "yes" }, "VES_CODEX_SUBSCRIPTION_INVALID"],
    [{ accountOnly: false }, "VES_CODEX_SUBSCRIPTION_INVALID"],
    [{ accountOnly: true, subscriptionOnly: true }, "VES_CODEX_SUBSCRIPTION_INVALID"],
    [{ accountOnly: true, structuredOutput: { schema: SCHEMA, maxBytes: 64 } }, "VES_CODEX_SUBSCRIPTION_INVALID"]
  ]) {
    const fixture = codexFixture({ ...execution });
    const driver = new CodexDriver(
      fixture.dependencies({ minimumVersion: undefined, probeEnvironment: { FAKE_CODEX_VERSION: "0.159.3" } })
    );
    await assert.rejects(
      driver.start(fixture.request(), () => {}, new AbortController().signal),
      { code },
      JSON.stringify(execution)
    );
    assert.equal(fixture.calls.spawn, 0);
  }
});

test("a subscription-only session reads its account and rate limits before anything else", async () => {
  const { methods, sent, closed } = await run({ execution: { subscriptionOnly: true } });
  assert.deepEqual(methods, [
    "initialize",
    "initialized",
    "account/read",
    "account/rateLimits/read",
    "model/list",
    "thread/start",
    "turn/start"
  ]);
  assert.deepEqual(sent.find((message) => message.method === "account/read").params, { refreshToken: false });
  assert.equal(closed.outcome, "completed");
});

// invariant: SSI-52. A session that reads the account reports its plan type as
// one value of the 0.159.3 vocabulary, or `unknown`, and nothing else of the
// account; an account-only session reads the account and ends there.
test("an account-only session reads the account, reports its plan type, and asks for nothing more", async () => {
  const { methods, events, closed, accounts } = await run({ execution: { accountOnly: true } });
  assert.deepEqual(methods, ["initialize", "initialized", "account/read"]);
  assert.deepEqual(accounts, [{ planType: "plus" }]);
  assert.equal(Object.isFrozen(accounts[0]), true);
  assert.deepEqual(types(events), ["session.closed"]);
  assert.equal(closed.outcome, "completed");
  const subscription = await run({ execution: { subscriptionOnly: true } });
  assert.deepEqual(subscription.accounts, [{ planType: "plus" }], "a subscription-only session reports it too");
  assert.deepEqual((await run()).accounts, [], "the T04 conversation reads no account");
});

test("the plan type is reported as a closed value, and a value outside the vocabulary as unknown", async () => {
  const account = (planType) =>
    JSON.stringify({
      type: "chatgpt",
      email: "owner@example.invalid",
      ...(planType === undefined ? {} : { planType })
    });
  for (const [planType, reported] of [
    ["pro", "pro"],
    ["self_serve_business_usage_based", "self_serve_business_usage_based"],
    ["unknown", "unknown"],
    ["Plus plan for owner@example.invalid", "unknown"],
    ["PLUS", "unknown"],
    [7, "unknown"],
    [undefined, "unknown"]
  ]) {
    const { accounts, closed } = await run({
      execution: { accountOnly: true },
      environment: { FAKE_CODEX_ACCOUNT: account(planType) }
    });
    assert.deepEqual(accounts, [{ planType: reported }], String(planType));
    assert.equal(closed.outcome, "completed", String(planType));
  }
  assert.equal(Object.isFrozen(CODEX_PLAN_TYPES), true);
  assert.equal(CODEX_PLAN_TYPES.includes("unknown"), false);
  assert.equal(CODEX_PLAN_TYPES.length, 17);
});

test("an account-only session refuses an account that is not a ChatGPT login and reports no plan type", async () => {
  for (const account of [{ type: "apiKey" }, null]) {
    const { events, methods, closed, accounts } = await run({
      execution: { accountOnly: true },
      environment: { FAKE_CODEX_ACCOUNT: JSON.stringify(account) }
    });
    assert.deepEqual(types(events), ["error:VES_CODEX_AUTH_METHOD_MISMATCH", "session.closed"]);
    assert.deepEqual(methods, ["initialize", "initialized", "account/read"]);
    assert.deepEqual(accounts, []);
    assert.equal(closed.outcome, "failed");
  }
});

test("a subscription-only session refuses an account that is not a ChatGPT login before its thread", async () => {
  for (const account of [{ type: "apiKey" }, { type: "amazonBedrock", usesCodexManagedCredentials: true }, null]) {
    const { events, methods, closed } = await run({
      execution: { subscriptionOnly: true },
      environment: { FAKE_CODEX_ACCOUNT: JSON.stringify(account) }
    });
    assert.deepEqual(
      types(events),
      ["error:VES_CODEX_AUTH_METHOD_MISMATCH", "session.closed"],
      JSON.stringify(account)
    );
    assert.equal(methods.includes("thread/start"), false);
    assert.equal(methods.includes("turn/start"), false);
    assert.equal(closed.outcome, "failed");
  }
});

test("a subscription-only session refuses an account that reports credits", async () => {
  const credits = (value) => JSON.stringify({ rateLimits: { credits: value, primary: null, secondary: null } });
  for (const environment of [
    { FAKE_CODEX_RATE_LIMITS: credits({ hasCredits: true, unlimited: false, balance: "0" }) },
    { FAKE_CODEX_RATE_LIMITS: credits({ hasCredits: false, unlimited: true, balance: null }) },
    { FAKE_CODEX_RATE_LIMITS: credits({ hasCredits: false, unlimited: false, balance: "5.00" }) },
    { FAKE_CODEX_RATE_LIMITS: credits("unexpected") },
    {
      FAKE_CODEX_RATE_LIMITS: JSON.stringify({
        rateLimitsByLimitId: { codex_other: { credits: { hasCredits: true, unlimited: false, balance: "1" } } }
      })
    }
  ]) {
    const { events, methods } = await run({ execution: { subscriptionOnly: true }, environment });
    assert.deepEqual(
      types(events),
      ["error:VES_CODEX_CREDITS_PRESENT", "session.closed"],
      environment.FAKE_CODEX_RATE_LIMITS
    );
    assert.equal(methods.includes("turn/start"), false);
  }
  for (const value of [
    { hasCredits: false, unlimited: false, balance: "0.00" },
    { hasCredits: false, unlimited: false, balance: null },
    null
  ]) {
    const { closed } = await run({
      execution: { subscriptionOnly: true },
      environment: { FAKE_CODEX_RATE_LIMITS: credits(value) }
    });
    assert.equal(closed.outcome, "completed", JSON.stringify(value));
  }
});

test("ordinary usage refused before the turn is quota exhaustion, and no turn starts", async () => {
  const exhausted = JSON.stringify({
    ordinaryUsageAllowed: false,
    rateLimits: {
      credits: null,
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_790_000_000 },
      secondary: { usedPercent: 100, windowDurationMins: 10_080, resetsAt: 1_790_500_000 }
    }
  });
  const { events, methods } = await run({
    execution: { subscriptionOnly: true },
    environment: { FAKE_CODEX_RATE_LIMITS: exhausted }
  });
  assert.deepEqual(types(events), ["quota.exhausted", "error:VES_CODEX_QUOTA_EXHAUSTED", "session.closed"]);
  const { sequence, ...quota } = events[0];
  assert.equal(sequence, 0);
  // why: the latest reset among the fully used windows: 1_790_500_000 s.
  assert.deepEqual(quota, {
    type: "quota.exhausted",
    scope: "ordinary_usage_disallowed",
    resetsAt: "2026-09-27T09:06:40.000Z"
  });
  assert.equal(methods.includes("turn/start"), false);
  const unknown = await run({
    execution: { subscriptionOnly: true },
    environment: { FAKE_CODEX_RATE_LIMITS: JSON.stringify({ ordinaryUsageAllowed: null }) }
  });
  assert.equal(unknown.closed.outcome, "completed", "an unavailable answer is not a refusal");
});

test("a usage limit during the turn is reported once as quota exhaustion before the failure", async () => {
  const { events, closed } = await run({ mode: "usage-limit", execution: { subscriptionOnly: true } });
  assert.deepEqual(types(events), [
    "session.started",
    "model.resolved",
    "quota.exhausted",
    "error:VES_CODEX_EXECUTION_FAILED",
    "usage.updated",
    "session.closed"
  ]);
  const { sequence, ...quota } = events[2];
  assert.equal(sequence, 2);
  assert.deepEqual(quota, { type: "quota.exhausted", scope: "usage_limit_exceeded" });
  assert.equal(closed.outcome, "failed");
});

test("an exhausted allowance reported during the turn is one quota event, and a transient rate limit is none", async () => {
  const { events, closed } = await run({ mode: "rate-limit-reached" });
  assert.deepEqual(
    events.filter((event) => event.type === "quota.exhausted"),
    [
      {
        type: "quota.exhausted",
        scope: "workspace_member_usage_limit_reached",
        resetsAt: "2026-09-21T14:13:20.000Z",
        sequence: 2
      }
    ]
  );
  assert.equal(
    closed.outcome,
    "completed",
    "the driver reports the signal; stopping the session is its caller's decision"
  );
});
