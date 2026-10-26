// invariant: TCK-01..TCK-06 (.specs/features/task-check/spec.md). `vestra task
// check` judges every task prerequisite in one pass with the checks `task
// plan` and `task start` apply, reports each as ready, missing, or not
// checked, reads no credential value, and starts no provider session. The
// journeys run on every platform the task fixture serves.
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { EXECUTIONS, coordinatedFixture } from "../helpers/task-coordinated-fixture.mjs";
import { LINUX, WIN32, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";

const TIMEOUT = { timeout: 300_000 };
afterEach(cleanupTaskFixtures);

const fixtureFor = (options = {}) => taskFixture({ secretService: LINUX, ...options });

function check(fixture) {
  const result = fixture.launch([
    "task",
    "check",
    "--request",
    fixture.requestPath,
    ...fixture.keychainArgs,
    "--output",
    "json"
  ]);
  assert.ok(result.json !== undefined, `no JSON envelope: ${result.stderr}\n${result.stdout}`);
  return { status: result.status, stderr: result.stderr, data: result.json.data };
}

const statuses = (data) => Object.fromEntries(data.checks.map((row) => [row.check, row.status]));
const row = (data, name) => data.checks.find((entry) => entry.check === name);

const SUBSCRIPTION_CHECKS = [
  "workspace",
  "request",
  "provider-modes",
  "gate-allowlist",
  "api-key-models",
  "credential:claude-code-oauth-token",
  "credential:evidence-signing-passphrase",
  "executable:claude",
  "executable:codex",
  "codex-login",
  ...(WIN32 ? ["windows"] : [])
];

// why: the fake stores log every operation. Windows and Linux name a value
// read apart from a presence query (Credential Manager `Read`, Secret Service
// `lookup`); the macOS fake logs both as `find-generic-password`.
const VALUE_READ = { win32: "Read", linux: "lookup" }[process.platform];

async function storeCommands(fixture) {
  const text = await readFile(`${fixture.store}.log`, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((entry) => entry !== "")
    .map((entry) => JSON.parse(entry).command);
}

test("a configured Workspace is ready on every check, and no credential value is read", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  const before = fixture.git(["status", "--porcelain", "--untracked-files=all"]);
  const result = check(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.ready, true);
  assert.deepEqual(
    result.data.checks.map((entry) => entry.check),
    SUBSCRIPTION_CHECKS
  );
  for (const entry of result.data.checks) assert.equal(entry.status, "ready", entry.check);
  assert.doesNotMatch(result.stderr, /^(missing|not-checked) /mu);
  assert.equal(fixture.git(["status", "--porcelain", "--untracked-files=all"]), before);
  if (VALUE_READ !== undefined) assert.equal((await storeCommands(fixture)).includes(VALUE_READ), false);
});

test("every missing prerequisite is reported at once, with its refusal, and the exit is 4", TIMEOUT, async () => {
  const fixture = await fixtureFor({ allowlist: false, credentials: {}, codexLogin: null });
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(result.data.ready, false);
  const missing = [
    "gate-allowlist",
    "credential:claude-code-oauth-token",
    "credential:evidence-signing-passphrase",
    "codex-login"
  ];
  for (const name of missing) {
    const entry = row(result.data, name);
    assert.equal(entry.status, "missing", name);
    assert.equal(entry.code, "VES_TASK_NOT_CONFIGURED", name);
    assert.equal(entry.details.requirement, name.replace(/^credential:/u, ""), name);
    assert.ok(entry.recovery.length > 0, name);
  }
  for (const name of SUBSCRIPTION_CHECKS.filter((entry) => !missing.includes(entry)))
    assert.equal(row(result.data, name).status, "ready", name);
  assert.match(result.stderr, /^missing gate-allowlist: VES_TASK_NOT_CONFIGURED \(requirement=gate-allowlist\): /mu);
  assert.match(result.stderr, /^missing codex-login: VES_TASK_NOT_CONFIGURED \(requirement=codex-login\): /mu);
});

test("without a Workspace the checks that need one wait for it", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  await rm(join(fixture.repository, ".verchestra", "workspace.yaml"));
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(row(result.data, "workspace").status, "missing");
  assert.equal(row(result.data, "workspace").code, "VES_INIT_WORKSPACE_MISSING");
  for (const name of ["gate-allowlist", "provider-modes", "api-key-models", "credential:evidence-signing-passphrase"])
    assert.deepEqual(row(result.data, name), { check: name, status: "not-checked", dependsOn: "workspace" }, name);
  assert.equal(row(result.data, "codex-login").dependsOn, "workspace");
  assert.equal(row(result.data, "request").status, "ready");
  assert.equal(row(result.data, "executable:codex").status, "ready");
  assert.match(result.stderr, /^not-checked gate-allowlist: waits for workspace$/mu);
});

test("a rejected request leaves the checks that read it unjudged", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  await fixture.writeRequest({ verifier: { driverId: "codex", model: "not-a-listed-model" } });
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(row(result.data, "request").status, "missing");
  assert.equal(row(result.data, "request").code, "VES_TASK_REQUEST_REJECTED");
  for (const name of ["gate-allowlist", "api-key-models"])
    assert.equal(row(result.data, name).dependsOn, "request", name);
  assert.equal(row(result.data, "provider-modes").status, "ready");
});

test("on API keys both keys are checked and no Codex login is asked for", TIMEOUT, async () => {
  const fixture = await fixtureFor({ mode: "api-key" });
  const result = check(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(statuses(result.data), {
    workspace: "ready",
    request: "ready",
    "provider-modes": "ready",
    "gate-allowlist": "ready",
    "api-key-models": "ready",
    "credential:anthropic-api-key": "ready",
    "credential:openai-api-key": "ready",
    "credential:evidence-signing-passphrase": "ready",
    "executable:claude": "ready",
    "executable:codex": "ready",
    ...(WIN32 ? { windows: "ready" } : {})
  });
});

// invariant: TCK-06. The Codex floor is the one the run applies: the default
// for a v1 request, the structured minimum (0.159.3) for a v2 one.
test("a Codex below the coordinated floor is missing for a v2 request only", TIMEOUT, async () => {
  const single = await fixtureFor();
  await writeFile(join(single.scratch, "codex-0.159.2"), "");
  assert.equal(row(check(single).data, "executable:codex").status, "ready");

  const coordinated = await coordinatedFixture(EXECUTIONS.agent, { secretService: LINUX });
  await writeFile(join(coordinated.scratch, "codex-0.159.2"), "");
  const result = check(coordinated);
  assert.equal(result.status, 4, result.stderr);
  const codex = row(result.data, "executable:codex");
  assert.equal(codex.status, "missing");
  assert.equal(codex.details.requirement, "codex-version");
  assert.equal(row(result.data, "billing").status, "ready");
  assert.equal(row(result.data, "codex-login").dependsOn, "executable:codex");
});
