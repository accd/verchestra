import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenCodeDriver } from "../../packages/drivers/src/opencode-driver.ts";
import { openCodeFixture } from "../helpers/opencode-driver-fixture.mjs";

test("OpenCode Driver probes exact SDK/server capabilities", async () => {
  const result = await new OpenCodeDriver(openCodeFixture().dependencies()).probe();
  assert.equal(result.available, true);
  assert.equal(result.version, "1.17.18");
  assert.deepEqual(result.capabilities, ["sdk-events", "model-discovery", "permission-mediation", "loopback-only"]);
});

test("OpenCode Driver blocks an unsupported version", async () => {
  const fixture = openCodeFixture();
  const result = await new OpenCodeDriver(
    fixture.dependencies({ probeEnvironment: { FAKE_OPENCODE_VERSION: "1.16.0" } })
  ).probe();
  assert.equal(result.available, false);
  assert.equal(result.error.code, "VES_OPENCODE_VERSION_UNSUPPORTED");
});

test("OpenCode Driver redacts unavailable CLI details", async () => {
  const fixture = openCodeFixture();
  const result = await new OpenCodeDriver(fixture.dependencies({ command: ["missing-verchestra-opencode"] })).probe();
  assert.deepEqual(result.error, { code: "VES_OPENCODE_NOT_AVAILABLE", message: "OpenCode is unavailable" });
});

test("OpenCode Driver discovers Qwen through generic provider/model identity", async () => {
  const result = await new OpenCodeDriver(openCodeFixture().dependencies()).discoverModels();
  assert.equal(
    result.models.some((model) => model.id === "company/qwen3-coder-480b" && model.connected),
    true
  );
});

test("OpenCode Driver discovery is not hard-coded to Qwen", async () => {
  const result = await new OpenCodeDriver(openCodeFixture().dependencies()).discoverModels();
  assert.deepEqual(
    result.models.map((model) => model.id),
    ["company/other-coder", "company/qwen3-coder-480b"]
  );
});

test("OpenCode Driver starts only isolated loopback ask-all servers", () => {
  const fixture = openCodeFixture();
  const options = new OpenCodeDriver(fixture.dependencies()).serverOptions({ EXPLICIT_QWEN_TOKEN: "bound" });
  assert.equal(options.hostname, "127.0.0.1");
  assert.equal(options.port, 0);
  assert.equal(options.config.share, "disabled");
  assert.equal(options.config.permission["*"], "ask");
  assert.equal(options.environment.EXPLICIT_QWEN_TOKEN, "bound");
});

test("OpenCode Driver emits common ordered Qwen lifecycle and reasoning usage", async () => {
  const fixture = openCodeFixture();
  const events = [];
  const driver = new OpenCodeDriver(fixture.dependencies());
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  assert.deepEqual(
    events.map((event) => event.type),
    ["session.started", "model.resolved", "content.delta", "usage.updated", "session.closed"]
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2, 3, 4]
  );
  assert.deepEqual(
    { input: events[3].inputTokens, output: events[3].outputTokens, reasoning: events[3].reasoningTokens },
    { input: 9, output: 5, reasoning: 2 }
  );
});

for (const [name, overrides] of [
  [
    "Passport revision",
    {
      passport: {
        passportId: "passport_018f0000-0000-7000-8000-000000001504",
        revision: 2,
        provider: "company",
        resolvedModel: "qwen3-coder-480b"
      }
    }
  ],
  ["provider/model identity", { model: "other/qwen3-coder-480b" }]
]) {
  test(`OpenCode Driver rejects mismatched ${name}`, async () => {
    const fixture = openCodeFixture(overrides);
    await assert.rejects(
      new OpenCodeDriver(fixture.dependencies()).start(fixture.request(), () => {}, new AbortController().signal),
      (error) => error.code === "VES_OPENCODE_IDENTITY_MISMATCH"
    );
    assert.equal(
      fixture.calls.some(([name]) => name === "server"),
      false
    );
  });
}

test("OpenCode Driver rejects a connected-catalog miss before session create", async () => {
  const fixture = openCodeFixture({
    passport: {
      passportId: "passport_018f0000-0000-7000-8000-000000001504",
      revision: 1,
      provider: "company",
      resolvedModel: "missing"
    },
    model: "company/missing"
  });
  const events = [];
  await new OpenCodeDriver(fixture.dependencies()).start(
    fixture.request(),
    (event) => events.push(event),
    new AbortController().signal
  );
  assert.equal(
    events.some((event) => event.type === "error" && event.code === "VES_OPENCODE_MODEL_UNAVAILABLE"),
    true
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "create"),
    false
  );
});

for (const [allowed, reply] of [
  [true, "once"],
  [false, "reject"]
]) {
  test(`OpenCode Driver mediates permission with ${reply}`, async () => {
    const tool = { name: "vestra_write", inputSchemaDigest: "sha256:" + "c".repeat(64) };
    const fixture = openCodeFixture({ tools: [tool], authorizeTool: async () => allowed }, "permission");
    const events = [];
    await new OpenCodeDriver(fixture.dependencies()).start(
      fixture.request({ tools: [tool] }),
      (event) => events.push(event),
      new AbortController().signal
    );
    assert.equal(
      events.some((event) => event.type === "tool.requested" && event.name === "vestra_write"),
      true
    );
    assert.equal(fixture.calls.find(([name]) => name === "permission")[1].reply, reply);
  });
}

test("OpenCode Driver rejects a built-in tool bypass before server start", async () => {
  const tool = { name: "bash", inputSchemaDigest: "sha256:" + "c".repeat(64) };
  const fixture = openCodeFixture({ tools: [tool] });
  await assert.rejects(
    new OpenCodeDriver(fixture.dependencies()).start(
      fixture.request({ tools: [tool] }),
      () => {},
      new AbortController().signal
    ),
    (error) => error.code === "VES_OPENCODE_TOOL_UNMEDIATED"
  );
  assert.equal(
    fixture.calls.some(([name]) => name === "server"),
    false
  );
});

for (const [mode, code] of [
  ["malformed", "VES_OPENCODE_STREAM_INVALID"],
  ["error", "VES_OPENCODE_EXECUTION_FAILED"],
  ["prompt-error", "VES_OPENCODE_PROTOCOL_FAILED"]
]) {
  test(`OpenCode Driver fails closed for ${mode}`, async () => {
    const fixture = openCodeFixture({}, mode);
    const events = [];
    await new OpenCodeDriver(fixture.dependencies()).start(
      fixture.request(),
      (event) => events.push(event),
      new AbortController().signal
    );
    assert.equal(
      events.some((event) => event.type === "error" && event.code === code),
      true
    );
  });
}

test("OpenCode Driver rejects pre-aborted start before probe or resolution", async () => {
  const fixture = openCodeFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new OpenCodeDriver(fixture.dependencies()).start(fixture.request(), () => {}, controller.signal),
    (error) => error.code === "VES_DRIVER_CANCELLED"
  );
  assert.equal(fixture.counters.resolve, 0);
});

test("OpenCode Driver rejects follow-up input for isolated sessions", async () => {
  await assert.rejects(
    new OpenCodeDriver(openCodeFixture().dependencies()).send(
      { sessionId: "any" },
      { type: "user.input", text: "next" }
    ),
    (error) => error.code === "VES_OPENCODE_SEND_UNSUPPORTED"
  );
});
