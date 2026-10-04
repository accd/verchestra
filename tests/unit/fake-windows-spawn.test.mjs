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
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

import { createOsCredentialStore } from "../../packages/platform-node/src/index.ts";
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
