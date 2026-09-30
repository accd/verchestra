// invariant: #405's governed task journeys, end to end through the real
// `vestra` binary as a child process. The implementer and verifier are the
// DETERMINISTIC FAKE `claude` and `codex` executables in
// tests/helpers/task-cli-fakes (first on PATH); credentials come from the fake
// keychain preload (tests/helpers/fake-keychain-spawn.mjs, layered on the deny
// guard); the gate is a real process run through the machine-local allowlist.
// No provider is contacted and no product code carries a test hook.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  CREDENTIALS,
  DARWIN,
  approveArguments,
  cleanupTaskFixtures,
  taskFixture
} from "../helpers/task-cli-fixture.mjs";

after(cleanupTaskFixtures);

const TIMEOUT = { timeout: 300_000 };
const sha = (value) => createHash("sha256").update(value).digest("hex");

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

test("off macOS the task reports its credential store as not configured before any effect", TIMEOUT, async (t) => {
  if (DARWIN) return t.diagnostic("macOS runs the full journeys below");
  const fixture = await taskFixture();
  const plan = fixture.launch(["task", "plan", "--request", fixture.requestPath, "--output", "json"]);
  const error = refused(plan, "VES_TASK_NOT_CONFIGURED", "plan");
  assert.equal(error.safeDetails.requirement, "credential-store");
  assert.equal(existsSync(join(fixture.stateRoot, "tasks")), false);
});

test("a governed task is planned, approved, implemented, gated, verified, and accepted", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture();
  const before = checkout(fixture);
  const plan = await planned(fixture);
  assert.equal(plan.state, "AWAITING_EXECUTION_APPROVAL");
  assert.match(plan.bindingDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(plan.review.scope, ["path:src"]);
  assert.deepEqual(plan.review.destinations, ["provider:anthropic", "provider:openai"]);

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

  // The implementer saw only its brokered credential, in an isolated home; the
  // verifier ran read-only with no tools, its own credential, and CODEX_HOME.
  const [claude] = logLines(fixture, "fake-claude.log");
  assert.equal(claude.credentialDigest, sha(CREDENTIALS["anthropic-api-key"]));
  assert.notEqual(claude.home, fixture.home);
  assert.equal(claude.environmentKeys.includes("OPENAI_API_KEY"), false);
  assert.equal(claude.environmentKeys.includes("VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE"), false);
  const [codex] = logLines(fixture, "fake-codex.log");
  assert.equal(codex.sandbox, "read-only");
  assert.equal(codex.tools, 0);
  assert.equal(codex.credentialDigest, sha(CREDENTIALS["openai-api-key"]));
  assert.ok(codex.codexHome.startsWith(fixture.stateRoot));
  assert.equal(codex.environmentKeys.includes("ANTHROPIC_API_KEY"), false);

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

test("a missing credential is not configured before any transition, worktree, or provider call", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { "anthropic-api-key": omitted, ...rest } = CREDENTIALS;
  assert.ok(omitted);
  const fixture = await taskFixture({ credentials: rest });
  const plan = await approved(fixture);
  const error = refused(start(fixture, plan.runId), "VES_TASK_NOT_CONFIGURED", "start");
  assert.equal(error.safeDetails.requirement, "anthropic-api-key");
  const after = status(fixture, plan.runId);
  assert.equal(after.state, "EXECUTION_AUTHORIZED");
  assert.equal(after.checkpoints.executor, "none");
  assert.equal(after.evidence.grantId, null);
  assert.deepEqual(logLines(fixture, "fake-claude.log"), []);
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
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
