// invariant: #379 end to end through the real `vestra` binary as a child
// process. On darwin every keychain operation targets a disposable keychain
// passed with `--keychain`, never the login keychain; on any other platform
// the same journeys assert the store is honestly not configured.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { createDisposableKeychain, searchListLookupStatus } from "../helpers/disposable-keychain.mjs";

const DARWIN = process.platform === "darwin";
const VESTRA = fileURLToPath(new URL("../../apps/vestra-cli/bin/vestra.mjs", import.meta.url));
const SENTINEL = "sk-ant-e2e-sentinel-4c1d";
const SENTINEL_HEX = Buffer.from(SENTINEL).toString("hex");
const workspaceId = "workspace_3a9b8c7d-6e5f-4a1b-8c2d-3e4f5a6b7c8d";
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

function launch(args, cwd, input = "") {
  const result = spawnSync(process.execPath, [VESTRA, ...args], {
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

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), "verchestra-secret-e2e-"));
  roots.push(root);
  spawnSync("git", ["init", "--quiet", root], { timeout: 30_000 });
  const init = launch(
    ["init", "--workspace-id", workspaceId, "--name", "Secret E2E", "--placement", "colocated"],
    root
  );
  assert.equal(init.status, 0, init.stderr);
  return root;
}

function json(result) {
  return JSON.parse(result.stdout);
}

function secretPresence(root, keychain) {
  const args = ["doctor", "--deep", "--output", "json", ...(keychain === undefined ? [] : ["--keychain", keychain])];
  const codes = json(launch(args, root)).data["doctor.check_codes"];
  return codes.find((code) => code.startsWith("doctor.secret-presence:"));
}

function assertNoValue(text, label) {
  assert.equal(text.includes(SENTINEL), false, `${label} carries the raw value`);
  assert.equal(text.toLowerCase().includes(SENTINEL_HEX), false, `${label} carries the hex-encoded value`);
}

test(
  "darwin: set, status, doctor, and delete journey against a disposable keychain",
  { timeout: 180_000 },
  async (t) => {
    const root = await workspace();
    if (!DARWIN) {
      t.diagnostic(`not darwin (${process.platform}): asserting the store is not configured instead`);
      const status = launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json"], root);
      assert.equal(status.status, 5);
      assert.equal(json(status).error.code, "VES_SECRET_STORE_UNQUALIFIED");
      assert.equal(secretPresence(root), "doctor.secret-presence:blocked");
      return;
    }
    const keychain = await createDisposableKeychain();
    try {
      const kc = ["--keychain", keychain.path];
      assert.equal(secretPresence(root, keychain.path), "doctor.secret-presence:blocked");
      const set = launch(["secret", "set", "--name", "anthropic-api-key", ...kc], root, `${SENTINEL}\n`);
      assert.equal(set.status, 0, set.stderr);
      assertNoValue(set.stdout, "stdout");
      assertNoValue(set.stderr, "stderr");
      assert.match(set.stdout, /stored: true/u);
      assert.match(set.stdout, /keychain: explicit/u);
      const status = json(launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...kc], root));
      assert.deepEqual(status.data, {
        workspaceId,
        logicalName: "anthropic-api-key",
        store: "apple-keychain-credential",
        keychain: "explicit",
        present: true
      });
      assert.equal(secretPresence(root, keychain.path), "doctor.secret-presence:pass");
      const rotate = launch(["secret", "set", "--name", "anthropic-api-key", ...kc], root, "sk-ant-rotated");
      assert.equal(rotate.status, 0, rotate.stderr);
      const removed = json(
        launch(["secret", "delete", "--name", "anthropic-api-key", "--output", "json", ...kc], root)
      );
      assert.equal(removed.data.deleted, true);
      const again = json(launch(["secret", "delete", "--name", "anthropic-api-key", "--output", "json", ...kc], root));
      assert.equal(again.data.deleted, false);
      const after = json(launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...kc], root));
      assert.equal(after.data.present, false);
      assert.equal(secretPresence(root, keychain.path), "doctor.secret-presence:blocked");
    } finally {
      await keychain.dispose();
    }
    assert.equal(searchListLookupStatus(`verchestra/${workspaceId}`), 44, "the login keychain was never written");
  }
);

test("darwin: an oversize or empty value is refused and never echoed", { timeout: 120_000 }, async (t) => {
  const root = await workspace();
  if (!DARWIN) {
    t.diagnostic(`not darwin (${process.platform}): asserting the store is not configured instead`);
    const set = launch(["secret", "set", "--name", "anthropic-api-key"], root, SENTINEL);
    assert.equal(set.status, 5);
    assert.match(set.stderr, /^VES_SECRET_STORE_UNQUALIFIED:/u);
    return;
  }
  const keychain = await createDisposableKeychain();
  try {
    const kc = ["--keychain", keychain.path];
    for (const input of [`${SENTINEL}${"A".repeat(4096)}`, "", "\n", "has space"]) {
      const set = launch(["secret", "set", "--name", "anthropic-api-key", ...kc], root, input);
      assert.equal(set.status, 5);
      assert.match(set.stderr, /^VES_SECRET_VALUE_INVALID:/u);
      assertNoValue(set.stdout, "stdout");
      assertNoValue(set.stderr, "stderr");
    }
    const status = json(launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...kc], root));
    assert.equal(status.data.present, false);
  } finally {
    await keychain.dispose();
  }
  assert.equal(searchListLookupStatus(`verchestra/${workspaceId}`), 44, "the login keychain was never written");
});

test("an unusable --keychain path is refused before any keychain command", { timeout: 60_000 }, async () => {
  const root = await workspace();
  const expected = DARWIN ? "VES_SECRET_KEYCHAIN_INVALID" : "VES_SECRET_STORE_UNQUALIFIED";
  for (const path of [join(root, "missing.keychain-db"), "relative.keychain-db", join(root, ".verchestra")]) {
    const set = launch(
      ["secret", "set", "--name", "anthropic-api-key", "--keychain", path, "--output", "json"],
      root,
      SENTINEL
    );
    assert.equal(set.status, 5);
    assert.equal(json(set).error.code, expected, path);
  }
  if (DARWIN) assert.equal(searchListLookupStatus(`verchestra/${workspaceId}`), 44);
});

test("secret commands refuse an uninitialized directory and an invalid name", { timeout: 60_000 }, async () => {
  const bare = await mkdtemp(join(tmpdir(), "verchestra-secret-bare-"));
  roots.push(bare);
  const outside = launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json"], bare);
  assert.equal(outside.status, 5);
  assert.equal(json(outside).error.code, "VES_INIT_WORKSPACE_MISSING");
  const root = await workspace();
  for (const name of ["UPPER", "../escape", "x"]) {
    const invalid = launch(["secret", "status", "--name", name, "--output", "json"], root);
    assert.equal(invalid.status, 2, name);
    assert.equal(json(invalid).error.code, "VES_CLI_ARGUMENT_INVALID");
  }
  const bareSecret = launch(["secret"], root);
  assert.equal(bareSecret.status, 2);
});
