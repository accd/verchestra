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
import { rm, writeFile, mkdir, symlink } from "node:fs/promises";
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

after(cleanupTaskFixtures);

const TIMEOUT = { timeout: 300_000 };

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
  assert.equal(inReview.checkpoints.budget.consumedCostUsd, "not billed (subscription)");
  assert.equal(inReview.checkpoints.budget.billing, "subscription");
  assert.equal(inReview.checkpoints.budget.consumedTokens, 18);
  assert.equal(inReview.checkpoints.budget.unbilledTokens, 18);

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
  const budget = capsuleBudget(fixture, plan.runId);
  assert.equal(budget.billing, "subscription");
  assert.equal(Object.hasOwn(budget.consumed, "costUsd"), false);
  assert.equal(budget.consumed.unbilledTokens, budget.consumed.tokens);
  assert.equal(budget.consumed.tokens, 18);
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
  const budget = status(fixture, plan.runId).checkpoints.budget;
  assert.equal(typeof budget.consumedCostUsd, "number");
  assert.ok(budget.consumedCostUsd > 0);
  assert.equal(Object.hasOwn(budget, "billing"), false);
  assert.equal(Object.hasOwn(budget, "unbilledTokens"), false);
  ok(review(fixture, plan.runId, "accepted", run.surfaceDigest), "review");
  const sealed = capsuleBudget(fixture, plan.runId);
  assert.equal(Object.hasOwn(sealed, "billing"), false);
  assert.equal(sealed.consumed.costUsd, budget.consumedCostUsd);
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
  // invariant: the implementer's usage is the only usage in the run ledger,
  // and it is unbilled; the verifier's billed usage spends from the same ceilings.
  assert.equal(status(fixture, plan.runId).checkpoints.budget.consumedCostUsd, "not billed (subscription)");
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
  refused(start(fixture, plan.runId), "VES_TASK_TRANSITION_REFUSED", "start an interrupted run");

  const resumed = ok(start(fixture, plan.runId, "resume"), "resume");
  assert.equal(resumed.state, "HUMAN_REVIEW");
  assert.equal(logLines(fixture, "fake-claude.log").filter((entry) => entry.scenario !== undefined).length, 1);
  assert.equal(receiptCount(fixture), 1);
  assert.equal(fixture.git(["show", `${resumed.branch}:src/value.txt`]), "new");
  refused(start(fixture, plan.runId, "resume"), "VES_TASK_TRANSITION_REFUSED", "resume a run in review");
});

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
  if (!DARWIN) return;
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
