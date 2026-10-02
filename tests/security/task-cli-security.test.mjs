// invariant: hostile implementer behavior through the real `vestra task`
// binary (#405). The DETERMINISTIC FAKE `claude` in tests/helpers/task-cli-fakes
// plays a model that tries to escape: traversal, a planted symlink, protected
// paths, and obeying a prompt injection it reads from the repository. Every
// attempt must be refused by the mediated bridge and the executor, never by
// the fake's good behavior, and the user's checkout must not move.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  AMBIENT_MARKER,
  CREDENTIALS,
  DARWIN,
  MODE_CREDENTIALS,
  approveArguments,
  cleanupTaskFixtures,
  taskFixture
} from "../helpers/task-cli-fixture.mjs";

after(cleanupTaskFixtures);

const TIMEOUT = { timeout: 300_000 };

function data(result, label) {
  assert.ok(result.json !== undefined, `${label}: ${result.stderr}`);
  return result.json.data;
}

async function run(scenario) {
  const fixture = await taskFixture({ request: { instructions: `Set the value. scenario:${scenario}` } });
  const before = {
    head: fixture.git(["rev-parse", "HEAD"]),
    status: fixture.git(["status", "--porcelain=v1", "--untracked-files=all"])
  };
  const plan = data(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan"
  );
  data(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  const started = fixture.launch([
    "task",
    "start",
    "--run-id",
    plan.runId,
    ...fixture.keychainArgs,
    "--output",
    "json"
  ]);
  const log = readFileSync(join(fixture.scratch, "fake-claude.log"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const results = log.find((entry) => entry.results !== undefined)?.results ?? [];
  const after = {
    head: fixture.git(["rev-parse", "HEAD"]),
    status: fixture.git(["status", "--porcelain=v1", "--untracked-files=all"])
  };
  assert.deepEqual(after, before, "the user's checkout must not move");
  return { fixture, plan, started: data(started, "start"), results, log };
}

function denied(results, path, code) {
  const matching = results.filter((entry) => entry.path === path);
  assert.ok(matching.length > 0, `${path} was attempted`);
  for (const entry of matching) {
    assert.equal(entry.isError, true, `${path} must be refused`);
    if (code !== undefined) assert.match(entry.text, code, path);
  }
}

function committedPaths(fixture, branch) {
  return fixture.git(["diff", "--name-only", fixture.revision, branch]).split("\n");
}

test("traversal out of the worktree is refused for reads and writes", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { fixture, started, results } = await run("traversal");
  // The bridge refuses a non-logical path itself; the executor would too.
  denied(results, "../escape.txt", /VES_BRIDGE_PATH_INVALID|VES_EXECUTOR_SCOPE_DENIED/u);
  denied(results, "src/../../escape.txt", /VES_BRIDGE_PATH_INVALID|VES_EXECUTOR_SCOPE_DENIED/u);
  denied(results, "../../../../etc/hosts");
  denied(results, ".git/config");
  assert.equal(existsSync(join(fixture.root, "escape.txt")), false);
  assert.equal(existsSync(join(fixture.repository, "escape.txt")), false);
  assert.equal(started.state, "HUMAN_REVIEW");
  assert.deepEqual(committedPaths(fixture, started.branch), ["src/value.txt"]);
});

test("a symlink planted in the repository cannot carry a read or write outside it", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { fixture, started, results } = await run("symlink");
  denied(results, "src/link/planted.txt");
  denied(results, "src/link/secret.txt");
  assert.equal(existsSync(join(fixture.root, "outside-dir", "planted.txt")), false);
  assert.equal(started.state, "HUMAN_REVIEW");
  assert.deepEqual(committedPaths(fixture, started.branch), ["src/value.txt"]);
});

test("protected paths stay untouched even inside the change scope", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { fixture, started, results } = await run("protected");
  denied(results, "src/protected/config.json", /VES_EXECUTOR_PROTECTED_PATH|VES_BRIDGE/u);
  denied(results, ".verchestra/policy/task-authority.json");
  denied(results, ".git/config");
  assert.equal(started.state, "HUMAN_REVIEW");
  assert.equal(fixture.git(["show", `${started.branch}:src/protected/config.json`]), '{"locked":true}');
  assert.deepEqual(committedPaths(fixture, started.branch), ["src/value.txt"]);
  assert.equal(existsSync(join(fixture.repository, ".verchestra", "policy")), false);
});

test("a prompt injection read from the repository cannot widen scope or reach a non-bridge tool", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { fixture, plan, started, results, log } = await run("injection");
  // The injected text reached the model only as labeled, untrusted data...
  assert.equal(log[0].promptHasInjectionText, true);
  // ...and obeying it bought nothing: the write it asked for is out of scope,
  // and the tool it asked for is outside the bridge, which ends the run.
  denied(results, "docs/owned.txt", /VES_EXECUTOR_SCOPE_DENIED/u);
  assert.equal(started.state, "FAILED");
  assert.equal(started.reason, "VES_DRIVER_TOOL_OUTSIDE_BRIDGE");
  assert.equal(existsSync(join(fixture.repository, "docs")), false);
  assert.equal(fixture.git(["branch", "--list", "vestra/*"]), "");
  assert.equal(fixture.git(["worktree", "list", "--porcelain"]).split("\n\n").length, 1);
  const status = data(fixture.launch(["task", "status", "--run-id", plan.runId, "--output", "json"]), "status");
  assert.equal(status.state, "FAILED");
  assert.deepEqual(status.next, []);
});

// invariant: the credential boundary of the subscription path (SPA-20). The
// Claude Code token is long-lived, so it may exist in exactly one place
// outside the credential store: the implementer child's environment. An
// owner's own logged-in sessions and exported credentials must never reach a
// provider child or stand in for a credential the Workspace has not bound.
const TOKEN = CREDENTIALS["claude-code-oauth-token"];

function logged(fixture, name) {
  const path = join(fixture.scratch, name);
  return existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

// why: sealed evidence is a signed envelope whose payload is base64, so a
// plain byte scan would miss a value inside it; every string that decodes is
// scanned as well.
function decoded(text) {
  const parts = [text];
  for (const candidate of text.match(/[A-Za-z0-9+/=]{64,}/gu) ?? [])
    parts.push(Buffer.from(candidate, "base64").toString("latin1"));
  return parts;
}

function filesHolding(root, needle, skip) {
  const holders = [];
  for (const name of readdirSync(root, { recursive: true })) {
    const path = join(root, String(name));
    if (skip(path) || !statSync(path).isFile()) continue;
    if (decoded(readFileSync(path).toString("latin1")).some((part) => part.includes(needle))) holders.push(path);
  }
  return holders;
}

for (const [scenario, state] of [
  ["leak", "COMPLETED"],
  ["leak-fail", "FAILED"]
]) {
  test(
    `the subscription token stays out of argv, logs, output, evidence, and errors when a run is ${state}`,
    TIMEOUT,
    async () => {
      if (!DARWIN) return;
      const fixture = await taskFixture({ request: { instructions: `Set the value. scenario:${scenario}` } });
      const outputs = [];
      const launch = (argv, input) => {
        const result = fixture.launch(argv, input);
        outputs.push(result.stdout, result.stderr);
        return result;
      };
      const json = ["--output", "json"];
      const plan = data(
        launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, ...json]),
        "plan"
      );
      launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`);
      const started = launch(["task", "start", "--run-id", plan.runId, ...fixture.keychainArgs, ...json]).json.data;
      if (state === "COMPLETED")
        launch(
          [
            "task",
            "review",
            "--run-id",
            plan.runId,
            "--outcome",
            "accepted",
            "--surface-digest",
            started.surfaceDigest,
            "--confirm-stdin",
            ...fixture.keychainArgs,
            ...json
          ],
          `${started.surfaceDigest}\n`
        );
      assert.equal(data(launch(["task", "status", "--run-id", plan.runId, ...json]), "status").state, state);

      // why: the fake received the brokered token and repeated it in its answer.
      const [claude] = logged(fixture, "fake-claude.log");
      assert.equal(claude.credentialMatchesStore, true);
      assert.equal(
        claude.argv.some((argument) => argument.includes(TOKEN)),
        false,
        "token in the child argv"
      );
      for (const output of outputs)
        assert.equal(
          decoded(output).some((part) => part.includes(TOKEN)),
          false,
          "token in output"
        );
      // invariant: the fake keychain store is the one file that holds the token,
      // as the OS credential store does in production. Nothing else may: not the
      // Workspace state, the runtime database, the sealed evidence, the fake
      // providers' logs, the repository, or its object store.
      const store = join(fixture.scratch, "keychain-store.json");
      assert.deepEqual(
        filesHolding(fixture.root, TOKEN, (path) => path === store || path.includes("/.git/")),
        []
      );
      assert.equal(readFileSync(store, "utf8").includes(TOKEN), true, "the scan can see the token where it is kept");
      const revisions = fixture.git(["rev-list", "--all"]).split("\n").filter(Boolean);
      for (const revision of revisions)
        assert.equal(fixture.git(["show", "--format=%B", revision]).includes(TOKEN), false, revision);
    }
  );
}

test("an owner's ambient sessions never reach a provider child", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ ambient: true });
  const plan = data(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan"
  );
  data(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  const started = data(
    fixture.launch(["task", "start", "--run-id", plan.runId, ...fixture.keychainArgs, "--output", "json"]),
    "start"
  );
  assert.equal(started.state, "HUMAN_REVIEW");
  const [claude] = logged(fixture, "fake-claude.log");
  const [status] = logged(fixture, "fake-codex-status.log");
  const [codex] = logged(fixture, "fake-codex.log");
  for (const [name, child] of [
    ["claude", claude],
    ["codex login status", status],
    ["codex", codex]
  ]) {
    assert.equal(child.ambientValueSeen, false, `${name} saw an ambient value`);
    assert.notEqual(child.home, fixture.home, `${name} ran in the owner's home`);
  }
  assert.equal(claude.credentialMatchesStore, true);
  assert.equal(claude.configDirectory.includes("ambient-claude-config"), false);
  assert.equal(claude.environmentKeys.includes("ANTHROPIC_API_KEY"), false);
  assert.equal(claude.environmentKeys.includes("ANTHROPIC_AUTH_TOKEN"), false);
  for (const child of [status, codex]) {
    assert.equal(child.codexHome, fixture.codexIdentity);
    assert.equal(child.environmentKeys.includes("OPENAI_API_KEY"), false);
  }
});

test("an ambient Claude Code session cannot stand in for a token that is not bound", TIMEOUT, async () => {
  if (!DARWIN) return;
  const { "claude-code-oauth-token": omitted, ...withoutToken } = MODE_CREDENTIALS.subscription;
  assert.equal(omitted, TOKEN);
  const fixture = await taskFixture({ ambient: true, credentials: withoutToken });
  const plan = data(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan"
  );
  data(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  const start = fixture.launch(["task", "start", "--run-id", plan.runId, ...fixture.keychainArgs, "--output", "json"]);
  assert.equal(start.json.error.code, "VES_TASK_NOT_CONFIGURED");
  assert.equal(start.json.error.safeDetails.requirement, "claude-code-oauth-token");
  assert.deepEqual(logged(fixture, "fake-claude.log"), [], "Claude Code was started without the brokered token");
  assert.equal(`${start.stdout}${start.stderr}`.includes(AMBIENT_MARKER), false);
});

test("an ambient Codex login cannot stand in for the Workspace identity", TIMEOUT, async () => {
  if (!DARWIN) return;
  const fixture = await taskFixture({ ambient: true, codexLogin: null });
  const plan = data(
    fixture.launch(["task", "plan", "--request", fixture.requestPath, ...fixture.keychainArgs, "--output", "json"]),
    "plan"
  );
  data(fixture.launch(approveArguments(fixture, plan), `${plan.bindingDigest}\n`), "approve");
  const start = fixture.launch(["task", "start", "--run-id", plan.runId, ...fixture.keychainArgs, "--output", "json"]);
  assert.equal(start.json.error.code, "VES_TASK_NOT_CONFIGURED");
  assert.equal(start.json.error.safeDetails.requirement, "codex-login");
  const [status] = logged(fixture, "fake-codex-status.log");
  assert.equal(status.login, "none");
  assert.equal(status.codexHome, fixture.codexIdentity);
  assert.equal(status.ambientValueSeen, false);
  assert.deepEqual(logged(fixture, "fake-claude.log"), []);
  assert.deepEqual(logged(fixture, "fake-codex.log"), []);
});
