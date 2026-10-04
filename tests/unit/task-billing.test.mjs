// invariant: decisions D3, D3b, and D9 (SSI-51..53). A coordinated run needs
// every provider on a subscription and the owner's machine-local statement
// that paid usage beyond the plan is off, naming the provider, its
// authentication method, and (for Codex) its plan type, made under the
// current billing regime. Anything else is `not configured`, before anything
// is read beyond the two settings, and the statement can hold no secret,
// account identifier, e-mail address, name, or path.
import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import {
  BILLING_FILE,
  BILLING_METHODS,
  BILLING_REGIMES,
  billingProviders,
  normalizeExtraUsageConfirmations,
  requireSubscriptionPreflight,
  subscriptionPreconditions
} from "../../apps/vestra-cli/src/task/task-billing.ts";
import { normalizeTaskRequest } from "../../packages/application/src/index.ts";
import { CONFIRMED_AT, extraUsageConfirmation } from "../helpers/task-billing-fixture.mjs";
import { validTaskRequestV2 } from "../helpers/task-request-fixture.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const NOW = new Date("2026-10-04T12:00:00.000Z");
const PROVIDERS = Object.freeze(["claude-code", "codex"]);
const SUBSCRIPTIONS = Object.freeze({ implementer: "subscription", verifier: "subscription" });

const confirmation = extraUsageConfirmation;

function refusedAs(requirement) {
  return (error) => {
    assert.equal(error?.envelope?.code, "VES_TASK_NOT_CONFIGURED", String(error?.message));
    assert.deepEqual(error.envelope.safeDetails, { requirement });
    return true;
  };
}

const refused = refusedAs("extra-usage-confirmation");

test("each provider's statement names the method its session proves, under a pinned regime", () => {
  assert.equal(BILLING_FILE, "task-billing.json");
  assert.deepEqual({ ...BILLING_METHODS }, { "claude-code": "subscription", codex: "chatgpt" });
  assert.deepEqual(
    { ...BILLING_REGIMES },
    { "claude-code": "2026-06-16T00:00:00.000Z", codex: "2026-10-03T00:00:00.000Z" }
  );
});

test("a complete statement for both providers is read as exactly what it states", () => {
  const stated = confirmation();
  stated.providers["claude-code"].confirmedAt = "2026-10-04T09:00:00Z";
  const read = normalizeExtraUsageConfirmations(stated, PROVIDERS, NOW);
  assert.deepEqual(
    read.map((entry) => ({ ...entry })),
    [
      { provider: "claude-code", auth: "subscription", confirmedAt: "2026-10-04T09:00:00Z" },
      { provider: "codex", auth: "chatgpt", planType: "plus", confirmedAt: CONFIRMED_AT }
    ]
  );
  assert.equal(Object.isFrozen(read), true);
  assert.equal(Object.isFrozen(read[0]), true);
});

test("a run uses every node's provider and the Codex verifier", () => {
  for (const mode of ["agent", "graph", "swarm"])
    assert.deepEqual(billingProviders(normalizeTaskRequest(validTaskRequestV2(mode))), PROVIDERS, mode);
});

const CLAUDE = confirmation().providers["claude-code"];
const CODEX = confirmation().providers.codex;

for (const [label, value] of [
  ["a statement that is not an object", []],
  ["another schema version", { ...confirmation(), schemaVersion: 2 }],
  ["a member beside the providers", { ...confirmation(), owner: "someone" }],
  ["an unknown provider", confirmation({ gemini: CLAUDE })],
  ["no entry for Codex", { schemaVersion: 1, providers: { "claude-code": CLAUDE } }],
  ["no entry for Claude Code", { schemaVersion: 1, providers: { codex: CODEX } }],
  ["Claude Code on an API key", confirmation({ "claude-code": { ...CLAUDE, auth: "api-key" } })],
  [
    "Codex on the subscription word instead of its ChatGPT method",
    confirmation({ codex: { ...CODEX, auth: "subscription" } })
  ],
  ["Codex on an API key", confirmation({ codex: { ...CODEX, auth: "apiKey" } })],
  ["extra usage left enabled", confirmation({ codex: { ...CODEX, extraUsage: "enabled" } })],
  [
    "extra usage not stated",
    confirmation({ "claude-code": { auth: "subscription", confirmedAt: CLAUDE.confirmedAt } })
  ],
  ["a Codex statement without its plan type", confirmation({ codex: { ...CODEX, planType: undefined } })],
  [
    "a plan type that is free text",
    confirmation({ codex: { ...CODEX, planType: "Plus plan for owner@example.invalid" } })
  ],
  ["a plan type on Claude Code", confirmation({ "claude-code": { ...CLAUDE, planType: "max" } })],
  ["a local time", confirmation({ codex: { ...CODEX, confirmedAt: "2026-10-04 09:00" } })],
  ["an impossible time", confirmation({ codex: { ...CODEX, confirmedAt: "2026-13-45T09:00:00Z" } })],
  ["a statement dated in the future", confirmation({ codex: { ...CODEX, confirmedAt: "2026-10-05T00:00:00Z" } })],
  [
    "a Claude Code statement made before the current regime",
    confirmation({ "claude-code": { ...CLAUDE, confirmedAt: "2026-06-15T23:59:59Z" } })
  ],
  [
    "a Codex statement made before the current regime",
    confirmation({ codex: { ...CODEX, confirmedAt: "2026-10-02T12:00:00Z" } })
  ]
])
  test(`${label} is not configured`, () => {
    assert.throws(() => normalizeExtraUsageConfirmations(value, PROVIDERS, NOW), refused);
  });

// invariant: SSI-53. No member a secret, an account, a person, or a path could
// travel in is accepted, at either level.
for (const member of ["token", "accountId", "email", "name", "path", "apiKey"]) {
  test(`a statement holding ${member} is refused`, () => {
    assert.throws(
      () => normalizeExtraUsageConfirmations(confirmation({ codex: { ...CODEX, [member]: "x" } }), PROVIDERS, NOW),
      refused
    );
    assert.throws(
      () => normalizeExtraUsageConfirmations({ ...confirmation(), [member]: "x" }, PROVIDERS, NOW),
      refused
    );
  });
}

test("a statement exactly at its regime's start is accepted", () => {
  const atStart = confirmation({
    "claude-code": { ...CLAUDE, confirmedAt: BILLING_REGIMES["claude-code"] },
    codex: { ...CODEX, confirmedAt: BILLING_REGIMES.codex }
  });
  assert.equal(normalizeExtraUsageConfirmations(atStart, PROVIDERS, NOW).length, 2);
});

async function preflight(t, setting, options = {}) {
  const root = await temporaryDirectory(t, "vestra-billing-");
  if (typeof setting === "string") await writeFile(join(root, BILLING_FILE), setting);
  else if (setting !== undefined) await writeFile(join(root, BILLING_FILE), JSON.stringify(setting));
  const lines = [];
  const run = () =>
    requireSubscriptionPreflight({
      workspaceRoot: root,
      auth: options.auth ?? SUBSCRIPTIONS,
      request: normalizeTaskRequest(validTaskRequestV2(options.mode ?? "graph")),
      stderr: (line) => lines.push(line),
      now: () => NOW
    });
  return { root, lines, run };
}

test("the preflight passes a run on subscriptions with a complete statement and says nothing", async (t) => {
  const { lines, run } = await preflight(t, confirmation());
  await run();
  assert.deepEqual(lines, []);
});

for (const [label, auth] of [
  ["Claude Code", { implementer: "api-key", verifier: "subscription" }],
  ["Codex", { implementer: "subscription", verifier: "api-key" }]
])
  test(`the preflight refuses a run whose ${label} provider is on an API key, whatever the statement says`, async (t) => {
    const { run } = await preflight(t, confirmation(), { auth });
    await assert.rejects(run(), refusedAs("coordinated-run-subscription"));
  });

for (const [label, setting] of [
  ["no statement", undefined],
  ["text that is not JSON", "{not json"],
  ["a statement for another method", confirmation({ codex: { ...CODEX, auth: "subscription" } })]
])
  test(`the preflight refuses ${label} and tells the owner the one step that provisions it`, async (t) => {
    const { root, lines, run } = await preflight(t, setting);
    await assert.rejects(run(), refused);
    const told = lines.join("");
    assert.match(told, /paid usage beyond your plan is turned off/u);
    assert.ok(told.includes(join(root, BILLING_FILE)), "the file to write is named on the terminal");
    assert.match(told, /"codex": \{ "auth": "chatgpt", "planType": "<your ChatGPT plan, e\.g\. plus>"/u);
    assert.match(told, /"claude-code": \{ "auth": "subscription", "extraUsage": "disabled"/u);
  });

test("the preflight never follows a link or reads a directory in the statement's place", async (t) => {
  const elsewhere = await temporaryDirectory(t, "vestra-billing-target-");
  await writeFile(join(elsewhere, "real.json"), JSON.stringify(confirmation()));
  const linked = await preflight(t, undefined);
  await symlink(join(elsewhere, "real.json"), join(linked.root, BILLING_FILE));
  await assert.rejects(linked.run(), refused);
  const directory = await preflight(t, undefined);
  await mkdir(join(directory.root, BILLING_FILE));
  await assert.rejects(directory.run(), refused);
});

// invariant: SSI-30. What `plan` shows of the preconditions: the method each
// provider of the run must prove and its statement must name, the file that
// holds the statement, and the requirement the preflight of `start` would
// refuse now, or `ready`. It reports and refuses nothing, and says nothing on
// the terminal: `start` and `resume` run the preflight again.
async function preconditions(t, setting, options = {}) {
  const { root, lines } = await preflight(t, setting, options);
  const shown = await subscriptionPreconditions({
    workspaceRoot: root,
    auth: options.auth ?? SUBSCRIPTIONS,
    request: normalizeTaskRequest(validTaskRequestV2(options.mode ?? "graph")),
    now: () => NOW
  });
  assert.deepEqual(lines, [], "plan explained the preflight on the terminal");
  return shown;
}

test("plan shows each provider's method, the statement file, and a preflight that is ready", async (t) => {
  assert.deepEqual(await preconditions(t, confirmation()), {
    auth: { "claude-code": "subscription", codex: "chatgpt" },
    extraUsage: "disabled",
    statement: "task-billing.json",
    preflight: "ready"
  });
});

for (const [label, setting, requirement, auth] of [
  ["no statement", undefined, "extra-usage-confirmation"],
  ["text that is not JSON", "{not json", "extra-usage-confirmation"],
  [
    "a statement made before Codex's regime",
    confirmation({ codex: { ...CODEX, confirmedAt: "2026-10-02T12:00:00Z" } }),
    "extra-usage-confirmation"
  ],
  [
    "a provider on an API key",
    confirmation(),
    "coordinated-run-subscription",
    { implementer: "subscription", verifier: "api-key" }
  ]
])
  test(`plan shows the requirement start would refuse with ${label}, without refusing itself`, async (t) => {
    const shown = await preconditions(t, setting, { auth });
    assert.equal(shown.preflight, requirement);
    assert.deepEqual(shown.auth, { "claude-code": "subscription", codex: "chatgpt" });
  });
