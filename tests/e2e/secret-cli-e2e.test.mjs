// invariant: #379's `vestra secret` refusals end to end through the real binary
// as a child process. Every case is refused before a credential store is
// consulted, and each child runs with tests/helpers/deny-keychain-spawn.mjs
// preloaded, so a regression that reached `security`, `secret-tool`, or
// PowerShell fails here instead of touching a real store. The real-store
// journeys (set, status, doctor pass, delete) are the standalone
// `pnpm qualify:keychain` suite in spikes/os-secret-store.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { DENY_KEYCHAIN_SPAWN } from "../helpers/deny-keychain-spawn.mjs";

const DARWIN = process.platform === "darwin";
const QUALIFIED = new Set(["darwin", "linux", "win32"]).has(process.platform);
const VESTRA = fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url));
const SENTINEL = "sk-ant-e2e-sentinel-4c1d";
const SENTINEL_HEX = Buffer.from(SENTINEL).toString("hex");
const workspaceId = "workspace_3a9b8c7d-6e5f-4a1b-8c2d-3e4f5a6b7c8d";
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

function launch(args, cwd, input = "") {
  const result = spawnSync(process.execPath, ["--import", DENY_KEYCHAIN_SPAWN.href, VESTRA, ...args], {
    cwd,
    input,
    encoding: "utf8",
    timeout: 60_000,
    killSignal: "SIGKILL",
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.notEqual(result.signal, "SIGKILL", `vestra ${args.join(" ")} timed out`);
  return result;
}

async function scratch(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function workspace() {
  const root = await scratch("verchestra-secret-e2e-");
  spawnSync("git", ["init", "--quiet", root], { timeout: 30_000 });
  const init = launch(
    ["init", "--workspace-id", workspaceId, "--name", "Secret E2E", "--placement", "colocated"],
    root
  );
  assert.equal(init.status, 0, init.stderr);
  return root;
}

// invariant: a file with the keychain magic passes the backend's pre-spawn
// check but is never handed to `security`: every case using it is refused on
// the value first.
async function fakeKeychain(root) {
  const path = join(root, "fake.keychain-db");
  await writeFile(path, Buffer.concat([Buffer.from("kych"), Buffer.alloc(60)]));
  return path;
}

function json(result) {
  return JSON.parse(result.stdout);
}

function assertNoValue(text, label) {
  assert.equal(text.includes(SENTINEL), false, `${label} carries the raw value`);
  assert.equal(text.toLowerCase().includes(SENTINEL_HEX), false, `${label} carries the hex-encoded value`);
}

test("the preloaded guard refuses to spawn any credential tool in the child", async () => {
  for (const tool of ["/nonexistent/security", "/nonexistent/secret-tool", "C:\\\\nonexistent\\\\powershell.exe"]) {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        DENY_KEYCHAIN_SPAWN.href,
        "--input-type=module",
        "-e",
        `import { spawnSync } from "node:child_process"; try { spawnSync(${JSON.stringify(tool)}, ["help"]); process.exit(3); } catch { process.exit(0); }`
      ],
      { encoding: "utf8", timeout: 30_000 }
    );
    assert.equal(result.status, 0, `${tool}: ${result.stderr}`);
  }
});

test("an oversize, empty, or whitespace value is refused and never echoed", { timeout: 120_000 }, async () => {
  const root = await workspace();
  // invariant: on darwin a file with the keychain magic passes the pre-spawn
  // check; on linux and win32 no flag is passed. Either way the value is
  // refused before any store program could run, and the preloaded guard would
  // fail the child if one did.
  const store = DARWIN ? ["--keychain", await fakeKeychain(root)] : [];
  for (const input of [`${SENTINEL}${"A".repeat(4096)}`, "", "\n", "has space"]) {
    const set = launch(["secret", "set", "--name", "anthropic-api-key", ...store], root, input);
    assert.equal(set.status, 5);
    assert.match(set.stderr, QUALIFIED ? /^VES_SECRET_VALUE_INVALID:/u : /^VES_SECRET_STORE_UNQUALIFIED:/u);
    assertNoValue(set.stdout, "stdout");
    assertNoValue(set.stderr, "stderr");
  }
});

test("an unusable --keychain path is refused before any store command", { timeout: 60_000 }, async () => {
  const root = await workspace();
  // why: on darwin the path fails the keychain-file check; on linux and win32
  // the flag itself is refused, since a keychain file is a macOS concept.
  const expected = QUALIFIED ? "VES_SECRET_KEYCHAIN_INVALID" : "VES_SECRET_STORE_UNQUALIFIED";
  const junk = join(root, "junk.keychain-db");
  await writeFile(junk, "not a keychain");
  for (const path of [join(root, "missing.keychain-db"), "relative.keychain-db", join(root, ".verchestra"), junk]) {
    for (const command of ["set", "status", "delete"]) {
      const result = launch(
        ["secret", command, "--name", "anthropic-api-key", "--keychain", path, "--output", "json"],
        root,
        SENTINEL
      );
      assert.equal(result.status, 5);
      assert.equal(json(result).error.code, expected, `${command} ${path}`);
    }
  }
});

test("secret commands refuse an uninitialized directory and an invalid name", { timeout: 60_000 }, async () => {
  const bare = await scratch("verchestra-secret-bare-");
  const outside = launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json"], bare);
  assert.equal(outside.status, 5);
  assert.equal(json(outside).error.code, "VES_INIT_WORKSPACE_MISSING");
  const root = await workspace();
  for (const name of ["UPPER", "../escape", "x"]) {
    const invalid = launch(["secret", "status", "--name", name, "--output", "json"], root);
    assert.equal(invalid.status, 2, name);
    assert.equal(json(invalid).error.code, "VES_CLI_ARGUMENT_INVALID");
  }
  assert.equal(launch(["secret"], root).status, 2);
});

test("the help lists the secret commands", () => {
  const help = launch(["--help"], process.cwd());
  assert.equal(help.status, 0);
  for (const command of ["secret set", "secret status", "secret delete"]) assert.ok(help.stdout.includes(command));
});
