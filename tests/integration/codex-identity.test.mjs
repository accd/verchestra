// invariant: the Codex subscription identity (SPA-09, SPA-10). The identity
// directory is private, pinned to the file credential store and the ChatGPT
// login, and only the exact ChatGPT status line with exit code 0 counts as a
// login. The DETERMINISTIC FAKE `codex` in tests/helpers/task-cli-fakes stands
// in for the CLI; its login is a fixture file, never a real credential.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import {
  CODEX_IDENTITY_CONFIG,
  codexIdentityDirectory,
  codexLoginCommand,
  codexSubscriptionLoggedIn,
  ensureCodexIdentity,
  requireCodexSubscription
} from "../../apps/vestra-cli/src/task/task-codex-identity.ts";
import { runCodexVerifier } from "../../apps/vestra-cli/src/task/task-codex.ts";
import { executeTaskCommand } from "../../apps/vestra-cli/src/task/task-command.ts";

const fakeCodex = fileURLToPath(new URL("../helpers/task-cli-fakes/fake-codex-task.mjs", import.meta.url));
const POSIX = process.platform !== "win32";
const listed = async (directory) =>
  (await readdir(directory)).sort((left, right) => Number(left > right) - Number(left < right));
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(login) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vestra-codex-identity-")));
  roots.push(root);
  const workspaceRoot = join(root, "workspace");
  const sessionsRoot = join(workspaceRoot, "sessions");
  const log = join(root, "log");
  await mkdir(sessionsRoot, { recursive: true });
  await mkdir(log);
  const directory = codexIdentityDirectory(workspaceRoot);
  if (login !== undefined) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "auth.json"), JSON.stringify({ fixtureLogin: login }));
  }
  const wrapper = join(root, "codex");
  await writeFile(
    wrapper,
    `#!/bin/sh\n# DETERMINISTIC FAKE - not Codex.\nexec '${process.execPath}' '${fakeCodex}' --fixture-log '${log}' "$@"\n`,
    { mode: 0o700 }
  );
  const stderr = [];
  const options = {
    workspaceRoot,
    sessionsRoot,
    command: [process.execPath, fakeCodex, "--fixture-log", log],
    // why: the fake may write its observation only inside its own temp
    // directory, which the fixture names explicitly.
    env: { PATH: process.env.PATH ?? "", TMPDIR: root, OPENAI_API_KEY: "sk-ambient-openai", HOME: homedir() },
    stderr: (value) => stderr.push(value)
  };
  const observed = async () =>
    (await readFile(join(log, "fake-codex-status.log"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { root, workspaceRoot, sessionsRoot, directory, options, stderr, observed, wrapper };
}

test("the identity directory is private, real, and pinned to the file store and the ChatGPT login", async () => {
  const { workspaceRoot, directory } = await fixture();
  assert.equal(directory, join(workspaceRoot, "codex-identity"));
  await ensureCodexIdentity(directory);
  assert.equal(CODEX_IDENTITY_CONFIG, 'cli_auth_credentials_store = "file"\nforced_login_method = "chatgpt"\n');
  assert.equal(await readFile(join(directory, "config.toml"), "utf8"), CODEX_IDENTITY_CONFIG);
  assert.deepEqual(await readdir(directory), ["config.toml"]);
  if (POSIX) {
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(directory, "config.toml"))).mode & 0o777, 0o600);
  }
});

test("configuration left in the identity directory is replaced before every use", async () => {
  const { directory } = await fixture("chatgpt");
  await writeFile(
    join(directory, "config.toml"),
    'cli_auth_credentials_store = "keyring"\n[mcp_servers.planted]\ncommand = "/bin/sh"\n'
  );
  await ensureCodexIdentity(directory);
  assert.equal(await readFile(join(directory, "config.toml"), "utf8"), CODEX_IDENTITY_CONFIG);
  assert.deepEqual(JSON.parse(await readFile(join(directory, "auth.json"), "utf8")), { fixtureLogin: "chatgpt" });
});

test("a link in place of the identity directory is refused", async (t) => {
  const { root, directory, workspaceRoot } = await fixture();
  const elsewhere = join(root, "elsewhere");
  await mkdir(elsewhere);
  await mkdir(workspaceRoot, { recursive: true });
  try {
    await symlink(elsewhere, directory, "dir");
  } catch (error) {
    // why: an unprivileged Windows account cannot create a link at all, which
    // is the same refusal one step earlier.
    assert.equal(error.code, "EPERM");
    return t.diagnostic("this account cannot create a directory link");
  }
  await assert.rejects(ensureCodexIdentity(directory), (error) => {
    assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
    assert.equal(error.envelope.safeDetails.requirement, "codex-identity");
    return true;
  });
  assert.deepEqual(await readdir(elsewhere), []);
});

test("a ChatGPT login is accepted and its check never sees the invoking home or an ambient key", async () => {
  const { options, directory, sessionsRoot, stderr, observed } = await fixture("chatgpt");
  assert.equal(await requireCodexSubscription(options), directory);
  assert.deepEqual(stderr, []);
  const [status] = await observed();
  assert.equal(status.login, "chatgpt");
  assert.equal(status.codexHome, directory);
  assert.equal(status.config, CODEX_IDENTITY_CONFIG);
  assert.notEqual(status.home, homedir());
  assert.ok(status.home.startsWith(join(sessionsRoot, "codex-status-")));
  assert.equal(status.cwd, status.home);
  assert.equal(status.environmentKeys.includes("OPENAI_API_KEY"), false);
  for (const key of ["CODEX_HOME", "HOME", "PATH"]) assert.ok(status.environmentKeys.includes(key), key);
  // invariant: the disposable home is gone; the identity directory and its login stay.
  assert.deepEqual(await readdir(sessionsRoot), []);
  assert.deepEqual(await listed(directory), ["auth.json", "config.toml"]);
});

for (const login of [undefined, "api-key", "access-token", "wrong-exit", "unknown-mode"]) {
  test(`a Codex status of ${login ?? "not logged in"} is not configured, with the exact one-time command`, async () => {
    const { options, directory, sessionsRoot, stderr } = await fixture(login);
    await assert.rejects(requireCodexSubscription(options), (error) => {
      assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
      assert.deepEqual(error.envelope.safeDetails, { requirement: "codex-login" });
      assert.equal(JSON.stringify(error.envelope).includes(directory), false);
      return true;
    });
    assert.deepEqual(stderr, [
      `Codex is not signed in with a ChatGPT plan for this Workspace. Run once:\n  CODEX_HOME='${directory}' codex login\n`
    ]);
    assert.equal(await readFile(join(directory, "config.toml"), "utf8"), CODEX_IDENTITY_CONFIG);
    assert.deepEqual(await readdir(sessionsRoot), []);
  });
}

test("a status check that hangs or cannot start is not a login", async () => {
  const hanging = await fixture("hang");
  const started = Date.now();
  await assert.rejects(requireCodexSubscription({ ...hanging.options, timeoutMs: 500 }), (error) => {
    assert.equal(error.envelope.safeDetails.requirement, "codex-login");
    return true;
  });
  assert.ok(Date.now() - started < 10_000);
  const missing = await fixture("chatgpt");
  assert.equal(
    await codexSubscriptionLoggedIn({
      command: [join(missing.root, "no-such-codex")],
      directory: missing.directory,
      home: missing.sessionsRoot,
      env: {}
    }),
    false
  );
});

test("the one-time command quotes the directory for a shell", () => {
  assert.equal(
    codexLoginCommand("/state/Application Support/x"),
    "CODEX_HOME='/state/Application Support/x' codex login"
  );
  assert.equal(codexLoginCommand("/state/it's"), "CODEX_HOME='/state/it'\\''s' codex login");
});

// invariant: a verifier session needs a POSIX executable wrapper for the fake.
// On Windows the governed task path is refused before any verifier starts, so
// each session case asserts that refusal there instead of passing unasserted.
async function taskPathRefusedOnWindows(t) {
  t.diagnostic("win32: asserting the governed task path is refused instead");
  await assert.rejects(
    executeTaskCommand(
      { name: "task status", options: { "run-id": "run_018f0000-0000-7000-8000-000000001502" } },
      { controlRoot: tmpdir(), platform: "win32", env: {}, stdin: process.stdin, stderr: () => undefined, pid: 1 }
    ),
    (error) => {
      assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
      assert.equal(error.envelope.safeDetails.requirement, "platform");
      return true;
    }
  );
}

async function verifierSession(login, source) {
  const base = await fixture(login);
  const review = join(base.root, "review");
  await mkdir(join(review, "src"), { recursive: true });
  await mkdir(join(review, "scripts"));
  await writeFile(join(review, "src", "value.txt"), "new\n");
  await writeFile(join(review, "scripts", "check-value.mjs"), 'if (value !== "new\\n") process.exit(1);\n');
  const sessionRoot = join(base.sessionsRoot, "codex-run");
  const log = join(base.root, "log");
  const run = () =>
    runCodexVerifier({
      workspaceId: "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
      runId: "run_018f0000-0000-7000-8000-000000001502",
      manifestId: `sha256:${"a".repeat(64)}`,
      request: { verifier: { driverId: "codex", model: "gpt-5.2-codex" } },
      // why: the session takes one executable, so a wrapper names the fake
      // and its private log directory, as the e2e fixture does.
      executable: base.wrapper,
      env: { PATH: process.env.PATH ?? "", TMPDIR: base.root, OPENAI_API_KEY: "sk-ambient-openai" },
      sessionRoot,
      cwd: review,
      prompt: "Requirements: VES-EXE-001",
      meter: undefined,
      signal: new AbortController().signal,
      ...source(base)
    });
  const sessions = async () =>
    (await readFile(join(log, "fake-codex.log"), "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return { ...base, run, sessions, sessionRoot };
}

test("a subscription verifier session uses the identity directory and supplies no API key", async (t) => {
  if (!POSIX) return taskPathRefusedOnWindows(t);
  const session = await verifierSession("chatgpt", (base) => ({ identityDirectory: base.directory }));
  await writeFile(join(session.directory, "config.toml"), "# left behind by an earlier session\n");
  assert.match(await session.run(), /VERCHESTRA-VERDICT-BEGIN/u);
  const [observed] = await session.sessions();
  assert.equal(observed.codexHome, session.directory);
  assert.equal(observed.login, "chatgpt");
  assert.equal(observed.config, CODEX_IDENTITY_CONFIG);
  assert.equal(observed.sandbox, "read-only");
  assert.equal(observed.tools, 0);
  assert.equal(observed.environmentKeys.includes("OPENAI_API_KEY"), false);
  assert.ok(observed.home.startsWith(`${session.sessionRoot}/`));
  // invariant: the per-session home is removed; the identity and its login stay.
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
  assert.deepEqual(await listed(session.directory), ["auth.json", "config.toml"]);
});

test("a subscription verifier without a ChatGPT login fails closed instead of using another credential", async (t) => {
  if (!POSIX) return taskPathRefusedOnWindows(t);
  const session = await verifierSession(undefined, (base) => ({ identityDirectory: base.directory }));
  await assert.rejects(session.run(), (error) => {
    assert.equal(error.envelope.code, "VES_TASK_FAILED");
    assert.equal(error.envelope.safeDetails.reason, "VES_TASK_VERIFIER_FAILED");
    return true;
  });
  assert.equal((await session.sessions())[0].environmentKeys.includes("OPENAI_API_KEY"), false);
});

test("an API-key verifier session keeps its per-session CODEX_HOME and never touches the identity directory", async (t) => {
  if (!POSIX) return taskPathRefusedOnWindows(t);
  const session = await verifierSession(undefined, () => ({ credential: "sk-openai-brokered-fixture" }));
  assert.match(await session.run(), /VERCHESTRA-VERDICT-BEGIN/u);
  const [observed] = await session.sessions();
  assert.equal(observed.codexHome, join(session.sessionRoot, "codex-home"));
  assert.ok(observed.environmentKeys.includes("OPENAI_API_KEY"));
  await assert.rejects(stat(session.directory), { code: "ENOENT" });
  await assert.rejects(stat(session.sessionRoot), { code: "ENOENT" });
});

test("a verifier session with both credential sources, or neither, is refused before Codex starts", async (t) => {
  if (!POSIX) return taskPathRefusedOnWindows(t);
  for (const source of [
    () => ({}),
    (base) => ({ credential: "sk-openai-brokered-fixture", identityDirectory: base.directory })
  ]) {
    const session = await verifierSession("chatgpt", source);
    await assert.rejects(session.run(), (error) => {
      assert.equal(error.envelope.safeDetails.reason, "VES_TASK_VERIFIER_CREDENTIAL_AMBIGUOUS");
      return true;
    });
    await assert.rejects(readFile(join(session.root, "log", "fake-codex.log")), { code: "ENOENT" });
  }
});
