// invariant: TCK-01..TCK-06 (.specs/features/task-check/spec.md). `vestra task
// check` judges every task prerequisite in one pass with the checks `task
// plan` and `task start` apply, reports each as ready, missing, or not
// checked, reads no credential value, starts no provider session, and writes
// nothing to the repository or the Workspace state. The journeys run on every
// platform the task fixture serves.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { afterEach, test } from "node:test";

import { EXECUTIONS, coordinatedFixture } from "../helpers/task-coordinated-fixture.mjs";
import { LINUX, WIN32, cleanupTaskFixtures, taskFixture } from "../helpers/task-cli-fixture.mjs";
import { linkDirectory } from "../helpers/windows-links.mjs";

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

const names = (data) => data.checks.map((entry) => entry.check);
const statuses = (data) => Object.fromEntries(data.checks.map((entry) => [entry.check, entry.status]));
const row = (data, name) => data.checks.find((entry) => entry.check === name);

const SUBSCRIPTION_CHECKS = [
  "workspace",
  "request",
  "source-revision",
  "task-policy",
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

// why: every file under the Workspace state with its content digest. The
// Windows check creates the empty sessions directory, as `task start` does
// (TCK-05), so that one directory is left out.
async function stateSnapshot(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join("/");
    if (path === "sessions" || path.startsWith("sessions/")) continue;
    const digest = entry.isFile()
      ? createHash("sha256")
          .update(await readFile(join(entry.parentPath, entry.name)))
          .digest("hex")
      : "directory";
    files.push(`${path} ${digest}`);
  }
  return files.sort();
}

test("a configured Workspace is ready on every check, and nothing is read or written", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  const repository = () => fixture.git(["status", "--porcelain", "--untracked-files=all", "--ignored"]);
  const before = { repository: repository(), state: await stateSnapshot(fixture.stateRoot) };
  const result = check(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.data.ready, true);
  assert.deepEqual(names(result.data), SUBSCRIPTION_CHECKS);
  for (const entry of result.data.checks) assert.equal(entry.status, "ready", entry.check);
  assert.doesNotMatch(result.stderr, /^(missing|not-checked) /mu);
  assert.equal(repository(), before.repository);
  assert.deepEqual(await stateSnapshot(fixture.stateRoot), before.state);
  if (VALUE_READ !== undefined) assert.equal((await storeCommands(fixture)).includes(VALUE_READ), false);
});

test("every missing prerequisite is reported at once, with its refusal, and the exit is 4", TIMEOUT, async () => {
  const fixture = await fixtureFor({ allowlist: false, credentials: {}, codexLogin: null });
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(result.data.ready, false);
  assert.deepEqual(names(result.data), SUBSCRIPTION_CHECKS);
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
  assert.match(result.stderr, /codex login -c 'cli_auth_credentials_store="file"'/u);
});

test("without a Workspace the checks that need one wait for it, in order", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  await rm(join(fixture.repository, ".verchestra", "workspace.yaml"));
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.deepEqual(statuses(result.data), {
    workspace: "missing",
    request: "ready",
    "source-revision": "not-checked",
    "task-policy": "ready",
    "provider-modes": "not-checked",
    "gate-allowlist": "not-checked",
    "api-key-models": "not-checked",
    "credential:providers": "not-checked",
    "credential:evidence-signing-passphrase": "not-checked",
    "executable:claude": "ready",
    "executable:codex": "ready",
    "codex-login": "not-checked",
    ...(WIN32 ? { windows: "not-checked" } : {})
  });
  assert.deepEqual(
    names(result.data),
    [
      "workspace",
      "request",
      "source-revision",
      "task-policy",
      "provider-modes",
      "gate-allowlist",
      "api-key-models",
      "credential:providers",
      "credential:evidence-signing-passphrase",
      "executable:claude",
      "executable:codex",
      "codex-login",
      ...(WIN32 ? ["windows"] : [])
    ],
    "the rows come in the order TCK-04 states"
  );
  assert.equal(row(result.data, "workspace").code, "VES_INIT_WORKSPACE_MISSING");
  for (const entry of result.data.checks.filter((candidate) => candidate.status === "not-checked"))
    assert.equal(entry.dependsOn, "workspace", entry.check);
  assert.match(result.stderr, /^not-checked gate-allowlist: waits for workspace$/mu);
});

test(
  "a Workspace state directory that is a link is refused with its recovery, and nothing is made through it",
  TIMEOUT,
  async () => {
    const fixture = await fixtureFor();
    const elsewhere = join(fixture.root, "elsewhere");
    await mkdir(elsewhere);
    await linkDirectory(elsewhere, join(fixture.stateRoot, "sessions"));
    const result = check(fixture);
    assert.equal(result.status, 4, result.stderr);
    const workspace = row(result.data, "workspace");
    assert.equal(workspace.status, "missing");
    assert.equal(workspace.code, "VES_STATE_ROOT_ESCAPE");
    assert.ok(workspace.recovery.length > 0, "the escape keeps the recovery its public envelope carries");
    assert.deepEqual(await readdir(elsewhere), []);
  }
);

test("a rejected request leaves the checks that read it unjudged", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  await fixture.writeRequest({ verifier: { driverId: "codex", model: "not-a-listed-model" } });
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(row(result.data, "request").status, "missing");
  assert.equal(row(result.data, "request").code, "VES_TASK_REQUEST_REJECTED");
  for (const name of ["source-revision", "gate-allowlist", "api-key-models"])
    assert.equal(row(result.data, name).dependsOn, "request", name);
  assert.equal(row(result.data, "provider-modes").status, "ready");
});

test("a request whose source revision the repository lacks is missing as `task plan` refuses it", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  await fixture.writeRequest({ sourceRevision: "0".repeat(40) });
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  const revision = row(result.data, "source-revision");
  assert.equal(revision.status, "missing");
  assert.equal(revision.code, "VES_TASK_REQUEST_REJECTED");
  assert.equal(revision.details.reason, "VES_TASK_SOURCE_REVISION_UNKNOWN");
});

test("a malformed provider-modes file leaves the checks that read it unjudged", TIMEOUT, async () => {
  const fixture = await fixtureFor({ providers: "{ not json" });
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  assert.equal(row(result.data, "provider-modes").status, "missing");
  for (const name of ["api-key-models", "credential:providers", "codex-login"])
    assert.equal(row(result.data, name).dependsOn, "provider-modes", name);
  assert.equal(row(result.data, "credential:evidence-signing-passphrase").status, "ready");
});

test("on API keys both keys are checked and no Codex login is asked for", TIMEOUT, async () => {
  const fixture = await fixtureFor({ mode: "api-key" });
  const result = check(fixture);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(statuses(result.data), {
    workspace: "ready",
    request: "ready",
    "source-revision": "ready",
    "task-policy": "ready",
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

// invariant: TCK-06. Each driver is judged at the floor the run applies.
test("a Claude Code below the mediated floor is missing as claude-version", TIMEOUT, async () => {
  const fixture = await fixtureFor();
  await writeFile(join(fixture.scratch, "claude-2.1.281"), "");
  const result = check(fixture);
  assert.equal(result.status, 4, result.stderr);
  const claude = row(result.data, "executable:claude");
  assert.equal(claude.status, "missing");
  assert.equal(claude.details.requirement, "claude-version");
});

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
