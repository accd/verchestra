// invariant: #405's governed task journeys, end to end through the real
// `vestra` binary as a child process. The implementer and verifier are the
// DETERMINISTIC FAKE `claude` and `codex` executables in
// tests/helpers/task-cli-fakes, run through per-fixture wrappers first on PATH;
// credentials come from the fake keychain preload
// (tests/helpers/fake-keychain-spawn.mjs, layered on the deny guard); the gate
// is a real process run through the machine-local allowlist. No provider is
// contacted and no product code carries a test hook.
//
// The journeys run in the default credential mode, subscription (ADP-A): the
// Claude Code token from the keychain and the Codex login in the Workspace
// identity directory. The API-key mode has its own journeys below.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { rm, writeFile, mkdir, symlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  CREDENTIALS,
  DARWIN,
  MODE_CREDENTIALS,
  approveArguments,
  cleanupTaskFixtures,
  taskFixture
} from "../helpers/task-cli-fixture.mjs";
import {
  IMPLEMENTER,
  IMPLEMENTER_TOKENS,
  VERIFIER,
  VERIFIER_TOKENS,
  priced
} from "../helpers/verifier-usage-fixture.mjs";

after(cleanupTaskFixtures);

const TIMEOUT = { timeout: 300_000 };
// why: a run's reported usage is the implementer's and the verifier's. The
// fake implementer reports 11 input and 7 output tokens in one usage event and
// the fake verifier 5 and 3 in one, so a run that verifies once has spent
// 18 + 8 = 26 tokens in 2 events. These journeys pinned 18 while the
// verifier's usage was metered against the ceilings and never recorded.
const RUN_TOKENS = IMPLEMENTER_TOKENS + VERIFIER_TOKENS;
const RUN_USAGE_EVENTS = 2;

function ok(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr}\n${result.stdout}`);
  return result.json.data;
}

function refused(result, code, label) {
  assert.notEqual(result.status, 0, `${label} unexpectedly succeeded`);
  assert.equal(result.json?.error?.code, code, `${label}: ${result.stdout}${result.stderr}`);
  return result.json.error;
}

// why: the resume and cancel journeys both need a run whose driving process
// died while its gate was held.
async function killedAtHeldGate(fixture, plan) {
  await writeFile(join(fixture.home, "hold-gate"), "");
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = exited(child);
  await waitFor(() => existsSync(join(fixture.home, "gate-held")));
  const gatePid = Number(readFileSync(join(fixture.home, "gate-held"), "utf8"));
  child.kill("SIGKILL");
  const exit = await finished;
  process.kill(-gatePid, "SIGKILL");
  await rm(join(fixture.home, "hold-gate"));
  return exit;
}

async function planned(fixture) {
  const plan = ok(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan"
  );
  return plan;
}

async function approved(fixture) {
  const plan = await planned(fixture);
  ok(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  return plan;
}

function startArguments(fixture, runId, verb = "start") {
  return ["task", verb, "--run-id", runId, ...fixture.keychainArgs, "--output", "json"];
}

function start(fixture, runId, verb = "start") {
  return fixture.launch(startArguments(fixture, runId, verb));
}

function status(fixture, runId) {
  return ok(fixture.launch(["task", "status", "--run-id", runId, "--output", "json"]), "status");
}

function checkout(fixture) {
  return {
    head: fixture.git(["rev-parse", "HEAD"]),
    status: fixture.git(["status", "--porcelain=v1", "--untracked-files=all"]),
    value: readFileSync(join(fixture.repository, "src", "value.txt"), "utf8"),
    worktrees: fixture.git(["worktree", "list", "--porcelain"])
  };
}

function logLines(fixture, name) {
  const path = join(fixture.scratch, name);
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

// why: the sealed Run Capsule is the evidence a reviewer keeps; its budget
// block is read back from the run directory, never from command output.
function capsuleBudget(fixture, runId) {
  const directory = join(fixture.stateRoot, "tasks", runId, "capsules");
  const files = readdirSync(directory, { recursive: true }).filter((name) => String(name).endsWith(".json"));
  assert.equal(files.length, 1, "one capsule is sealed");
  const envelope = JSON.parse(readFileSync(join(directory, String(files[0])), "utf8"));
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  assert.ok(statement.predicate.content.budgetEvidence !== undefined, "the capsule carries budget evidence");
  return statement.predicate.content.budgetEvidence;
}

function receiptCount(fixture) {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
  const database = new DatabaseSync(join(fixture.stateRoot, "runtime", "runtime.sqlite"), { readOnly: true });
  try {
    return Number(database.prepare("SELECT count(*) AS count FROM operation_receipts").get().count);
  } finally {
    database.close();
  }
}

function review(fixture, runId, outcome, digest, input = `${digest}\n`, confirm = true) {
  return fixture.launch(
    [
      "task",
      "review",
      "--run-id",
      runId,
      "--outcome",
      outcome,
      "--surface-digest",
      digest,
      ...(confirm ? ["--confirm-stdin"] : []),
      ...fixture.keychainArgs,
      "--output",
      "json"
    ],
    input
  );
}

async function waitFor(predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("condition was not reached in time");
}

function exited(child) {
  return new Promise((resolve) => child.once("close", (code, signal) => resolve({ code, signal })));
}

// invariant: the fixture's environment carries no session bus, so on Linux the
// Secret Service is unreachable and must be reported as a store that is not
// configured; on Windows the credential is simply unbound. Either way the
// refusal comes before any task state exists.
test(
  "off macOS the task path reports its missing platform or credential store as not configured before any effect",
  TIMEOUT,
  async (t) => {
    if (DARWIN) return t.diagnostic("macOS runs the full journeys below");
    const fixture = await taskFixture();
    const plan = fixture.launch(["task", "plan", "--request", fixture.requestPath, "--output", "json"]);
    const error = refused(plan, "VES_TASK_NOT_CONFIGURED", "plan");
    assert.equal(error.safeDetails.requirement, process.platform === "win32" ? "platform" : "credential-store");
    assert.equal(existsSync(join(fixture.stateRoot, "tasks")), false);
  }
);

test("a governed task is planned, approved, implemented, gated, verified, and accepted", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  const before = checkout(fixture);
  const plan = await planned(fixture);
  assert.equal(plan.state, "AWAITING_EXECUTION_APPROVAL");
  assert.match(plan.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(plan.review.scope, ["path:src"]);
  assert.deepEqual(plan.review.destinations, ["provider:anthropic", "provider:openai"]);
  assert.deepEqual(plan.providerAuth, { "claude-code": "subscription", codex: "subscription" });

  // A wrong digest, a missing confirmation, and a mistyped one are refused
  // before anything is recorded.
  const mismatch = fixture.launch([
    "task",
    "approve",
    "--run-id",
    plan.runId,
    "--binding-digest",
    `sha256:${"0".repeat(64)}`,
    "--output",
    "json"
  ]);
  refused(mismatch, "VES_TASK_BINDING_MISMATCH", "binding mismatch");
  refused(
    fixture.launch([
      "task",
      "approve",
      "--run-id",
      plan.runId,
      "--binding-digest",
      plan.bindingDigest,
      "--output",
      "json"
    ]),
    "VES_TASK_CONFIRMATION_REQUIRED",
    "unconfirmed"
  );
  refused(
    fixture.launch(
      [
        "task",
        "approve",
        "--run-id",
        plan.runId,
        "--binding-digest",
        plan.bindingDigest,
        "--confirm-stdin",
        "--output",
        "json"
      ],
      "sha256:typo\n"
    ),
    "VES_TASK_CONFIRMATION_REQUIRED",
    "mistyped"
  );
  assert.equal(status(fixture, plan.runId).state, "AWAITING_EXECUTION_APPROVAL");
  refused(start(fixture, plan.runId), "VES_TASK_TRANSITION_REFUSED", "start before approval");

  const approval = ok(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  assert.equal(approval.state, "EXECUTION_AUTHORIZED");

  const run = ok(start(fixture, plan.runId), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  assert.equal(run.branch, `vestra/${plan.runId}/T1`);
  const inReview = status(fixture, plan.runId);
  assert.equal(inReview.surfaceDigest, run.surfaceDigest);
  assert.equal(inReview.evidence.verificationVerdict, "PASS");
  assert.deepEqual(inReview.checkpoints.toolReceipts, 1);

  // invariant: the implementer saw only its brokered subscription token, never
  // bare, in an isolated home and an empty directory that is not the worktree; the
  // verifier ran read-only with no tools from the Workspace's Codex identity
  // directory, with no API key. No API key is bound in this fixture at all.
  const [claude] = logLines(fixture, "fake-claude.log");
  assert.equal(claude.bare, false);
  assert.equal(claude.credentialVariable, "CLAUDE_CODE_OAUTH_TOKEN");
  assert.equal(claude.credentialMatchesStore, true);
  assert.notEqual(claude.home, fixture.home);
  assert.match(claude.cwd, /\/sessions\/verchestra-claude-[^/]+\/workspace$/u);
  assert.equal(claude.workingDirectoryEntries, 0);
  for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE"])
    assert.equal(claude.environmentKeys.includes(key), false, key);
  const [codex] = logLines(fixture, "fake-codex.log");
  assert.equal(codex.sandbox, "read-only");
  assert.equal(codex.tools, 0);
  assert.equal(codex.login, "chatgpt");
  assert.equal(codex.codexHome, fixture.codexIdentity);
  assert.equal(codex.config, 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n');
  assert.notEqual(codex.home, fixture.home);
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"])
    assert.equal(codex.environmentKeys.includes(key), false, key);
  // invariant: nothing is billed per token on a subscription. The ceilings
  // were metered, and the cost is reported as not billed, never as dollars.
  // why: 26 tokens, not 18: the implementer's 11 + 7 and the verifier's 5 + 3.
  assert.equal(inReview.checkpoints.budget.consumedCostUsd, "not billed (subscription)");
  assert.equal(inReview.checkpoints.budget.billing, "subscription");
  assert.equal(RUN_TOKENS, 26);
  assert.equal(inReview.checkpoints.budget.consumedTokens, RUN_TOKENS);
  assert.equal(inReview.checkpoints.budget.unbilledTokens, RUN_TOKENS);
  assert.equal(inReview.checkpoints.budget.usageEvents, RUN_USAGE_EVENTS);
  assert.equal(inReview.checkpoints.budget.stopReason, null);

  refused(review(fixture, plan.runId, "accepted", `sha256:${"1".repeat(64)}`), "VES_TASK_SURFACE_MISMATCH", "stale");
  refused(
    review(fixture, plan.runId, "accepted", run.surfaceDigest, "", false),
    "VES_TASK_CONFIRMATION_REQUIRED",
    "unconfirmed review"
  );
  const accepted = ok(review(fixture, plan.runId, "accepted", run.surfaceDigest), "review");
  assert.equal(accepted.state, "COMPLETED");
  assert.match(accepted.capsuleId, /^[a-f0-9]{64}$/u);
  assert.match(accepted.merge, /never merges/u);

  const branch = `vestra/${plan.runId}/T1`;
  assert.equal(fixture.git(["show", `${branch}:src/value.txt`]), "new");
  assert.equal(fixture.git(["rev-parse", `${branch}^`]), fixture.revision);
  assert.deepEqual(fixture.git(["diff", "--name-only", fixture.revision, branch]).split("\n"), ["src/value.txt"]);
  assert.match(fixture.git(["show", "-s", "--format=%B", branch]), new RegExp(`Verchestra-Run: ${plan.runId}`, "u"));
  // Zero changes to the user's checkout: same HEAD, same status, same files,
  // and no worktree left registered.
  assert.deepEqual(checkout(fixture), before);
  const done = status(fixture, plan.runId);
  assert.equal(done.state, "COMPLETED");
  assert.equal(done.capsuleId, accepted.capsuleId);
  assert.deepEqual(done.next, []);
  // invariant: the Run Capsule seals the ledger `status` printed: the run's
  // 26 tokens in 2 events, and the time the whole run took, verification
  // included.
  const budget = capsuleBudget(fixture, plan.runId);
  assert.equal(budget.billing, "subscription");
  assert.equal(Object.hasOwn(budget.consumed, "costUsd"), false);
  assert.equal(budget.consumed.unbilledTokens, budget.consumed.tokens);
  assert.equal(budget.consumed.tokens, RUN_TOKENS);
  assert.equal(budget.consumed.usageEvents, RUN_USAGE_EVENTS);
  assert.equal(budget.consumed.durationMs, inReview.checkpoints.budget.consumedDurationMs);
  assert.equal(budget.stopReason, null);
  refused(start(fixture, plan.runId), "VES_TASK_TRANSITION_REFUSED", "restart a completed run");
});

test("a write outside the change scope is denied while in-scope work is committed", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ request: { instructions: "Set the value. scenario:outside" } });
  const plan = await approved(fixture);
  const run = ok(start(fixture, plan.runId), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  const results = logLines(fixture, "fake-claude.log").find((entry) => entry.results !== undefined).results;
  const outside = results.find((entry) => entry.path === "docs/outside.txt");
  assert.equal(outside.isError, true);
  assert.match(outside.text, /VES_EXECUTOR_SCOPE_DENIED/u);
  assert.deepEqual(fixture.git(["diff", "--name-only", fixture.revision, run.branch]).split("\n"), ["src/value.txt"]);
  assert.equal(existsSync(join(fixture.repository, "docs")), false);
  assert.equal(receiptCount(fixture), 1);
});

test("a Workspace forbid policy denies the start before any worktree or provider call", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  await mkdir(join(fixture.repository, ".verchestra", "policy"), { recursive: true });
  await writeFile(
    join(fixture.repository, ".verchestra", "policy", "task-authority.json"),
    JSON.stringify({
      schemaVersion: 1,
      forbid: {
        noMediumRiskStart:
          'forbid(principal, action == Vestra::Action::"task-start", resource) when { context.risk == "medium" };'
      }
    })
  );
  const plan = await approved(fixture);
  const run = start(fixture, plan.runId);
  assert.equal(run.status, 1);
  assert.equal(run.json.data.state, "FAILED");
  assert.equal(run.json.data.reason, "VES_EXECUTOR_APPROVAL_INVALID");
  assert.deepEqual(logLines(fixture, "fake-claude.log"), []);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "");
});

// why: every missing-credential case ends the same way, with nothing started.
function assertNothingStarted(fixture, runId) {
  const after = status(fixture, runId);
  assert.equal(after.state, "EXECUTION_AUTHORIZED");
  assert.equal(after.checkpoints.executor, "none");
  assert.equal(after.evidence.grantId, null);
  assert.deepEqual(logLines(fixture, "fake-claude.log"), []);
  assert.deepEqual(logLines(fixture, "fake-codex.log"), []);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
}

// invariant: the API keys are bound here and the token is not. A subscription
// run names the token it needs and never falls back to a key that is present.
test("a missing credential is not configured before any transition, worktree, or provider call", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ credentials: MODE_CREDENTIALS["api-key"] });
  const plan = await approved(fixture);
  const error = refused(start(fixture, plan.runId), "VES_TASK_NOT_CONFIGURED", "start");
  assert.equal(error.safeDetails.requirement, "claude-code-oauth-token");
  assertNothingStarted(fixture, plan.runId);
  assert.deepEqual(logLines(fixture, "fake-codex-status.log"), []);
});

test("in API-key mode a missing API key is not configured before any effect", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { "anthropic-api-key": omitted, ...rest } = CREDENTIALS;
  assert.ok(omitted);
  const fixture = await taskFixture({ mode: "api-key", credentials: rest });
  const plan = await approved(fixture);
  const error = refused(start(fixture, plan.runId), "VES_TASK_NOT_CONFIGURED", "start");
  assert.equal(error.safeDetails.requirement, "anthropic-api-key");
  assertNothingStarted(fixture, plan.runId);
  const { "openai-api-key": verifierKey, ...withoutVerifier } = MODE_CREDENTIALS["api-key"];
  assert.ok(verifierKey);
  const second = await taskFixture({ mode: "api-key", credentials: withoutVerifier });
  const secondPlan = await approved(second);
  assert.equal(
    refused(start(second, secondPlan.runId), "VES_TASK_NOT_CONFIGURED", "start").safeDetails.requirement,
    "openai-api-key"
  );
  assertNothingStarted(second, secondPlan.runId);
});

test("in API-key mode a task runs bare with the two keys and reports a dollar cost", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ mode: "api-key" });
  const plan = await approved(fixture);
  assert.deepEqual(plan.providerAuth, { "claude-code": "api-key", codex: "api-key" });
  const run = ok(start(fixture, plan.runId), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  // invariant: the implementer saw only its brokered API key, bare, in the
  // worktree; the verifier ran with its own key and a per-session CODEX_HOME.
  // The Workspace identity directory was never created and no token was needed.
  const [claude] = logLines(fixture, "fake-claude.log");
  assert.equal(claude.bare, true);
  assert.equal(claude.credentialVariable, "ANTHROPIC_API_KEY");
  assert.equal(claude.credentialMatchesStore, true);
  assert.notEqual(claude.home, fixture.home);
  assert.match(claude.cwd, /\/worktrees\//u);
  for (const key of ["CLAUDE_CODE_OAUTH_TOKEN", "OPENAI_API_KEY", "VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE"])
    assert.equal(claude.environmentKeys.includes(key), false, key);
  const [codex] = logLines(fixture, "fake-codex.log");
  assert.equal(codex.sandbox, "read-only");
  assert.equal(codex.tools, 0);
  assert.equal(codex.credentialMatchesStore, true);
  assert.ok(codex.codexHome.startsWith(fixture.stateRoot));
  assert.notEqual(codex.codexHome, fixture.codexIdentity);
  assert.equal(codex.environmentKeys.includes("ANTHROPIC_API_KEY"), false);
  assert.equal(existsSync(fixture.codexIdentity), false);
  assert.deepEqual(logLines(fixture, "fake-codex-status.log"), []);
  // invariant: the cost is the price table's for both providers' usage: the
  // implementer's 11 + 7 tokens at its model's rates plus the verifier's 5 + 3
  // at its own.
  const budget = status(fixture, plan.runId).checkpoints.budget;
  assert.equal(budget.consumedCostUsd, priced(IMPLEMENTER) + priced(VERIFIER));
  assert.ok(budget.consumedCostUsd > priced(IMPLEMENTER), "the verifier's usage was not priced");
  assert.equal(budget.consumedTokens, RUN_TOKENS);
  assert.equal(budget.usageEvents, RUN_USAGE_EVENTS);
  assert.equal(Object.hasOwn(budget, "billing"), false);
  assert.equal(Object.hasOwn(budget, "unbilledTokens"), false);
  ok(review(fixture, plan.runId, "accepted", run.surfaceDigest), "review");
  const sealed = capsuleBudget(fixture, plan.runId);
  assert.equal(Object.hasOwn(sealed, "billing"), false);
  assert.equal(sealed.consumed.costUsd, budget.consumedCostUsd);
  assert.equal(sealed.consumed.tokens, RUN_TOKENS);
});

test(
  "a Codex login that is missing is not configured, and the one-time command unblocks the same run",
  TIMEOUT,
  async () => {
    if (!DARWIN) return;
    const fixture = await taskFixture({ codexLogin: null });
    const plan = await approved(fixture);
    const refusedStart = start(fixture, plan.runId);
    assert.equal(refused(refusedStart, "VES_TASK_NOT_CONFIGURED", "start").safeDetails.requirement, "codex-login");
    assert.equal(refusedStart.stdout.includes(fixture.codexIdentity), false, "no machine path in the public error");
    assert.match(
      refusedStart.stderr,
      new RegExp(
        `Run once:\\n  CODEX_HOME='${fixture.codexIdentity.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")}' codex login\\n`,
        "u"
      )
    );
    assertNothingStarted(fixture, plan.runId);
    const [checked] = logLines(fixture, "fake-codex-status.log");
    assert.equal(checked.login, "none");
    assert.equal(checked.codexHome, fixture.codexIdentity);
    assert.notEqual(checked.home, fixture.home);
    // why: the owner runs the printed command once; the fixture stands in for it.
    await fixture.codexLogin("chatgpt");
    assert.equal(ok(start(fixture, plan.runId), "start after login").state, "HUMAN_REVIEW");
  }
);

test("an API-key Codex login cannot stand in for the subscription", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ codexLogin: "api-key" });
  const plan = await approved(fixture);
  assert.equal(
    refused(start(fixture, plan.runId), "VES_TASK_NOT_CONFIGURED", "start").safeDetails.requirement,
    "codex-login"
  );
  assertNothingStarted(fixture, plan.runId);
});

test("a malformed provider setting is not configured at plan time and at start", TIMEOUT, async () => {
  if (!DARWIN) return;
  const broken = await taskFixture({ providers: "{not json" });
  const plan = broken.launch([
    "task",
    "plan",
    "--request",
    broken.requestPath,
    ...broken.keychainArgs,
    "--output",
    "json"
  ]);
  assert.equal(refused(plan, "VES_TASK_NOT_CONFIGURED", "plan").safeDetails.requirement, "provider-auth");
  assert.equal(existsSync(join(broken.stateRoot, "tasks")), false);
  for (const providers of [
    { schemaVersion: 1, providers: { "claude-code": { auth: "ambient" } } },
    { schemaVersion: 1, providers: { gemini: { auth: "subscription" } } },
    { schemaVersion: 2, providers: {} }
  ]) {
    const fixture = await taskFixture();
    const approvedPlan = await approved(fixture);
    await writeFile(fixture.providersPath, JSON.stringify(providers));
    const error = refused(start(fixture, approvedPlan.runId), "VES_TASK_NOT_CONFIGURED", "start");
    assert.equal(error.safeDetails.requirement, "provider-auth");
    assertNothingStarted(fixture, approvedPlan.runId);
  }
});

test("one provider on a subscription and the other on a key is metered as mixed", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({
    providers: { schemaVersion: 1, providers: { codex: { auth: "api-key" } } },
    credentials: { ...MODE_CREDENTIALS.subscription, "openai-api-key": CREDENTIALS["openai-api-key"] },
    codexLogin: null
  });
  const plan = await approved(fixture);
  const run = ok(start(fixture, plan.runId), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  assert.equal(logLines(fixture, "fake-claude.log")[0].credentialVariable, "CLAUDE_CODE_OAUTH_TOKEN");
  const [codex] = logLines(fixture, "fake-codex.log");
  assert.equal(codex.credentialMatchesStore, true);
  assert.notEqual(codex.codexHome, fixture.codexIdentity);
  // invariant: the run ledger holds both providers' usage. The implementer's
  // 18 tokens are unbilled and the verifier's 8 are priced by the table, so the
  // run is metered as mixed and its cost is the verifier's alone.
  // why: this journey asserted `not billed (subscription)` while the verifier's
  // billed usage was left out of the ledger.
  const budget = status(fixture, plan.runId).checkpoints.budget;
  assert.equal(budget.billing, "mixed");
  assert.equal(budget.consumedTokens, RUN_TOKENS);
  assert.equal(budget.unbilledTokens, IMPLEMENTER_TOKENS);
  assert.equal(budget.consumedCostUsd, priced(VERIFIER));
  ok(review(fixture, plan.runId, "accepted", run.surfaceDigest), "review");
  const sealed = capsuleBudget(fixture, plan.runId);
  assert.equal(sealed.billing, "mixed");
  assert.equal(sealed.consumed.costUsd, priced(VERIFIER));
  assert.equal(sealed.consumed.tokens, RUN_TOKENS);
  assert.equal(sealed.consumed.unbilledTokens, IMPLEMENTER_TOKENS);
  assert.equal(sealed.consumed.usageEvents, RUN_USAGE_EVENTS);
});

test("an exhausted budget stops the implementer and fails the run as a budget outcome", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ request: { instructions: "Spend. scenario:budget" } });
  const plan = await approved(fixture);
  const run = start(fixture, plan.runId);
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.json.data.state, "FAILED");
  assert.equal(run.json.data.reason, "VES_EXECUTOR_BUDGET_EXCEEDED");
  const after = status(fixture, plan.runId);
  assert.equal(after.checkpoints.repair, "budget-exceeded");
  assert.notEqual(after.checkpoints.budget.stopReason, null);
  assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "");
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
});

test("cancel stops a running task from another process and aborts the run", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ request: { instructions: "Work slowly. scenario:slow" } });
  const plan = await approved(fixture);
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = exited(child);
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  await waitFor(() => logLines(fixture, "fake-claude.log").some((entry) => entry.results !== undefined));
  assert.equal(status(fixture, plan.runId).activeProcess, true);
  // One writer per Workspace: a second approved run is refused before its
  // first transition while this one holds the writer lease.
  const second = await approved(fixture);
  refused(start(fixture, second.runId), "VES_TASK_RUN_ACTIVE", "second writer");
  assert.equal(status(fixture, second.runId).state, "EXECUTION_AUTHORIZED");
  const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
  assert.equal(cancelled.stopped, true);
  const exit = await finished;
  assert.equal(exit.code, 1);
  assert.equal(JSON.parse(stdout).data.status, "ABORTED");
  const after = status(fixture, plan.runId);
  assert.equal(after.state, "ABORTED");
  assert.equal(after.activeProcess, false);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  refused(
    fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]),
    "VES_TASK_TRANSITION_REFUSED",
    "again"
  );
});

test("an interrupted run resumes at its gate without repeating the implementer's effects", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  assert.equal((await killedAtHeldGate(fixture, plan)).signal, "SIGKILL");

  const interrupted = status(fixture, plan.runId);
  assert.equal(interrupted.state, "IMPLEMENTING");
  assert.equal(interrupted.activeProcess, false);
  assert.equal(interrupted.checkpoints.executor, "awaiting-gate");
  assert.equal(receiptCount(fixture), 1);
  // invariant: the implementer's usage was recorded when it was reported, on a
  // repair state with no attempt yet: the attempt was killed at its gate.
  assert.equal(interrupted.checkpoints.repair, "repair");
  assert.equal(interrupted.checkpoints.budget.consumedTokens, IMPLEMENTER_TOKENS);
  assert.equal(interrupted.checkpoints.budget.usageEvents, 1);
  refused(start(fixture, plan.runId), "VES_TASK_TRANSITION_REFUSED", "start an interrupted run");

  const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
  assert.equal(resumed.state, "HUMAN_REVIEW");
  assert.equal(logLines(fixture, "fake-claude.log").filter((entry) => entry.scenario !== undefined).length, 1);
  assert.equal(receiptCount(fixture), 1);
  assert.equal(fixture.git(["show", `${resumed.branch}:src/value.txt`]), "new");
  // why: the implementer ran once, before the kill, and the verifier once,
  // after the resume: 18 + 8 = 26 tokens in 2 events. This run reported 8 in
  // 1 event while the killed attempt's usage was never recorded.
  const budget = status(fixture, plan.runId).checkpoints.budget;
  assert.equal(budget.consumedTokens, RUN_TOKENS);
  assert.equal(budget.unbilledTokens, RUN_TOKENS);
  assert.equal(budget.usageEvents, RUN_USAGE_EVENTS);
  refused(start(fixture, plan.runId, "resume"), "VES_TASK_TRANSITION_REFUSED", "resume a run in review");
});

// invariant: usage is recorded when it arrives, wherever the attempt then is.
// Here the implementer has reported its usage and its process is still open,
// so the attempt has not reached its gate when the run is killed. `status`
// reports that usage, and the resumed run, which has no finished attempt to
// resume and runs the implementer again, adds the second session to it.
test(
  "a run killed after its implementer reported usage keeps it, and resume adds the new session",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture();
    await writeFile(join(fixture.scratch, "linger-implementer"), "");
    const plan = await approved(fixture);
    const child = fixture.launchAsync(startArguments(fixture, plan.runId));
    const finished = exited(child);
    const lingering = () =>
      logLines(fixture, "fake-claude.log").find((entry) => entry.lingering !== undefined)?.lingering;
    // hazard: a case that fails before the kill would leave the command and
    // the lingering fake alive.
    t.after(() => {
      child.kill("SIGKILL");
      if (lingering() !== undefined && running(lingering())) process.kill(lingering(), "SIGKILL");
    });
    await waitFor(() => lingering() !== undefined);
    await waitFor(() => status(fixture, plan.runId).checkpoints.budget !== null);
    child.kill("SIGKILL");
    assert.equal((await finished).signal, "SIGKILL");
    process.kill(lingering(), "SIGKILL");
    await rm(join(fixture.scratch, "linger-implementer"));

    const interrupted = status(fixture, plan.runId);
    assert.equal(interrupted.state, "IMPLEMENTING");
    assert.equal(interrupted.activeProcess, false);
    assert.notEqual(interrupted.checkpoints.executor, "awaiting-gate", "the attempt had reached its gate");
    assert.equal(interrupted.checkpoints.repair, "repair");
    assert.equal(interrupted.checkpoints.budget.consumedTokens, IMPLEMENTER_TOKENS);
    assert.equal(interrupted.checkpoints.budget.usageEvents, 1);

    const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
    assert.equal(resumed.state, "HUMAN_REVIEW");
    assert.equal(logLines(fixture, "fake-claude.log").filter((entry) => entry.scenario !== undefined).length, 2);
    // why: two implementer sessions reported usage and one verifier session:
    // 18 + 18 + 8 = 44 tokens in 3 events. 26 would have lost the killed
    // session's usage.
    const budget = status(fixture, plan.runId).checkpoints.budget;
    assert.equal(budget.consumedTokens, 2 * IMPLEMENTER_TOKENS + VERIFIER_TOKENS);
    assert.equal(budget.consumedTokens, 44);
    assert.equal(budget.unbilledTokens, 44);
    assert.equal(budget.usageEvents, 3);
    assert.equal(status(fixture, plan.runId).checkpoints.repair, "converged");
  }
);

test("a malformed state file fails closed before any effect", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  const path = join(fixture.stateRoot, "tasks", plan.runId, "plan.json");
  const text = readFileSync(path, "utf8");
  await writeFile(path, text.replace('"risk":"medium"', '"risk":"low"'));
  refused(
    fixture.launch(["task", "status", "--run-id", plan.runId, "--output", "json"]),
    "VES_TASK_STATE_INVALID",
    "status"
  );
  const error = refused(start(fixture, plan.runId), "VES_TASK_STATE_INVALID", "start");
  assert.equal(error.safeDetails.reason, "VES_TASK_STATE_TAMPERED");
  await writeFile(path, "{not json");
  refused(start(fixture, plan.runId), "VES_TASK_STATE_INVALID", "start");
  assert.deepEqual(logLines(fixture, "fake-claude.log"), []);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
});

test("a rejected review aborts the run and keeps the task branch for inspection", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  const run = ok(start(fixture, plan.runId), "start");
  const rejected = ok(review(fixture, plan.runId, "rejected", run.surfaceDigest), "review");
  assert.equal(rejected.state, "ABORTED");
  assert.equal(fixture.git(["show", `${run.branch}:src/value.txt`]), "new");
  assert.equal(readFileSync(join(fixture.repository, "src", "value.txt"), "utf8"), "old\n");
  const after = status(fixture, plan.runId);
  assert.equal(after.state, "ABORTED");
  assert.equal(after.evidence.reviewOutcome, "rejected");
});

test("cancel with no process driving the run removes its worktree, frees the lease, and aborts", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  await killedAtHeldGate(fixture, plan);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 2);

  const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
  assert.equal(cancelled.state, "ABORTED");
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "");
  // The writer lease the dead process held is released: a new run can start.
  const next = await approved(fixture);
  assert.equal(ok(start(fixture, next.runId), "next start").state, "HUMAN_REVIEW");
});

// invariant: nothing on the task path assumes a 40-digit object ID. In a
// SHA-256 repository an idle cancel removes the worktree it reports stopped,
// and a second run is implemented, gated, committed, verified through a
// scratch checkout, and accepted into a sealed Run Capsule.
test("a SHA-256 repository is cancelled when idle and delivered through acceptance", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ objectFormat: "sha256" });
  assert.match(fixture.revision, /^[a-f0-9]{64}$/u);
  const before = checkout(fixture);
  const plan = await approved(fixture);
  await killedAtHeldGate(fixture, plan);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 2);

  const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
  assert.equal(cancelled.state, "ABORTED");
  assert.equal(cancelled.stopped, true);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "");

  const next = await approved(fixture);
  const run = ok(start(fixture, next.runId), "start");
  assert.equal(run.state, "HUMAN_REVIEW");
  assert.match(run.commitId, /^[a-f0-9]{64}$/u);
  const inReview = status(fixture, next.runId);
  assert.equal(inReview.evidence.verificationVerdict, "PASS");
  assert.equal(inReview.evidence.commitId, run.commitId);
  const accepted = ok(review(fixture, next.runId, "accepted", run.surfaceDigest), "review");
  assert.equal(accepted.state, "COMPLETED");
  assert.match(accepted.capsuleId, /^[a-f0-9]{64}$/u);
  assert.equal(fixture.git(["rev-parse", run.branch]), run.commitId);
  assert.equal(fixture.git(["rev-parse", `${run.branch}^`]), fixture.revision);
  assert.equal(fixture.git(["show", `${run.branch}:src/value.txt`]), "new");
  assert.deepEqual(checkout(fixture), before);
});

function stateListing(fixture) {
  return readdirSync(fixture.stateRoot, { recursive: true })
    .map(String)
    .sort((left, right) => Number(left > right) - Number(left < right));
}

function dryRunArguments(fixture) {
  return ["task", "plan", "--request", fixture.requestPath, "--dry-run", "--output", "json"];
}

// invariant: a dry run prints the surface a real plan would bind and writes
// nothing: no Run record, no runtime store, no evidence key. It reads no
// credential, so it runs wherever the task path is not refused outright.
test("a dry run prints the plan surface and leaves the Workspace state as it was", TIMEOUT, async (t) => {
  if (process.platform === "win32") return t.diagnostic("the task path is refused on Windows");
  const fixture = await taskFixture();
  const before = stateListing(fixture);
  const plan = ok(fixture.launch(dryRunArguments(fixture)), "dry run");
  assert.equal(plan.dryRun, true);
  assert.equal(plan.state, "NOT_PERSISTED");
  assert.match(plan.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(stateListing(fixture), before);
  for (const name of ["tasks", "runtime", "keys", "verification"])
    assert.equal(existsSync(join(fixture.stateRoot, name)), false, `${name} was created by a dry run`);
});

// invariant: a task state root that is a link out of the Workspace state root
// stops every task command with a stable public code, and nothing is written
// through the link.
test(
  "a task state root that links out of the Workspace is refused with nothing written through it",
  TIMEOUT,
  async (t) => {
    if (process.platform === "win32") return t.diagnostic("the task path is refused on Windows");
    for (const name of ["tasks", "keys", "verification"]) {
      const fixture = await taskFixture();
      const outside = join(fixture.root, "outside-state");
      await mkdir(outside);
      await symlink(outside, join(fixture.stateRoot, name));
      const error = refused(fixture.launch(dryRunArguments(fixture)), "VES_STATE_ROOT_ESCAPE", `dry run with ${name}`);
      assert.deepEqual(error.safeDetails, {});
      refused(
        fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
        "VES_STATE_ROOT_ESCAPE",
        `plan with ${name}`
      );
      assert.deepEqual(readdirSync(outside), [], `${name} was written through the link`);
    }
  }
);

// invariant: stopping a provider stops everything it started (ADP-4). The
// fake implementer forks one process that stays in its process group and holds
// its output open, and one that leaves the group with setsid(); `vestra task
// cancel` ends the run with all three gone. Signal 0 only asks whether a
// process exists, and every process named here was started by this fixture.
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH" || error.code === "EPERM") return false;
    throw error;
  }
}

test("cancel kills everything the implementer started, including a process that left its group", TIMEOUT, async (t) => {
  if (!DARWIN) return notConfiguredOffMacOS(t);
  const fixture = await taskFixture({ request: { instructions: "Start helpers and never answer. scenario:fork" } });
  const plan = await approved(fixture);
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = exited(child);
  const forked = () => logLines(fixture, "fake-claude.log").find((entry) => entry.tree !== undefined)?.tree;
  // hazard: a case that fails before the cancel would leave the run and the
  // fake's processes alive.
  t.after(() => {
    child.kill("SIGKILL");
    for (const pid of Object.values(forked() ?? {})) if (running(pid)) process.kill(pid, "SIGKILL");
  });
  await waitFor(() => forked() !== undefined);
  const tree = forked();
  for (const [name, pid] of Object.entries(tree))
    assert.equal(running(pid), true, `${name} was running before the cancel`);
  const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
  assert.equal(cancelled.stopped, true);
  assert.equal((await finished).code, 1);
  assert.equal(status(fixture, plan.runId).state, "ABORTED");
  for (const [name, pid] of Object.entries(tree)) {
    await waitFor(() => !running(pid), 10_000).catch(() => undefined);
    assert.equal(running(pid), false, `${name} outlived the cancel`);
  }
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
});

// invariant: off macOS these journeys cannot run, and each of them asserts why
// instead of passing without an assertion: on Windows every task command is
// refused for the platform, and on Linux the fixture has no credential store.
function notConfiguredOffMacOS(t) {
  t.diagnostic("off macOS: asserting that the task path reports not configured before any effect");
  return taskFixture().then((fixture) => {
    const plan = fixture.launch(["task", "plan", "--request", fixture.requestPath, "--output", "json"]);
    const error = refused(plan, "VES_TASK_NOT_CONFIGURED", "plan");
    assert.equal(error.safeDetails.requirement, process.platform === "win32" ? "platform" : "credential-store");
    assert.equal(existsSync(join(fixture.stateRoot, "tasks")), false);
  });
}

// invariant: a hang-up or a termination request while a provider runs (ADP-4).
// The provider leads a process group of its own, so the terminal's signals no
// longer reach it. `vestra` stops every provider tree it started and then ends
// as the signal would have ended it. It records nothing: no abort, no cancel
// marker, no outcome. The run is left as a killed command leaves it, and
// `task resume` completes it. The `fork-implementer` and `fork-verifier` flags
// make the fake provider fork one process into its group and one out of it and
// never answer; removing the flag lets the resumed run finish.
const INTERRUPTED_PROVIDERS = [
  {
    provider: "the implementer",
    flag: "fork-implementer",
    state: "IMPLEMENTING",
    // why: Claude Code reports usage when its session ends. A session that was
    // stopped before that reported none, so there is nothing to record.
    recorded: null,
    tree: (fixture) => logLines(fixture, "fake-claude.log").find((entry) => entry.tree !== undefined)?.tree
  },
  {
    provider: "the verifier",
    flag: "fork-verifier",
    state: "VERIFYING",
    // why: the implementer's usage; the stopped verifier had reported none.
    recorded: IMPLEMENTER_TOKENS,
    tree: (fixture) => {
      const turn = logLines(fixture, "fake-codex-turn.log").find((entry) => entry.scenario === "fork");
      return turn === undefined ? undefined : { provider: turn.pid, sameGroup: turn.sameGroup, escaped: turn.escaped };
    }
  }
];

// hazard: a case that fails before it signals the command would leave the
// command and the fake's processes alive.
function reapForkedRun(t, child, tree) {
  t.after(() => {
    child.kill("SIGKILL");
    for (const pid of Object.values(tree() ?? {})) if (running(pid)) process.kill(pid, "SIGKILL");
  });
}

async function assertTreeGone(tree, label) {
  for (const [name, pid] of Object.entries(tree)) {
    await waitFor(() => !running(pid), 10_000).catch(() => undefined);
    assert.equal(running(pid), false, `${name} outlived ${label}`);
  }
}

for (const { provider, flag, state, tree, recorded } of INTERRUPTED_PROVIDERS) {
  for (const signal of ["SIGHUP", "SIGTERM"]) {
    test(
      `${signal} while ${provider} runs stops its whole tree, records no abort, and leaves a run that resume completes`,
      TIMEOUT,
      async (t) => {
        if (!DARWIN) return notConfiguredOffMacOS(t);
        const fixture = await taskFixture();
        await writeFile(join(fixture.scratch, flag), "");
        const plan = await approved(fixture);
        const child = fixture.launchAsync(startArguments(fixture, plan.runId));
        const finished = exited(child);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        reapForkedRun(t, child, () => tree(fixture));
        await waitFor(() => tree(fixture) !== undefined);
        const forked = tree(fixture);
        for (const [name, pid] of Object.entries(forked))
          assert.equal(running(pid), true, `${name} was running before the signal`);
        assert.equal(status(fixture, plan.runId).state, state);

        child.kill(signal);
        assert.deepEqual(await finished, { code: null, signal }, "the command ends as the signal ends a process");
        await assertTreeGone(forked, "the command");
        assert.equal(stdout, "", "an interrupted command reports no outcome");
        assert.equal(stderr.includes("vestra:"), false, "a tree that was stopped is not reported as running");

        const interrupted = status(fixture, plan.runId);
        assert.equal(interrupted.state, state, "no abort and no failure was recorded");
        assert.equal(interrupted.activeProcess, false);
        const runDirectory = join(fixture.stateRoot, "tasks", plan.runId);
        assert.equal(existsSync(join(runDirectory, "cancel.json")), false, "a cancel marker was written");
        assert.equal(existsSync(join(runDirectory, "outcome.json")), false, "an outcome was recorded");
        assert.equal(interrupted.checkpoints.budget?.consumedTokens ?? null, recorded);
        refused(start(fixture, plan.runId), "VES_TASK_TRANSITION_REFUSED", "start an interrupted run");

        await rm(join(fixture.scratch, flag));
        const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
        assert.equal(resumed.state, "HUMAN_REVIEW");
        assert.equal(fixture.git(["show", `${resumed.branch}:src/value.txt`]), "new");
        // invariant: the total is the usage the providers reported: the stopped
        // session reported none, the sessions of the resumed run 18 and 8.
        const budget = status(fixture, plan.runId).checkpoints.budget;
        assert.equal(budget.consumedTokens, RUN_TOKENS);
        assert.equal(budget.usageEvents, RUN_USAGE_EVENTS);
      }
    );
  }
}

// invariant: SIGINT is the cancel it has always been: the provider's whole
// tree is stopped and the run is aborted.
test(
  "SIGINT while the implementer runs still cancels: the tree is stopped and the run is aborted",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture({ request: { instructions: "Start helpers and never answer. scenario:fork" } });
    const plan = await approved(fixture);
    const child = fixture.launchAsync(startArguments(fixture, plan.runId));
    const finished = exited(child);
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const tree = INTERRUPTED_PROVIDERS[0].tree;
    reapForkedRun(t, child, () => tree(fixture));
    await waitFor(() => tree(fixture) !== undefined);
    const forked = tree(fixture);
    child.kill("SIGINT");
    assert.deepEqual(await finished, { code: 1, signal: null });
    assert.equal(JSON.parse(stdout).data.status, "ABORTED");
    assert.equal(status(fixture, plan.runId).state, "ABORTED");
    await assertTreeGone(forked, "the cancel");
  }
);

// invariant: the interrupt handlers exist only while a provider runs. A
// termination request at any other moment is the cancel it was before. Here it
// arrives while the gate is running: the command keeps running, the gate
// passes, and the run is then aborted instead of going on to verification.
test("SIGTERM while no provider is running still cancels the run", TIMEOUT, async (t) => {
  if (!DARWIN) return notConfiguredOffMacOS(t);
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  await writeFile(join(fixture.home, "pause-gate"), "");
  const child = fixture.launchAsync(startArguments(fixture, plan.runId));
  const finished = exited(child);
  let stdout = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  t.after(() => child.kill("SIGKILL"));
  await waitFor(() => existsSync(join(fixture.home, "gate-paused")));
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(child.exitCode, null, "the signal did not end the command");
  assert.equal(child.signalCode, null, "the signal did not end the command");
  await rm(join(fixture.home, "pause-gate"));
  assert.deepEqual(await finished, { code: 1, signal: null });
  assert.equal(JSON.parse(stdout).data.status, "ABORTED");
  assert.equal(status(fixture, plan.runId).state, "ABORTED");
  assert.deepEqual(logLines(fixture, "fake-codex.log"), [], "the verifier never started");
});

// invariant: `task review` proves the Execution Package against the plan as
// `task approve` does, before it asks for the confirmation or records the
// review. A package swapped after approval used to surface only when the Run
// Capsule was sealed, after the review was recorded and the run had ended.
test("review refuses a package swapped after approval and leaves the run in review", TIMEOUT, async (t) => {
  if (!DARWIN) return notConfiguredOffMacOS(t);
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  const run = ok(start(fixture, plan.runId), "start");
  const other = await planned(fixture);
  const packageFile = (runId) => {
    const directory = join(fixture.stateRoot, "tasks", runId, "packages");
    const [name] = readdirSync(directory).filter((entry) => entry.endsWith(".json"));
    return join(directory, name);
  };
  const runDirectory = join(fixture.stateRoot, "tasks", plan.runId);
  const original = readFileSync(packageFile(plan.runId), "utf8");
  await writeFile(packageFile(plan.runId), readFileSync(packageFile(other.runId), "utf8"));

  const error = refused(review(fixture, plan.runId, "accepted", run.surfaceDigest), "VES_TASK_STATE_INVALID", "review");
  assert.equal(error.safeDetails.reason, "VES_TASK_PACKAGE_INVALID");
  const after = status(fixture, plan.runId);
  assert.equal(after.state, "HUMAN_REVIEW", "a refused review ended the run");
  assert.equal(after.evidence.reviewOutcome, null, "a refused review was recorded");
  assert.equal(after.capsuleId, null);
  assert.equal(existsSync(join(runDirectory, "review.json")), false);
  assert.equal(existsSync(join(runDirectory, "capsules")), false);

  await writeFile(packageFile(plan.runId), original);
  assert.equal(ok(review(fixture, plan.runId, "accepted", run.surfaceDigest), "review").state, "COMPLETED");
});

// invariant: nothing below a task state root is reached through a link. A Run
// directory that is a link stops every command that names the run before it
// reads the plan record behind it. No credential is read before that, so the
// refusal is asserted on macOS and Linux; on Windows each command is refused
// for the platform, and in both cases nothing changes behind the link.
function linkListing(directory) {
  return readdirSync(directory, { recursive: true })
    .map(String)
    .sort((left, right) => Number(left > right) - Number(left < right));
}

function runCommands(fixture, runId) {
  const digest = `sha256:${"0".repeat(64)}`;
  const named = (verb, ...rest) => ["task", verb, "--run-id", runId, ...rest, "--output", "json"];
  return [
    ["approve", named("approve", "--binding-digest", digest)],
    ["start", startArguments(fixture, runId)],
    ["resume", startArguments(fixture, runId, "resume")],
    ["status", named("status")],
    ["cancel", named("cancel")],
    ["review", named("review", "--outcome", "accepted", "--surface-digest", digest)]
  ];
}

test(
  "a Run directory that is a link is refused by every task command, with nothing changed behind it",
  TIMEOUT,
  async () => {
    const fixture = await taskFixture();
    const runId = "run_018f0b6d-7b1a-7abc-8def-112345678902";
    const outside = join(fixture.root, "outside-run");
    await mkdir(join(outside, "packages"), { recursive: true });
    await writeFile(join(outside, "keep.txt"), "not a Run directory\n");
    await mkdir(join(fixture.stateRoot, "tasks"), { recursive: true });
    await symlink(outside, join(fixture.stateRoot, "tasks", runId), "junction");
    const before = linkListing(outside);
    for (const [name, argv] of runCommands(fixture, runId)) {
      const result = fixture.launch(argv);
      if (process.platform === "win32") {
        const error = refused(result, "VES_TASK_NOT_CONFIGURED", name);
        assert.equal(error.safeDetails.requirement, "platform");
      } else assert.deepEqual(refused(result, "VES_STATE_ROOT_ESCAPE", name).safeDetails, {});
      assert.deepEqual(linkListing(outside), before, `task ${name} changed something behind the link`);
    }
  }
);

test("a planned run moved behind a link is refused, and runs once it is moved back", TIMEOUT, async (t) => {
  if (!DARWIN) return notConfiguredOffMacOS(t);
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  const runDirectory = join(fixture.stateRoot, "tasks", plan.runId);
  const moved = join(fixture.root, "moved-run");
  await rename(runDirectory, moved);
  await symlink(moved, runDirectory);
  const before = linkListing(moved);
  for (const [name, argv] of runCommands(fixture, plan.runId))
    refused(fixture.launch(argv), "VES_STATE_ROOT_ESCAPE", name);
  assert.deepEqual(linkListing(moved), before);
  assert.deepEqual(logLines(fixture, "fake-claude.log"), []);
  await rm(runDirectory);
  await rename(moved, runDirectory);
  assert.equal(ok(start(fixture, plan.runId), "start").state, "HUMAN_REVIEW");
});

// invariant: verification deletes its scratch checkouts recursively. A link
// at the run's scratch root fails the run before a checkout is created or a
// directory behind the link is deleted.
test("a linked verification scratch root fails the run before anything is deleted through it", TIMEOUT, async (t) => {
  if (!DARWIN) return notConfiguredOffMacOS(t);
  const fixture = await taskFixture();
  const plan = await approved(fixture);
  const outside = join(fixture.root, "outside-scratch");
  await mkdir(join(outside, "review"), { recursive: true });
  await writeFile(join(outside, "review", "keep.txt"), "not a scratch checkout\n");
  await mkdir(join(fixture.stateRoot, "verification"), { recursive: true });
  await symlink(outside, join(fixture.stateRoot, "verification", plan.runId));
  const run = start(fixture, plan.runId);
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.json.data.state, "FAILED");
  assert.equal(run.json.data.reason, "VES_STATE_ROOT_ESCAPE");
  assert.deepEqual(linkListing(outside), ["review", "review/keep.txt"]);
  assert.deepEqual(logLines(fixture, "fake-codex.log"), [], "the verifier was started");
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
});

test(
  "a linked directory inside the Run directory fails the run with nothing written through it",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture();
    const plan = await approved(fixture);
    const outside = join(fixture.root, "outside-evidence");
    await mkdir(outside);
    await symlink(outside, join(fixture.stateRoot, "tasks", plan.runId, "gate-evidence"));
    const run = start(fixture, plan.runId);
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.json.data.state, "FAILED");
    assert.equal(run.json.data.reason, "VES_STATE_ROOT_ESCAPE");
    assert.deepEqual(readdirSync(outside), [], "gate evidence was written through the link");
    assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "", "a task commit was made without its evidence");
    assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  }
);

// invariant: sealing the five markers changes no journey. A run planned now
// names the marker seal in its plan record and writes its markers sealed; a
// run planned before that (the legacy fixture: the same plan record without
// the member) keeps its plain markers. Both are interrupted, resumed,
// cancelled, and reviewed alike, and both bind the same digest of the grant
// record into the Run Capsule.
const MARKER_FORMS = Object.freeze(["legacy", "sealed"]);

async function approvedAs(fixture, form) {
  const plan = await planned(fixture);
  assert.equal(fixture.planRecord(plan.runId).markerSeal, 1, "task plan did not name the marker seal");
  if (form === "legacy") await fixture.asLegacyRun(plan.runId);
  ok(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  return plan;
}

function markerPath(fixture, runId, name) {
  return join(fixture.stateRoot, "tasks", runId, name);
}

function assertMarkerForm(fixture, runId, names, form) {
  for (const name of names) {
    const stored = JSON.parse(readFileSync(markerPath(fixture, runId, name), "utf8"));
    const sealed = Object.keys(stored).join(",") === "digest,record";
    assert.equal(sealed, form === "sealed", `${name} of a ${form} Run`);
    if (sealed) assert.equal(stored.digest, fixture.recordDigest(stored.record), `${name} is not sealed by its record`);
  }
}

function capsuleGrants(fixture, runId) {
  const directory = join(fixture.stateRoot, "tasks", runId, "capsules");
  const [file] = readdirSync(directory, { recursive: true }).filter((name) => String(name).endsWith(".json"));
  const envelope = JSON.parse(readFileSync(join(directory, String(file)), "utf8"));
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  return statement.predicate.content.evidence.capabilityGrants;
}

for (const form of MARKER_FORMS) {
  test(
    `a ${form} Run interrupted at its gate resumes, is accepted, and its capsule binds the grant record`,
    TIMEOUT,
    async (t) => {
      if (!DARWIN) return notConfiguredOffMacOS(t);
      const fixture = await taskFixture();
      const plan = await approvedAs(fixture, form);
      assert.equal((await killedAtHeldGate(fixture, plan)).signal, "SIGKILL");
      assertMarkerForm(fixture, plan.runId, ["grant.json", "worktree.json", "active.json"], form);
      const interrupted = status(fixture, plan.runId);
      assert.equal(interrupted.state, "IMPLEMENTING");
      assert.equal(interrupted.activeProcess, false);
      assert.equal(interrupted.checkpoints.executor, "awaiting-gate");

      const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
      assert.equal(resumed.state, "HUMAN_REVIEW");
      assert.equal(logLines(fixture, "fake-claude.log").filter((entry) => entry.scenario !== undefined).length, 1);
      assert.equal(receiptCount(fixture), 1);
      assertMarkerForm(fixture, plan.runId, ["outcome.json"], form);
      const { grantId } = status(fixture, plan.runId).evidence;
      assert.match(grantId, /^grant_/u);

      assert.equal(ok(review(fixture, plan.runId, "accepted", resumed.surfaceDigest), "review").state, "COMPLETED");
      assert.deepEqual(capsuleGrants(fixture, plan.runId), [
        { artifactId: `grant:${grantId}`, digest: fixture.recordDigest({ grantId }) }
      ]);
    }
  );

  test(`cancel ends a ${form} Run nobody is driving and frees the Workspace for the next run`, TIMEOUT, async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture();
    const plan = await approvedAs(fixture, form);
    await killedAtHeldGate(fixture, plan);
    assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 2);
    const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
    assert.equal(cancelled.state, "ABORTED");
    assert.equal(cancelled.stopped, true);
    assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
    assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "");
    const next = await approvedAs(fixture, form);
    assert.equal(ok(start(fixture, next.runId), "next start").state, "HUMAN_REVIEW");
  });

  test(`cancel stops a running ${form} Run from another process`, TIMEOUT, async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture({ request: { instructions: "Work slowly. scenario:slow" } });
    const plan = await approvedAs(fixture, form);
    const child = fixture.launchAsync(startArguments(fixture, plan.runId));
    const finished = exited(child);
    t.after(() => child.kill("SIGKILL"));
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    await waitFor(() => logLines(fixture, "fake-claude.log").some((entry) => entry.results !== undefined));
    assert.equal(status(fixture, plan.runId).activeProcess, true);
    assertMarkerForm(fixture, plan.runId, ["active.json"], form);
    const cancelled = ok(fixture.launch(["task", "cancel", "--run-id", plan.runId, "--output", "json"]), "cancel");
    assert.equal(cancelled.stopped, true);
    assert.equal((await finished).code, 1);
    assert.equal(JSON.parse(stdout).data.status, "ABORTED");
    assertMarkerForm(fixture, plan.runId, ["cancel.json", "outcome.json"], form);
    const after = status(fixture, plan.runId);
    assert.equal(after.state, "ABORTED");
    assert.equal(after.activeProcess, false);
    assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  });
}

// invariant: no downgrade. A sealed Run does not believe a marker that was
// replaced by the plain form a legacy Run would hold. Its active marker then
// counts as a driver, so a resume is refused as it is under a live one; its
// grant marker fails status and review closed before anything is recorded.
// Put back, each marker lets the same command succeed.
test(
  "a sealed Run refuses a marker replaced by a plain one, and accepts it again once restored",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture();
    const plan = await approvedAs(fixture, "sealed");
    await killedAtHeldGate(fixture, plan);
    const downgrade = async (name) => {
      const sealed = readFileSync(markerPath(fixture, plan.runId, name), "utf8");
      await writeFile(markerPath(fixture, plan.runId, name), `${JSON.stringify(JSON.parse(sealed).record)}\n`);
      return () => writeFile(markerPath(fixture, plan.runId, name), sealed);
    };

    const restoreActive = await downgrade("active.json");
    const driven = status(fixture, plan.runId);
    assert.equal(driven.activeProcess, true, "a plain active marker was believed");
    assert.deepEqual(driven.next, [`vestra task cancel --run-id ${plan.runId}`]);
    refused(start(fixture, plan.runId, "resume"), "VES_TASK_RUN_ACTIVE", "resume under a marker that does not verify");
    await restoreActive();
    const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
    assert.equal(resumed.state, "HUMAN_REVIEW");

    const restoreGrant = await downgrade("grant.json");
    const statusError = refused(
      fixture.launch(["task", "status", "--run-id", plan.runId, "--output", "json"]),
      "VES_TASK_STATE_INVALID",
      "status"
    );
    assert.equal(statusError.safeDetails.reason, "VES_TASK_STATE_MALFORMED");
    const reviewError = refused(
      review(fixture, plan.runId, "accepted", resumed.surfaceDigest),
      "VES_TASK_STATE_INVALID",
      "review"
    );
    assert.equal(reviewError.safeDetails.reason, "VES_TASK_STATE_MALFORMED");
    assert.equal(existsSync(markerPath(fixture, plan.runId, "review.json")), false, "a refused review was recorded");
    await restoreGrant();
    assert.equal(status(fixture, plan.runId).state, "HUMAN_REVIEW");
    assert.equal(ok(review(fixture, plan.runId, "accepted", resumed.surfaceDigest), "review").state, "COMPLETED");
  }
);

// invariant: one run, one account of usage. A run that verifies is killed after
// its verifier answered, while the verification's mutation run is held, so the
// verifier's usage was metered and nothing after it was recorded. `status`
// still reports that usage, and the resumed run, which asks the verifier
// again, adds the second session once.
test(
  "a run killed during verification keeps the verifier's usage, and resume counts the repeated one once",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture();
    const plan = await approved(fixture);
    const held = join(fixture.home, "mutation-held");
    await writeFile(join(fixture.home, "hold-mutation"), "");
    const child = fixture.launchAsync(startArguments(fixture, plan.runId));
    const finished = exited(child);
    // hazard: a case that fails before the kill would leave the command and
    // the held gate alive.
    t.after(() => {
      child.kill("SIGKILL");
      if (existsSync(held) && running(Number(readFileSync(held, "utf8"))))
        process.kill(-Number(readFileSync(held, "utf8")), "SIGKILL");
    });
    await waitFor(() => existsSync(held));
    child.kill("SIGKILL");
    assert.equal((await finished).signal, "SIGKILL");
    process.kill(-Number(readFileSync(held, "utf8")), "SIGKILL");
    await rm(join(fixture.home, "hold-mutation"));

    const interrupted = status(fixture, plan.runId);
    assert.equal(interrupted.state, "VERIFYING");
    assert.equal(interrupted.activeProcess, false);
    assert.equal(interrupted.checkpoints.repair, "converged");
    assert.equal(interrupted.evidence.verificationVerdict, null, "the killed verification was decided");
    // why: 18 from the implementer and 8 from the verifier session that had
    // answered before the kill.
    assert.equal(interrupted.checkpoints.budget.consumedTokens, RUN_TOKENS);
    assert.equal(interrupted.checkpoints.budget.usageEvents, RUN_USAGE_EVENTS);

    const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
    assert.equal(resumed.state, "HUMAN_REVIEW");
    assert.equal(logLines(fixture, "fake-claude.log").filter((entry) => entry.scenario !== undefined).length, 1);
    assert.equal(logLines(fixture, "fake-codex.log").length, 2, "the resumed run asks the verifier again");
    // why: the implementer ran once and the verifier twice: 18 + 8 + 8 = 34
    // tokens in 3 events. 26 would have lost the killed session and 42 would
    // have counted one of them twice.
    const budget = status(fixture, plan.runId).checkpoints.budget;
    assert.equal(budget.consumedTokens, RUN_TOKENS + VERIFIER_TOKENS);
    assert.equal(budget.consumedTokens, 34);
    assert.equal(budget.unbilledTokens, 34);
    assert.equal(budget.usageEvents, 3);
    assert.equal(budget.billing, "subscription");

    assert.equal(ok(review(fixture, plan.runId, "accepted", resumed.surfaceDigest), "review").state, "COMPLETED");
    const sealed = capsuleBudget(fixture, plan.runId);
    assert.equal(sealed.consumed.tokens, 34);
    assert.equal(sealed.consumed.unbilledTokens, 34);
    assert.equal(sealed.consumed.usageEvents, 3);
  }
);

// invariant: the verifier spends from the run's ceilings, not from its own.
// 90% of 28 tokens is 25.2: the implementer's 18 are below it, so its gate
// converges and the task is committed; the verifier's 8 are below it too; the
// run's 26 are not. The run fails when the verifier reports, and the ledger
// names the ceiling and the whole of what was spent.
test(
  "a ceiling the implementer and the verifier reach only together fails the run in verification",
  TIMEOUT,
  async (t) => {
    if (!DARWIN) return notConfiguredOffMacOS(t);
    const fixture = await taskFixture({
      request: { budgets: { maximumCostUsd: 5, maximumTokens: 28, maximumDurationMs: 600_000 } }
    });
    const plan = await approved(fixture);
    const run = start(fixture, plan.runId);
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.json.data.state, "FAILED");
    assert.equal(logLines(fixture, "fake-codex.log").length, 1, "the verifier was never asked");
    const after = status(fixture, plan.runId);
    assert.equal(after.state, "FAILED");
    assert.equal(after.checkpoints.repair, "converged", "the implementer alone reached the ceiling");
    assert.match(after.evidence.commitId, /^[a-f0-9]{40}$/u);
    assert.equal(after.evidence.verificationVerdict, null);
    assert.equal(after.checkpoints.budget.stopReason, "token-threshold");
    assert.equal(after.checkpoints.budget.consumedTokens, RUN_TOKENS);
    assert.equal(after.checkpoints.budget.usageEvents, RUN_USAGE_EVENTS);
  }
);
