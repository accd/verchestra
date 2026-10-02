// invariant: the credential mode of a governed task (SPA-12). It is a
// machine-local setting beside the gate allowlist: absent means subscription
// for both providers, and anything the reader does not recognize is refused as
// not configured instead of being guessed.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import {
  DEFAULT_PROVIDER_AUTH,
  IMPLEMENTER_CREDENTIALS,
  PROVIDER_AUTH_FILE,
  loadProviderAuth,
  normalizeProviderAuth,
  providerAuthAt
} from "../../apps/vestra-cli/src/task-provider-auth.ts";
import { resolveStateRoot, resolveWorkspaceState } from "../../packages/platform-node/src/index.ts";
import { buildCanonicalInitFiles } from "../../packages/workspace/src/index.ts";

const roots = [];
after(() => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

async function workspaceRoot(setting) {
  const root = await mkdtemp(join(tmpdir(), "vestra-provider-auth-"));
  roots.push(root);
  if (setting !== undefined)
    await writeFile(join(root, PROVIDER_AUTH_FILE), typeof setting === "string" ? setting : JSON.stringify(setting));
  return root;
}

const refusal = (error) => {
  assert.equal(error.envelope.code, "VES_TASK_NOT_CONFIGURED");
  assert.deepEqual(error.envelope.safeDetails, { requirement: "provider-auth" });
  return true;
};

test("a Workspace without the setting authenticates both providers by subscription", async () => {
  assert.equal(PROVIDER_AUTH_FILE, "task-providers.json");
  assert.deepEqual({ ...DEFAULT_PROVIDER_AUTH }, { implementer: "subscription", verifier: "subscription" });
  assert.equal(Object.isFrozen(DEFAULT_PROVIDER_AUTH), true);
  assert.deepEqual(await loadProviderAuth(await workspaceRoot()), DEFAULT_PROVIDER_AUTH);
});

test("each mode names one implementer credential", () => {
  assert.deepEqual(
    { ...IMPLEMENTER_CREDENTIALS },
    { subscription: "claude-code-oauth-token", "api-key": "anthropic-api-key" }
  );
});

for (const [label, providers, expected] of [
  ["no provider", {}, { implementer: "subscription", verifier: "subscription" }],
  [
    "Claude Code on an API key",
    { "claude-code": { auth: "api-key" } },
    { implementer: "api-key", verifier: "subscription" }
  ],
  ["Codex on an API key", { codex: { auth: "api-key" } }, { implementer: "subscription", verifier: "api-key" }],
  [
    "both on API keys",
    { "claude-code": { auth: "api-key" }, codex: { auth: "api-key" } },
    { implementer: "api-key", verifier: "api-key" }
  ],
  [
    "both named as subscriptions",
    { "claude-code": { auth: "subscription" }, codex: { auth: "subscription" } },
    { implementer: "subscription", verifier: "subscription" }
  ]
]) {
  test(`a setting that names ${label} selects exactly that and defaults the rest`, async () => {
    const selected = await loadProviderAuth(await workspaceRoot({ schemaVersion: 1, providers }));
    assert.deepEqual({ ...selected }, expected);
    assert.equal(Object.isFrozen(selected), true);
  });
}

for (const [label, setting] of [
  ["text that is not JSON", "{not json"],
  ["an array", []],
  ["a null", "null"],
  ["a missing schema version", { providers: {} }],
  ["another schema version", { schemaVersion: 2, providers: {} }],
  ["a missing providers block", { schemaVersion: 1 }],
  ["an unknown top-level member", { schemaVersion: 1, providers: {}, mode: "api-key" }],
  ["an unknown provider", { schemaVersion: 1, providers: { gemini: { auth: "subscription" } } }],
  ["an unknown mode", { schemaVersion: 1, providers: { codex: { auth: "ambient" } } }],
  ["a mode that is not text", { schemaVersion: 1, providers: { codex: { auth: true } } }],
  ["a provider that is not an object", { schemaVersion: 1, providers: { codex: "api-key" } }],
  ["an extra provider member", { schemaVersion: 1, providers: { codex: { auth: "api-key", key: "sk-inline" } } }],
  ["a file above the size bound", `{"schemaVersion":1,"providers":{},"pad":"${"x".repeat(20_000)}"}`]
]) {
  test(`a setting with ${label} is not configured`, async () => {
    await assert.rejects(loadProviderAuth(await workspaceRoot(setting)), refusal);
  });
}

test("a setting that is a directory or a link is refused, never followed", async (t) => {
  const directory = await workspaceRoot();
  await mkdir(join(directory, PROVIDER_AUTH_FILE));
  await assert.rejects(loadProviderAuth(directory), refusal);
  const linked = await workspaceRoot();
  const target = join(linked, "elsewhere.json");
  await writeFile(target, JSON.stringify({ schemaVersion: 1, providers: { codex: { auth: "api-key" } } }));
  try {
    await symlink(target, join(linked, PROVIDER_AUTH_FILE));
  } catch (error) {
    // why: an unprivileged Windows account cannot create a link at all.
    assert.equal(error.code, "EPERM");
    return t.diagnostic("this account cannot create a file link");
  }
  await assert.rejects(loadProviderAuth(linked), refusal);
});

test("a Task Request can never carry the mode", () => {
  for (const smuggled of [
    { schemaVersion: 1, providers: {}, task: {} },
    { schemaVersion: 1, providers: {}, auth: "api-key" }
  ])
    assert.throws(() => normalizeProviderAuth(smuggled), refusal);
});

test("the mode is found from a control root through the machine-local state root", async () => {
  const root = await mkdtemp(join(tmpdir(), "vestra-provider-auth-control-"));
  roots.push(root);
  const location = { controlRoot: root, platform: process.platform, env: {}, homeDirectory: join(root, "home") };
  assert.equal(await providerAuthAt(location), undefined, "an uninitialized directory has no setting");
  const workspaceId = "workspace_9c8b7a6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
  const files = buildCanonicalInitFiles({
    workspaceId,
    displayName: "Provider setting fixture",
    placementMode: "colocated",
    generatorVersion: "0.0.0-qualification"
  });
  await mkdir(join(root, ".verchestra"), { recursive: true });
  await writeFile(join(root, ".verchestra", "workspace.yaml"), files[".verchestra/workspace.yaml"]);
  assert.deepEqual(await providerAuthAt(location), DEFAULT_PROVIDER_AUTH);
  const { workspaceRoot: stateDirectory } = resolveWorkspaceState({
    stateRoot: resolveStateRoot(location),
    workspaceId,
    platform: process.platform
  });
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(
    join(stateDirectory, PROVIDER_AUTH_FILE),
    JSON.stringify({ schemaVersion: 1, providers: { "claude-code": { auth: "api-key" } } })
  );
  assert.deepEqual({ ...(await providerAuthAt(location)) }, { implementer: "api-key", verifier: "subscription" });
});
