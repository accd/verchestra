// invariant: the Windows journey's preload (tests/helpers/fake-windows-spawn.mjs)
// answers the production Windows Credential Manager backend from the
// fixture's store and starts the labeled fakes for the `.exe` placeholders,
// while the deny guard still refuses every other credential program. It
// patches only this process, so the cases run on every platform; nothing here
// starts PowerShell, cmdkey, or a provider CLI.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { createOsCredentialStore } from "../../packages/platform-node/src/index.ts";
import { systemGit } from "../helpers/system-git.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const WORKSPACE_ID = "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const TOKEN = "fake-preload-subscription-token-1a2b";

async function preloaded(t) {
  const root = await temporaryDirectory(t, "verchestra-fake-windows-");
  const store = join(root, "keychain-store.json");
  await writeFile(store, JSON.stringify({ items: { [`verchestra/${WORKSPACE_ID}|claude-code-oauth-token`]: TOKEN } }));
  for (const name of ["claude.exe", "codex.exe"]) await writeFile(join(root, name), "DETERMINISTIC FAKE placeholder\n");
  process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE = store;
  process.env.VERCHESTRA_TEST_FAKE_PROVIDERS = root;
  process.env.VERCHESTRA_TEST_FAKE_PROVIDER_LOG = root;
  await import("../helpers/fake-windows-spawn.mjs");
  return { root, store };
}

test("the preload answers the Windows Credential Manager backend from the store, by presence and by read", async (t) => {
  const { root, store } = await preloaded(t);
  const credentials = createOsCredentialStore({ platform: "win32" });
  assert.equal(await credentials.adapter.has(WORKSPACE_ID, "claude-code-oauth-token"), true);
  assert.equal(await credentials.adapter.has(WORKSPACE_ID, "anthropic-api-key"), false);
  assert.equal(
    Buffer.from(await credentials.adapter.read(WORKSPACE_ID, "claude-code-oauth-token")).toString("utf8"),
    TOKEN
  );
  assert.equal(await credentials.adapter.read(WORKSPACE_ID, "anthropic-api-key"), undefined);
  const log = (await readFile(`${store}.log`, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(log, [
    { command: "cmdkey", account: "claude-code-oauth-token" },
    { command: "cmdkey", account: "anthropic-api-key" },
    { command: "Read", account: "claude-code-oauth-token" },
    { command: "Read", account: "anthropic-api-key" }
  ]);

  // invariant: the placeholders start the labeled fakes, through spawn and
  // through promisify(execFile) alike, as the drivers call them.
  const { stdout } = await promisify(execFile)(join(root, "claude.exe"), ["--version"], { encoding: "utf8" });
  assert.equal(stdout, "2.1.282 (Claude Code)\n");
  const codex = spawn(join(root, "codex.exe"), ["--version"], { stdio: ["ignore", "pipe", "ignore"] });
  let version = "";
  codex.stdout.on("data", (chunk) => (version += chunk));
  assert.deepEqual(await once(codex, "close"), [0, null]);
  assert.equal(version, "codex-cli 0.159.3\n");

  // invariant: each placeholder ran its fake under the provider witness, which
  // names the placeholder asked for, the fake that ran, and how it ended.
  for (const [placeholder, fake] of [
    ["claude.exe", "fake-claude-task.mjs"],
    ["codex.exe", "fake-codex-task.mjs"]
  ]) {
    const [witness, ...more] = (await readFile(join(root, `${placeholder}.witness.log`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(more, [], placeholder);
    assert.equal(witness.requested, join(root, placeholder));
    assert.equal(basename(witness.script), fake);
    assert.deepEqual(witness.args.slice(-1), ["--version"]);
    assert.equal(witness.code, 0);
    assert.equal(witness.signal, null);
    assert.equal(witness.stderrTail, "");
    assert.ok(witness.environmentKeys.length > 0);
    assert.equal(witness.environmentKeys.includes("VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE"), true);
  }

  // invariant: a Git command run through promisify(execFile) that fails is
  // named with its arguments, exit code, and standard error, and its failure
  // still reaches the caller; one that succeeds leaves nothing.
  const git = promisify(execFile);
  assert.match((await git(systemGit(), ["--version"], { cwd: root, encoding: "utf8" })).stdout, /^git version /u);
  await assert.rejects(git(systemGit(), ["definitely-not-a-git-command"], { cwd: root, encoding: "utf8" }), {
    code: 1
  });
  const failures = (await readFile(join(root, "git-witness.log"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].args, ["definitely-not-a-git-command"]);
  assert.equal(failures[0].cwd, root);
  assert.equal(failures[0].code, 1);
  assert.match(failures[0].stderrTail, /not a git command/u);
});

test("with the preload installed, the deny guard still refuses every other credential program", async (t) => {
  await preloaded(t);
  for (const tool of [
    "C:\\nonexistent\\WindowsPowerShell\\v1.0\\powershell.exe",
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "/nonexistent/security",
    "C:\\nonexistent\\System32\\cmdkey.exe"
  ])
    assert.throws(() => spawnSync(tool, ["-Command", "-"]), /use a fake or spy runner/u, tool);
});
