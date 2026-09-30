// invariant: #379's real-store qualification (`pnpm qualify:keychain`), never
// a gate suite: the real `vestra` binary as a child process against each
// platform's own credential store, confined to something disposable.
// - darwin: every `secret` and `doctor` launch carries `--keychain` naming a
//   disposable keychain file (launch() refuses otherwise), whose attribute
//   dump proves which items remain. Nothing touches the login keychain.
// - linux: the child inherits a disposable D-Bus session and gnome-keyring
//   daemon (launch() refuses unless the environment names it), whose search
//   proves which items remain. Nothing reaches the user's session bus.
// - win32: the Workspace ID is random, so every target is new, and each is
//   deleted in `finally`; `cmdkey` witnesses which targets remain.
// On any other platform the journeys assert the store is honestly not
// configured. Nothing is skipped.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { createOsCredentialStore } from "../../../packages/platform-node/src/index.ts";
import { isListed, randomWorkspaceId } from "./disposable-credential-target.mjs";
import { createDisposableKeychain } from "./disposable-keychain.mjs";
import { createDisposableSecretService } from "./disposable-secret-service.mjs";

const PLATFORM = process.platform;
const QUALIFIED = new Set(["darwin", "linux", "win32"]).has(PLATFORM);
const STORE_IDS = Object.freeze({
  darwin: "apple-keychain-credential",
  linux: "secret-service-credential",
  win32: "windows-credential-manager"
});
const VESTRA = fileURLToPath(new URL("../../../apps/vestra-cli/bin/vestra.mjs", import.meta.url));
const SENTINEL = "sk-ant-e2e-sentinel-4c1d";
const SENTINEL_HEX = Buffer.from(SENTINEL).toString("hex");
const SENTINEL_BASE64 = Buffer.from(SENTINEL).toString("base64");
const NAMES = ["anthropic-api-key"];
const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

let activeSession;

function launch(args, cwd, input = "") {
  const scoped = args[0] === "doctor" || (args[0] === "secret" && args.length > 1);
  if (PLATFORM === "darwin" && scoped && !args.includes("--keychain"))
    throw new Error(`vestra ${args.slice(0, 2).join(" ")} must name a disposable keychain on darwin`);
  if (
    PLATFORM === "linux" &&
    scoped &&
    (activeSession === undefined || process.env.DBUS_SESSION_BUS_ADDRESS !== activeSession.address)
  )
    throw new Error(`vestra ${args.slice(0, 2).join(" ")} must run inside the disposable Secret Service on linux`);
  const result = spawnSync(process.execPath, [VESTRA, ...args], {
    cwd,
    input,
    encoding: "utf8",
    timeout: 90_000,
    killSignal: "SIGKILL",
    env: { ...process.env, NO_COLOR: "1" }
  });
  assert.notEqual(result.signal, "SIGKILL", `vestra ${args.join(" ")} timed out`);
  return result;
}

async function workspace(workspaceId) {
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

function secretPresence(root, storeArgs) {
  const codes = json(launch(["doctor", "--deep", "--output", "json", ...storeArgs], root)).data["doctor.check_codes"];
  return codes.find((code) => code.startsWith("doctor.secret-presence:"));
}

function assertNoValue(text, label) {
  assert.equal(text.includes(SENTINEL), false, `${label} carries the raw value`);
  assert.equal(text.toLowerCase().includes(SENTINEL_HEX), false, `${label} carries the hex-encoded value`);
  assert.equal(text.includes(SENTINEL_BASE64), false, `${label} carries the base64-encoded value`);
}

// invariant: each platform's disposable store, and the witness that lists
// exactly which of this Workspace's items it holds.
async function withPlatformStore(workspaceId, body) {
  const namespace = `verchestra/${workspaceId}`;
  if (PLATFORM === "darwin") {
    const keychain = await createDisposableKeychain();
    try {
      const prefix = `${namespace}\u0000`;
      await body({
        storeArgs: ["--keychain", keychain.path],
        items: () => keychain.items().filter((entry) => entry.startsWith(prefix)).map((entry) => entry.slice(prefix.length))
      });
    } finally {
      await keychain.dispose();
    }
    return;
  }
  if (PLATFORM === "linux") {
    activeSession = await createDisposableSecretService();
    try {
      const prefix = `${namespace}\u0000`;
      await body({
        storeArgs: [],
        items: () => activeSession.items(namespace).map((entry) => entry.slice(prefix.length))
      });
    } finally {
      await activeSession.dispose();
      activeSession = undefined;
    }
    return;
  }
  try {
    await body({ storeArgs: [], items: () => NAMES.filter((name) => isListed(`${namespace}/${name}`)) });
  } finally {
    const cleanup = createOsCredentialStore({ platform: "win32" });
    for (const name of NAMES) await cleanup.delete(workspaceId, name);
    for (const name of NAMES) assert.equal(isListed(`${namespace}/${name}`), false, `cleanup left ${name}`);
  }
}

// why: a refusal case must not reach a real store even if a regression let it
// through, so on a qualified platform it runs inside the same confinement.
function confined(workspaceId, body) {
  return QUALIFIED ? withPlatformStore(workspaceId, body) : body({ storeArgs: [], items: () => [] });
}

test(
  `${PLATFORM}: set, status, doctor, and delete journey against the platform credential store`,
  { timeout: 300_000 },
  async (t) => {
    const workspaceId = randomWorkspaceId();
    const root = await workspace(workspaceId);
    if (!QUALIFIED) {
      t.diagnostic(`${PLATFORM}: asserting the store is not configured instead`);
      const status = launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json"], root);
      assert.equal(status.status, 5);
      assert.equal(json(status).error.code, "VES_SECRET_STORE_UNQUALIFIED");
      assert.equal(secretPresence(root, []), "doctor.secret-presence:blocked");
      return;
    }
    await withPlatformStore(workspaceId, async ({ storeArgs, items }) => {
      assert.equal(secretPresence(root, storeArgs), "doctor.secret-presence:blocked");
      const set = launch(["secret", "set", "--name", "anthropic-api-key", ...storeArgs], root, `${SENTINEL}\n`);
      assert.equal(set.status, 0, set.stderr);
      assertNoValue(set.stdout, "stdout");
      assertNoValue(set.stderr, "stderr");
      assert.match(set.stdout, /stored: true/u);
      assert.match(set.stdout, PLATFORM === "darwin" ? /keychain: explicit/u : /keychain: default/u);
      const status = json(
        launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...storeArgs], root)
      );
      assert.deepEqual(status.data, {
        workspaceId,
        logicalName: "anthropic-api-key",
        store: STORE_IDS[PLATFORM],
        keychain: PLATFORM === "darwin" ? "explicit" : "default",
        present: true
      });
      assert.equal(secretPresence(root, storeArgs), "doctor.secret-presence:pass");
      assert.deepEqual(items(), ["anthropic-api-key"]);
      const rotate = launch(["secret", "set", "--name", "anthropic-api-key", ...storeArgs], root, "sk-ant-rotated");
      assert.equal(rotate.status, 0, rotate.stderr);
      assert.deepEqual(items(), ["anthropic-api-key"]);
      const removed = json(
        launch(["secret", "delete", "--name", "anthropic-api-key", "--output", "json", ...storeArgs], root)
      );
      assert.equal(removed.data.deleted, true);
      const again = json(
        launch(["secret", "delete", "--name", "anthropic-api-key", "--output", "json", ...storeArgs], root)
      );
      assert.equal(again.data.deleted, false);
      const gone = json(
        launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...storeArgs], root)
      );
      assert.equal(gone.data.present, false);
      assert.equal(secretPresence(root, storeArgs), "doctor.secret-presence:blocked");
      assert.deepEqual(items(), []);
    });
  }
);

test(`${PLATFORM}: an oversize or empty value is refused and never echoed`, { timeout: 180_000 }, async (t) => {
  const workspaceId = randomWorkspaceId();
  const root = await workspace(workspaceId);
  if (!QUALIFIED) {
    t.diagnostic(`${PLATFORM}: asserting the store is not configured instead`);
    const set = launch(["secret", "set", "--name", "anthropic-api-key"], root, SENTINEL);
    assert.equal(set.status, 5);
    assert.match(set.stderr, /^VES_SECRET_STORE_UNQUALIFIED:/u);
    return;
  }
  await withPlatformStore(workspaceId, async ({ storeArgs, items }) => {
    for (const input of [`${SENTINEL}${"A".repeat(4096)}`, "", "\n", "has space"]) {
      const set = launch(["secret", "set", "--name", "anthropic-api-key", ...storeArgs], root, input);
      assert.equal(set.status, 5);
      assert.match(set.stderr, /^VES_SECRET_VALUE_INVALID:/u);
      assertNoValue(set.stdout, "stdout");
      assertNoValue(set.stderr, "stderr");
    }
    const status = json(
      launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...storeArgs], root)
    );
    assert.equal(status.data.present, false);
    assert.deepEqual(items(), []);
  });
});

test(`${PLATFORM}: an unusable --keychain path is refused before any store command`, { timeout: 120_000 }, async () => {
  const workspaceId = randomWorkspaceId();
  const root = await workspace(workspaceId);
  const expected = QUALIFIED ? "VES_SECRET_KEYCHAIN_INVALID" : "VES_SECRET_STORE_UNQUALIFIED";
  await confined(workspaceId, async () => {
    for (const path of [join(root, "missing.keychain-db"), "relative.keychain-db", join(root, ".verchestra")]) {
      const set = launch(
        ["secret", "set", "--name", "anthropic-api-key", "--keychain", path, "--output", "json"],
        root,
        SENTINEL
      );
      assert.equal(set.status, 5);
      assert.equal(json(set).error.code, expected, path);
    }
  });
});

test("secret commands refuse an uninitialized directory and an invalid name", { timeout: 120_000 }, async () => {
  const bare = await mkdtemp(join(tmpdir(), "verchestra-secret-bare-"));
  roots.push(bare);
  const workspaceId = randomWorkspaceId();
  const root = await workspace(workspaceId);
  // invariant: this keychain is never created; every case below is refused
  // before a store is consulted, and still runs confined in case it is not.
  const never = ["--keychain", join(bare, "never-created.keychain-db")];
  await confined(workspaceId, async () => {
    const outside = launch(["secret", "status", "--name", "anthropic-api-key", "--output", "json", ...never], bare);
    assert.equal(outside.status, 5);
    assert.equal(json(outside).error.code, "VES_INIT_WORKSPACE_MISSING");
    for (const name of ["UPPER", "../escape", "x"]) {
      const invalid = launch(["secret", "status", "--name", name, "--output", "json", ...never], root);
      assert.equal(invalid.status, 2, name);
      assert.equal(json(invalid).error.code, "VES_CLI_ARGUMENT_INVALID");
    }
    assert.equal(launch(["secret"], root).status, 2);
  });
});
