// invariant: #379's real Secret Service qualification (`pnpm qualify:keychain`),
// never a gate suite: the Linux backend against the real `secret-tool` and a
// disposable D-Bus session and gnome-keyring daemon with a temporary HOME.
// Every call goes through a runner that refuses to spawn unless the child
// environment names that disposable bus, and the keyring's own search proves
// exactly which items a case left. Nothing here reaches the invoking user's
// session bus or login keyring. On any other platform the same cases assert,
// not skip, that this backend is not selected and cannot reach a store.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LinuxSecretServiceBackend,
  searchItemsArguments,
  MAX_CREDENTIAL_VALUE_BYTES,
  PRESENCE_TIMEOUT_MS,
  createOsCredentialStore,
  nodeSecretServiceRunner
} from "../../../packages/platform-node/src/index.ts";
import { createDisposableSecretService, dbusSend, secretTool, sessionBoundRunner } from "./disposable-secret-service.mjs";

const LINUX = process.platform === "linux";
const workspaceId = "workspace_6e2f1a0b-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const namespace = `verchestra/${workspaceId}`;
const item = (logicalName) => `${namespace}\u0000${logicalName}`;
const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);

async function refusedElsewhere(t) {
  t.diagnostic(`not linux (${process.platform}): asserting the Secret Service backend is refused instead`);
  const own = new Set(["darwin", "win32"]).has(process.platform)
    ? createOsCredentialStore({ platform: process.platform }).storeId
    : undefined;
  assert.notEqual(own, "secret-service-credential");
  const backend = new LinuxSecretServiceBackend({ runner: nodeSecretServiceRunner });
  await assert.rejects(backend.has({ namespace, logicalName: "anthropic-api-key" }), {
    code: "VES_SECRET_STORE_UNAVAILABLE"
  });
}

async function withSession(body) {
  const session = await createDisposableSecretService();
  try {
    const bound = sessionBoundRunner(session);
    const store = createOsCredentialStore({ platform: "linux", runner: bound.runner });
    await body({ session, store, bound });
  } finally {
    await session.dispose();
  }
}

test(
  "linux: set, has, read, rotate, and delete round-trip in a disposable Secret Service",
  { timeout: 120_000 },
  async (t) => {
    if (!LINUX) return refusedElsewhere(t);
    await withSession(async ({ session, store, bound }) => {
      assert.equal(store.storeId, "secret-service-credential");
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.read(workspaceId, "anthropic-api-key"), undefined);
      const first = "sk-ant-disposable-~!@#$%^&*()_+{}|:<>?`-=[];,./'\"\\";
      await store.store(workspaceId, "anthropic-api-key", encode(first));
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), true);
      assert.equal(decode(await store.adapter.read(workspaceId, "anthropic-api-key")), first);
      await store.store(workspaceId, "anthropic-api-key", encode("sk-ant-rotated"));
      assert.equal(decode(await store.adapter.read(workspaceId, "anthropic-api-key")), "sk-ant-rotated");
      assert.deepEqual(session.items(namespace), [item("anthropic-api-key")], "a rotation replaces the item");
      await store.store(workspaceId, "openai-api-key", encode("A".repeat(MAX_CREDENTIAL_VALUE_BYTES)));
      assert.equal((await store.adapter.read(workspaceId, "openai-api-key")).length, MAX_CREDENTIAL_VALUE_BYTES);
      assert.deepEqual(session.items(namespace), [item("anthropic-api-key"), item("openai-api-key")]);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), true);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.deepEqual(session.items(namespace), [item("openai-api-key")]);
      for (const command of ["SearchItems", "lookup", "store", "clear"]) assert.ok(bound.commands.includes(command), command);
    });
  }
);

test(
  "linux: the tool conventions the backend relies on hold on the real secret-tool and dbus-send",
  { timeout: 120_000 },
  async (t) => {
    if (!LINUX) return refusedElsewhere(t);
    await withSession(async ({ session, store }) => {
      const attributes = ["service", namespace, "account", "anthropic-api-key"];
      const missing = secretTool(session, ["lookup", ...attributes]);
      assert.deepEqual([missing.status, missing.stdout, missing.stderr], [1, "", ""], "a miss exits 1 silently");
      const clear = secretTool(session, ["clear", ...attributes]);
      assert.deepEqual([clear.status, clear.stdout, clear.stderr], [1, "", ""], "clearing nothing exits 1 silently");
      await store.store(workspaceId, "anthropic-api-key", encode("sk-ant-exact"));
      const found = secretTool(session, ["lookup", ...attributes]);
      assert.deepEqual([found.status, found.stdout], [0, "sk-ant-exact"], "a piped lookup prints exactly the value");
      // why: the reason presence does not use `secret-tool search` — it loads
      // and prints the secret along with the attributes.
      const searched = secretTool(session, ["search", ...attributes]);
      assert.equal(searched.status, 0);
      assert.match(`${searched.stdout}${searched.stderr}`, /^secret = sk-ant-exact$/mu);
      const reply = dbusSend(session, searchItemsArguments({ namespace, logicalName: "anthropic-api-key" }));
      t.diagnostic(`SearchItems reply: ${JSON.stringify(reply.stdout)}`);
      assert.equal(reply.status, 0, reply.stderr);
      assert.equal(reply.stdout.includes("sk-ant-exact"), false, "SearchItems never carries the secret");
      assert.match(reply.stdout, /^method return /u);
      assert.equal(reply.stdout.match(/^ *array \[/gmu)?.length, 2);
      await store.delete(workspaceId, "anthropic-api-key");
    });
  }
);

test(
  "linux: presence never receives the value, and finishes inside the doctor's budget",
  { timeout: 120_000 },
  async (t) => {
    if (!LINUX) return refusedElsewhere(t);
    await withSession(async ({ session, bound }) => {
      const observed = [];
      const recording = async (invocation) => {
        const result = await bound.runner(invocation);
        observed.push({ tool: invocation.tool, args: invocation.args, output: `${result.stdout}${result.stderr}` });
        return result;
      };
      const store = createOsCredentialStore({ platform: "linux", runner: recording });
      await store.store(workspaceId, "anthropic-api-key", encode("sk-ant-presence-sentinel"));
      observed.length = 0;
      const started = performance.now();
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), true);
      const elapsed = performance.now() - started;
      t.diagnostic(`presence took ${Math.round(elapsed)} ms`);
      assert.ok(elapsed < PRESENCE_TIMEOUT_MS, `presence took ${elapsed} ms`);
      assert.equal(observed.length, 1);
      assert.equal(observed[0].tool, "dbus-send");
      assert.deepEqual(observed[0].args, searchItemsArguments({ namespace, logicalName: "anthropic-api-key" }));
      assert.equal(observed[0].output.includes("sk-ant-presence-sentinel"), false);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), true);
      assert.deepEqual(session.items(namespace), []);
    });
  }
);

test("linux: a session without a reachable Secret Service is not configured", { timeout: 120_000 }, async (t) => {
  if (!LINUX) return refusedElsewhere(t);
  await withSession(async ({ session }) => {
    const absentBus = `unix:path=${session.runtime}/no-such-bus`;
    // invariant: this runner only ever names a socket inside the disposable
    // directory that does not exist, so it cannot reach any real bus.
    const nowhere = async (invocation) => {
      const saved = process.env.DBUS_SESSION_BUS_ADDRESS;
      process.env.DBUS_SESSION_BUS_ADDRESS = absentBus;
      try {
        return await nodeSecretServiceRunner(invocation);
      } finally {
        process.env.DBUS_SESSION_BUS_ADDRESS = saved;
      }
    };
    const store = createOsCredentialStore({ platform: "linux", runner: nowhere });
    await assert.rejects(store.adapter.has(workspaceId, "anthropic-api-key"), { code: "VES_SECRET_STORE_UNAVAILABLE" });
    await assert.rejects(store.store(workspaceId, "anthropic-api-key", encode("sk-ant-nowhere")), {
      code: "VES_SECRET_STORE_UNAVAILABLE"
    });
    assert.deepEqual(session.items(namespace), []);
  });
});

test("linux: a locked collection needs the user, and is never reported absent or read", { timeout: 120_000 }, async (t) => {
  if (!LINUX) return refusedElsewhere(t);
  await withSession(async ({ session, store }) => {
    await store.store(workspaceId, "anthropic-api-key", encode("sk-ant-locked-sentinel"));
    const lock = secretTool(session, ["lock", "--collection=login"]);
    assert.equal(lock.status, 0, lock.stderr);
    // hazard: measured — with no prompter in the session, a lookup of a
    // locked item misses silently, exactly like a missing item.
    const attributes = ["service", namespace, "account", "anthropic-api-key"];
    const lookup = secretTool(session, ["lookup", ...attributes]);
    assert.deepEqual([lookup.status, lookup.stdout, lookup.stderr], [1, "", ""]);
    for (const [label, operation] of [
      ["has", () => store.adapter.has(workspaceId, "anthropic-api-key")],
      ["read", () => store.adapter.read(workspaceId, "anthropic-api-key")],
      ["delete", () => store.delete(workspaceId, "anthropic-api-key")],
      ["store", () => store.store(workspaceId, "anthropic-api-key", encode("sk-ant-while-locked"))]
    ]) {
      const started = performance.now();
      await assert.rejects(operation(), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" }, label);
      t.diagnostic(`${label} on a locked collection: interaction required after ${Math.round(performance.now() - started)} ms`);
    }
    const store2 = secretTool(session, ["store", "--label=probe", ...attributes], "sk-ant-probe");
    t.diagnostic(`secret-tool store on a locked collection: exit ${store2.status}, stderr ${JSON.stringify(store2.stderr.trim())}`);
  });
});

test("linux: an oversize or unprintable value never reaches secret-tool", { timeout: 120_000 }, async (t) => {
  if (!LINUX) return refusedElsewhere(t);
  await withSession(async ({ session, store, bound }) => {
    for (const value of [new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41), encode("has space"), new Uint8Array()])
      await assert.rejects(store.store(workspaceId, "anthropic-api-key", value), { code: "VES_SECRET_VALUE_INVALID" });
    assert.deepEqual(bound.commands, []);
    assert.deepEqual(session.items(namespace), []);
  });
});

test("linux: a keychain path is refused rather than ignored", { timeout: 60_000 }, async (t) => {
  if (!LINUX) return refusedElsewhere(t);
  assert.throws(() => createOsCredentialStore({ platform: "linux", keychainPath: "/tmp/x.keychain-db" }), {
    code: "VES_SECRET_KEYCHAIN_INVALID"
  });
});
