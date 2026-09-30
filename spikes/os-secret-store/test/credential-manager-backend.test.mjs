// invariant: #379's real Credential Manager qualification (`pnpm qualify:keychain`),
// never a gate suite: the Windows backend against real Windows PowerShell and
// advapi32. Credential Manager has no disposable instance, so every case works
// only under a fresh random Workspace ID and deletes its targets in `finally`;
// `cmdkey`, a separate program, witnesses what exists and how it persists. On
// any other platform the same cases assert, not skip, that this backend is not
// selected and cannot reach a store.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_CREDENTIAL_VALUE_BYTES,
  PRESENCE_TIMEOUT_MS,
  WindowsCredentialManagerBackend,
  createOsCredentialStore,
  nodeCredentialManagerRunner
} from "../../../packages/platform-node/src/index.ts";
import { describeTarget, isListed, withRandomTargets } from "./disposable-credential-target.mjs";

const WIN32 = process.platform === "win32";
const NAMES = ["anthropic-api-key", "openai-api-key"];
const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);

async function refusedElsewhere(t) {
  t.diagnostic(`not win32 (${process.platform}): asserting the Credential Manager backend is refused instead`);
  const own = new Set(["darwin", "linux"]).has(process.platform)
    ? createOsCredentialStore({ platform: process.platform }).storeId
    : undefined;
  assert.notEqual(own, "windows-credential-manager");
  const backend = new WindowsCredentialManagerBackend({ runner: nodeCredentialManagerRunner });
  await assert.rejects(
    backend.has({ namespace: "verchestra/workspace_6e2f1a0b-3c4d-4e5f-8a9b-0c1d2e3f4a5b", logicalName: "anthropic-api-key" }),
    { code: "VES_SECRET_STORE_UNAVAILABLE" }
  );
}

test(
  "win32: set, has, read, rotate, and delete round-trip under a random target prefix",
  { timeout: 180_000 },
  async (t) => {
    if (!WIN32) return refusedElsewhere(t);
    await withRandomTargets(NAMES, async ({ workspaceId, store, target }) => {
      assert.equal(store.storeId, "windows-credential-manager");
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.read(workspaceId, "anthropic-api-key"), undefined);
      const first = "sk-ant-disposable-~!@#$%^&*()_+{}|:<>?`-=[];,./'\"\\";
      await store.store(workspaceId, "anthropic-api-key", encode(first));
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), true);
      assert.equal(decode(await store.adapter.read(workspaceId, "anthropic-api-key")), first);
      await store.store(workspaceId, "anthropic-api-key", encode("sk-ant-rotated"));
      assert.equal(decode(await store.adapter.read(workspaceId, "anthropic-api-key")), "sk-ant-rotated");
      await store.store(workspaceId, "openai-api-key", encode("A".repeat(MAX_CREDENTIAL_VALUE_BYTES)));
      assert.equal((await store.adapter.read(workspaceId, "openai-api-key")).length, MAX_CREDENTIAL_VALUE_BYTES);
      const witness = describeTarget(target("anthropic-api-key"));
      t.diagnostic(witness.trim().replaceAll(/\s+/gu, " "));
      assert.match(witness, /Type: Generic/u);
      assert.match(witness, /User: anthropic-api-key/u);
      assert.match(witness, /Local machine persistence/u);
      assert.equal(isListed(target("openai-api-key")), true);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), true);
      assert.equal(await store.delete(workspaceId, "anthropic-api-key"), false);
      assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), false);
      assert.equal(isListed(target("anthropic-api-key")), false);
      assert.equal(isListed(target("openai-api-key")), true);
    });
  }
);

test(
  "win32: the value never appears in PowerShell's output or argv, and presence never returns it",
  { timeout: 180_000 },
  async (t) => {
    if (!WIN32) return refusedElsewhere(t);
    const sentinel = "sk-ant-powershell-sentinel-7c2e";
    const encoded = Buffer.from(sentinel).toString("base64");
    const observed = [];
    const recording = async (invocation) => {
      const result = await nodeCredentialManagerRunner(invocation);
      observed.push({ args: invocation.args.join(" "), stdout: result.stdout, stderr: result.stderr });
      return result;
    };
    await withRandomTargets(
      NAMES,
      async ({ workspaceId, store }) => {
        await store.store(workspaceId, "anthropic-api-key", encode(sentinel));
        const writes = observed.length;
        const started = performance.now();
        assert.equal(await store.adapter.has(workspaceId, "anthropic-api-key"), true);
        const elapsed = performance.now() - started;
        t.diagnostic(`presence took ${Math.round(elapsed)} ms`);
        assert.ok(elapsed < PRESENCE_TIMEOUT_MS, `presence took ${elapsed} ms`);
        for (const { args, stdout, stderr } of observed) {
          for (const text of [args, stderr, stdout]) {
            assert.equal(text.includes(sentinel), false, "the raw value crossed a boundary it must not");
            assert.equal(text.includes(encoded), false, "the base64 value crossed a boundary it must not");
          }
        }
        assert.equal(observed.slice(writes).length, 1);
        assert.match(observed.at(-1).args, /^\/list:verchestra\/workspace_[0-9a-f-]{36}\/anthropic-api-key$/u);
        assert.ok(
          observed
            .at(-1)
            .stdout.split(/\r?\n/u)
            .some((line) => /^\s*\S[^:]*: verchestra\/workspace_[0-9a-f-]{36}\/anthropic-api-key$/u.test(line)),
          "presence is cmdkey's target line"
        );
      },
      { runner: recording }
    );
  }
);

test("win32: an oversize or unprintable value never reaches PowerShell", { timeout: 120_000 }, async (t) => {
  if (!WIN32) return refusedElsewhere(t);
  const spawned = [];
  const counting = async (invocation) => {
    spawned.push(invocation.args[0]);
    return nodeCredentialManagerRunner(invocation);
  };
  await withRandomTargets(
    NAMES,
    async ({ workspaceId, store, target }) => {
      for (const value of [
        new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41),
        encode("has space"),
        new Uint8Array()
      ])
        await assert.rejects(store.store(workspaceId, "anthropic-api-key", value), {
          code: "VES_SECRET_VALUE_INVALID"
        });
      assert.deepEqual(spawned, []);
      assert.equal(isListed(target("anthropic-api-key")), false);
    },
    { runner: counting }
  );
});

test("win32: the real runner kills a child at its timeout, and the backend reports a failure, not a prompt", { timeout: 120_000 }, async (t) => {
  if (!WIN32) return refusedElsewhere(t);
  const killed = await nodeCredentialManagerRunner({
    args: ["-NoProfile", "-NonInteractive", "-Command", "-"],
    stdin: Buffer.from("Start-Sleep -Seconds 30\n"),
    timeoutMs: 1_000
  });
  assert.equal(killed.timedOut, true);
  const backend = new WindowsCredentialManagerBackend({
    runner: (invocation) => nodeCredentialManagerRunner({ ...invocation, timeoutMs: 1 })
  });
  await assert.rejects(
    backend.has({ namespace: "verchestra/workspace_6e2f1a0b-3c4d-4e5f-8a9b-0c1d2e3f4a5b", logicalName: "anthropic-api-key" }),
    { code: "VES_SECRET_BACKEND_FAILURE" }
  );
});

test("win32: a keychain path is refused rather than ignored", { timeout: 60_000 }, async (t) => {
  if (!WIN32) return refusedElsewhere(t);
  assert.throws(() => createOsCredentialStore({ platform: "win32", keychainPath: "C:\\x.keychain-db" }), {
    code: "VES_SECRET_KEYCHAIN_INVALID"
  });
});
