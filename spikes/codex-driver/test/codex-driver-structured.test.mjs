// invariant: requalification of the Codex driver for structured results, the
// account checks, quota signals, and the client method allowlist (T4 of the
// Strands subscription integration). The production CodexDriver runs against
// the DETERMINISTIC FAKE `codex app-server` (fake-codex-app-server.mjs). No
// model is invoked. The installed Codex is only asked for `--version` and, at
// or above the structured floor, to generate its App Server protocol into a
// disposable directory with a disposable HOME and CODEX_HOME, which reads no
// login and contacts no provider.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";

import {
  CODEX_CLIENT_METHODS,
  CODEX_STRUCTURED_MINIMUM_VERSION,
  CodexDriver
} from "../../../packages/drivers/src/index.ts";
import { codexFixture } from "../../../tests/helpers/codex-driver-fixture.mjs";
import { resolveCodexCommand } from "../src/codex-driver.mjs";

const execFileAsync = promisify(execFile);
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "summary"],
  properties: { outcome: { enum: ["done", "blocked"] }, summary: { type: "string", maxLength: 8192 } }
};
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function run(mode, execution, environment = {}) {
  const fixture = codexFixture({ environment: { FAKE_CODEX_MODE: mode, ...environment }, ...execution });
  const events = [];
  const driver = new CodexDriver(
    fixture.dependencies({ minimumVersion: undefined, probeEnvironment: { FAKE_CODEX_VERSION: CODEX_STRUCTURED_MINIMUM_VERSION } })
  );
  const session = await driver.start(fixture.request(), (event) => events.push(event), new AbortController().signal);
  await driver.close(session);
  return events.map(({ sequence, ...event }) => (event.type === "session.started" ? { type: event.type, sequence } : { ...event, sequence }));
}

const STARTED = [
  { type: "session.started", sequence: 0 },
  {
    type: "model.resolved",
    passportRef: { passportId: "passport_018f0000-0000-7000-8000-000000001504", revision: 1 },
    provider: "openai",
    resolvedModel: "gpt-5.5-codex",
    sequence: 1
  }
];

test("a structured subscription-only turn reports exactly its bounded result", async () => {
  assert.deepEqual(await run("structured", { structuredOutput: { schema: SCHEMA, maxBytes: 4096 }, subscriptionOnly: true }), [
    ...STARTED,
    { type: "content.delta", text: "working", sequence: 2 },
    { type: "usage.updated", inputTokens: 5, outputTokens: 3, sequence: 3 },
    { type: "result.structured", value: { outcome: "done", summary: "structured by the fake" }, bytes: 53, sequence: 4 },
    { type: "session.closed", outcome: "completed", sequence: 5 }
  ]);
});

test("each account refusal ends the session before its thread, with one stable code", async () => {
  for (const [environment, code, message] of [
    [{ FAKE_CODEX_ACCOUNT: JSON.stringify({ type: "apiKey" }) }, "VES_CODEX_AUTH_METHOD_MISMATCH", "Codex protocol failed"],
    [
      { FAKE_CODEX_RATE_LIMITS: JSON.stringify({ rateLimits: { credits: { hasCredits: true, unlimited: false, balance: "12.50" } } }) },
      "VES_CODEX_CREDITS_PRESENT",
      "Codex protocol failed"
    ]
  ])
    assert.deepEqual(await run("success", { subscriptionOnly: true }, environment), [
      { type: "error", code, message, retryable: false, sequence: 0 },
      { type: "session.closed", outcome: "failed", sequence: 1 }
    ]);
});

test("quota exhaustion before and during a turn is one event with only a scope and the reported reset", async () => {
  const before = JSON.stringify({
    ordinaryUsageAllowed: false,
    rateLimits: { credits: null, primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1_790_000_000 }, secondary: null }
  });
  assert.deepEqual(await run("success", { subscriptionOnly: true }, { FAKE_CODEX_RATE_LIMITS: before }), [
    { type: "quota.exhausted", scope: "ordinary_usage_disallowed", resetsAt: "2026-09-21T14:13:20.000Z", sequence: 0 },
    { type: "error", code: "VES_CODEX_QUOTA_EXHAUSTED", message: "Codex protocol failed", retryable: false, sequence: 1 },
    { type: "session.closed", outcome: "failed", sequence: 2 }
  ]);
  assert.deepEqual(await run("usage-limit", { subscriptionOnly: true }), [
    ...STARTED,
    { type: "quota.exhausted", scope: "usage_limit_exceeded", sequence: 2 },
    { type: "error", code: "VES_CODEX_EXECUTION_FAILED", message: "Codex failed", retryable: true, sequence: 3 },
    { type: "usage.updated", inputTokens: 1, outputTokens: 0, sequence: 4 },
    { type: "session.closed", outcome: "failed", sequence: 5 }
  ]);
});

// why: the installed Codex is run by its absolute path, never resolved by a
// spawn from PATH.
async function absolute(command) {
  if (isAbsolute(command)) return command;
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    const candidate = join(directory, command);
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  }
  return undefined;
}

async function installedCodex() {
  const [bare, ...prefix] = resolveCodexCommand();
  const command = await absolute(bare);
  if (command === undefined) return undefined;
  const stdout = await execFileAsync(command, [...prefix, "--version"], { encoding: "utf8", timeout: 20_000, windowsHide: true }).then(
    (result) => result.stdout,
    () => undefined
  );
  const version = stdout === undefined ? undefined : /(\d+)\.(\d+)\.(\d+)/u.exec(stdout)?.slice(1).join(".");
  return version === undefined ? undefined : { command, prefix, version };
}

const atLeast = (actual, minimum) => {
  const [left, right] = [actual, minimum].map((version) => version.split(".").map(Number));
  const index = left.findIndex((part, position) => part !== right[position]);
  return index === -1 || (index > 0 && left[0] === right[0] && left[index] > right[index]);
};

test("the structured floor compares every component and holds one major line", () => {
  assert.equal(atLeast("0.159.3", "0.159.3"), true);
  assert.equal(atLeast("0.160.0", "0.159.3"), true);
  assert.equal(atLeast("0.159.2", "0.159.3"), false);
  assert.equal(atLeast("0.115.0", "0.159.3"), false);
  assert.equal(atLeast("1.0.0", "0.159.3"), false);
});

// invariant: the fleet's exact pin (VES_REQUIRE_PINNED_PROVIDERS=1, #18 F4).
// The platform matrix installs Codex 0.115.0, below the structured floor, so a
// fleet run proves only the refusal below the floor, never the protocol at it.
// A fleet whose Codex is not this pin fails here, so the version a run proves
// is never a guess, and moving the pin means moving this constant with it.
const FLEET_CODEX = "0.115.0";
const PIN_REQUIRED = process.env.VES_REQUIRE_PINNED_PROVIDERS === "1";

// why: the evidence that the floor holds what the driver uses. A build at or
// above it generates a protocol with `outputSchema` on `turn/start`, the two
// account reads, the account kinds and quota signals the driver maps, and the
// credit methods its allowlist leaves out. Below it, a structured session is
// refused before spawn. Without Codex, not configured, never a pass.
test("the installed Codex at or above the floor generates every protocol element the driver relies on", async (t) => {
  const codex = await installedCodex();
  if (PIN_REQUIRED) assert.equal(codex?.version, FLEET_CODEX, `the fleet's Codex is not its pin ${FLEET_CODEX}`);
  if (codex === undefined) return t.diagnostic("Codex is not configured on this machine");
  t.diagnostic(`ran against Codex ${codex.version}; the structured floor is ${CODEX_STRUCTURED_MINIMUM_VERSION}`);
  if (!atLeast(codex.version, CODEX_STRUCTURED_MINIMUM_VERSION)) {
    const probe = await new CodexDriver({ command: [codex.command, ...codex.prefix], resolveExecution: async () => assert.fail("not reached") }).probe();
    assert.equal(probe.version, codex.version);
    return t.diagnostic(
      `Codex ${codex.version} is below ${CODEX_STRUCTURED_MINIMUM_VERSION}: this run proves only that its structured and subscription-only sessions are refused, not the protocol at the floor`
    );
  }
  const root = await mkdtemp(join(tmpdir(), "verchestra-codex-protocol-"));
  roots.push(root);
  const [home, codexHome, out] = ["home", "codex-home", "out"].map((name) => join(root, name));
  for (const directory of [home, codexHome]) await mkdir(directory, { mode: 0o700 });
  const environment = { HOME: home, USERPROFILE: home, CODEX_HOME: codexHome };
  for (const key of ["PATH", "SystemRoot", "ComSpec", "TEMP", "TMP"]) if (process.env[key] !== undefined) environment[key] = process.env[key];
  await execFileAsync(codex.command, [...codex.prefix, "app-server", "generate-ts", "--experimental", "--out", out], {
    cwd: home,
    env: environment,
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true
  });
  const read = (path) => readFile(join(out, ...path.split("/")), "utf8");
  assert.match(await read("v2/TurnStartParams.ts"), /\boutputSchema\?: JsonValue \| null/u);
  const requests = await read("ClientRequest.ts");
  for (const method of CODEX_CLIENT_METHODS.filter((name) => name !== "initialized"))
    assert.ok(requests.includes(`"method": "${method}"`), `the protocol lacks ${method}`);
  for (const method of ["account/rateLimitResetCredit/consume", "account/sendAddCreditsNudgeEmail"])
    assert.ok(requests.includes(`"method": "${method}"`), `${method} exists, so the allowlist must leave it out`);
  assert.match(await read("v2/Account.ts"), /"type": "chatgpt"/u);
  assert.match(await read("v2/CodexErrorInfo.ts"), /"usageLimitExceeded"/u);
  assert.match(await read("v2/GetAccountRateLimitsResponse.ts"), /ordinaryUsageAllowed: boolean \| null/u);
  assert.match(await read("v2/CreditsSnapshot.ts"), /hasCredits: boolean, unlimited: boolean, balance: string \| null/u);
  const reached = await read("v2/RateLimitReachedType.ts");
  for (const kind of ["workspace_owner_credits_depleted", "workspace_member_credits_depleted", "workspace_owner_usage_limit_reached", "workspace_member_usage_limit_reached"])
    assert.ok(reached.includes(`"${kind}"`), kind);
  assert.match(await read("ServerNotification.ts"), /"method": "account\/rateLimits\/updated"/u);
  assert.match(await read("v2/ThreadItem.ts"), /"type": "agentMessage", id: string, text: string/u);
  assert.deepEqual(await readdir(home), [], "the generation wrote nothing to HOME");
});
