import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MockSecretAdapter,
  QualifiedOsSecretAdapter,
  SecretBroker,
  platformSecurityPublicErrorRegistry
} from "../../packages/platform-node/src/index.ts";
import { SchemaRegistry } from "../../packages/contracts/src/index.ts";

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";
const otherWorkspaceId = "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab";
const binding = Object.freeze({
  workspaceId,
  logicalName: "database.orders.readonly",
  purpose: "Read the approved orders schema",
  blockedCapability: "probe.orders.read",
  expectedStore: "OS user secret store"
});

function fixture() {
  const adapter = new MockSecretAdapter();
  const broker = new SecretBroker({ adapter, workspaceId, idSource: () => "secret-handle-1" });
  adapter.set(workspaceId, binding.logicalName, new TextEncoder().encode("credential-value"));
  return { adapter, broker };
}

test("binding returns an opaque handle with safe metadata only", async () => {
  const { broker } = fixture();
  const handle = await broker.bind(binding);
  assert.deepEqual(JSON.parse(JSON.stringify(handle)), {
    handleId: "secret-handle-1",
    workspaceId,
    logicalName: binding.logicalName,
    purpose: binding.purpose
  });
  assert.equal(JSON.stringify(handle).includes("credential-value"), false);
});

test("secret value exists only inside the scoped callback", async () => {
  const { broker } = fixture();
  const handle = await broker.bind(binding);
  assert.equal(await broker.withSecret(handle, async (bytes) => new TextDecoder().decode(bytes)), "credential-value");
});

test("ephemeral callback bytes are zeroized after use", async () => {
  const { broker } = fixture();
  const handle = await broker.bind(binding);
  let observed;
  await broker.withSecret(handle, async (bytes) => {
    observed = bytes;
  });
  assert.deepEqual([...observed], Array(observed.length).fill(0));
});

test("callback failure still zeroizes ephemeral bytes", async () => {
  const { broker } = fixture();
  const handle = await broker.bind(binding);
  let observed;
  await assert.rejects(
    broker.withSecret(handle, async (bytes) => {
      observed = bytes;
      throw new Error("consumer failed");
    })
  );
  assert.deepEqual([...observed], Array(observed.length).fill(0));
});

test("missing secret reports safe bootstrap guidance", async () => {
  const broker = new SecretBroker({ adapter: new MockSecretAdapter(), workspaceId });
  await assert.rejects(broker.bind(binding), {
    code: "VES_SECRET_MISSING",
    logicalName: binding.logicalName,
    expectedStore: binding.expectedStore,
    purpose: binding.purpose,
    blockedCapability: binding.blockedCapability
  });
});

test("broker rejects a binding from another Workspace", async () => {
  const { broker } = fixture();
  await assert.rejects(broker.bind({ ...binding, workspaceId: otherWorkspaceId }), {
    code: "VES_SECRET_WORKSPACE_MISMATCH"
  });
});

test("broker rejects a non-canonical Workspace identity", () => {
  assert.throws(() => new SecretBroker({ adapter: new MockSecretAdapter(), workspaceId: "../workspace" }), {
    code: "VES_WORKSPACE_ID_INVALID"
  });
});

test("logical secret names reject path and control injection", async () => {
  const { broker } = fixture();
  for (const logicalName of ["../secret", "secret/name", "secret\nname", "UPPERCASE"]) {
    await assert.rejects(broker.bind({ ...binding, logicalName }), { code: "VES_SECRET_BINDING_INVALID" });
  }
});

test("one Workspace cannot resolve another Workspace secret", async () => {
  const { adapter, broker } = fixture();
  const handle = await broker.bind(binding);
  const other = new SecretBroker({ adapter, workspaceId: otherWorkspaceId });
  await assert.rejects(
    other.withSecret(handle, async () => undefined),
    { code: "VES_SECRET_HANDLE_INVALID" }
  );
});

test("plain objects cannot forge secret handles", async () => {
  const { broker } = fixture();
  await assert.rejects(
    broker.withSecret(
      { handleId: "secret-handle-1", workspaceId, logicalName: binding.logicalName },
      async () => undefined
    ),
    { code: "VES_SECRET_HANDLE_INVALID" }
  );
});

test("mock adapter snapshots caller bytes and never serializes storage", async () => {
  const adapter = new MockSecretAdapter();
  const bytes = new Uint8Array([1, 2, 3]);
  adapter.set(workspaceId, "name", bytes);
  bytes.fill(9);
  assert.deepEqual(JSON.parse(JSON.stringify(adapter)), { adapterId: "mock-secret-store" });
  assert.equal(JSON.stringify(adapter).includes("credential-value"), false);
  assert.deepEqual([...(await adapter.read(workspaceId, "name"))], [1, 2, 3]);
});

test("deleting a secret invalidates later resolution", async () => {
  const { adapter, broker } = fixture();
  const handle = await broker.bind(binding);
  adapter.delete(workspaceId, binding.logicalName);
  await assert.rejects(
    broker.withSecret(handle, async () => undefined),
    { code: "VES_SECRET_MISSING" }
  );
});

const osFixtures = [
  ["win32", "windows-cng", ["cng-ksp", "non-exportable", "user-scope", "access-control"]],
  ["darwin", "apple-keychain", ["keychain", "non-exportable", "user-scope", "access-control"]],
  ["linux", "secret-service", ["secret-service", "locked-collection", "user-scope", "access-control"]]
];

for (const [platform, adapterId, controls] of osFixtures) {
  test(`${platform} selects only its qualified OS secret adapter`, async () => {
    const backend = { has: async () => true, read: async () => new Uint8Array([7]) };
    const adapter = new QualifiedOsSecretAdapter({
      platform,
      evidence: { digest: "a".repeat(64), controls },
      backend
    });
    assert.equal(adapter.adapterId, adapterId);
    assert.equal(await adapter.has(workspaceId, "logical"), true);
  });
}

test("OS secret adapter is unavailable without qualification evidence", () => {
  assert.throws(() => new QualifiedOsSecretAdapter({ platform: "win32", backend: {} }), {
    code: "VES_SECRET_STORE_UNQUALIFIED"
  });
});

test("incomplete OS controls fail closed", () => {
  assert.throws(
    () =>
      new QualifiedOsSecretAdapter({
        platform: "linux",
        evidence: { digest: "a".repeat(64), controls: ["secret-service"] },
        backend: {}
      }),
    { code: "VES_SECRET_STORE_UNQUALIFIED" }
  );
});

test("qualified OS adapter rejects a backend without the complete bridge contract", () => {
  assert.throws(
    () =>
      new QualifiedOsSecretAdapter({
        platform: "win32",
        evidence: {
          digest: "a".repeat(64),
          controls: ["cng-ksp", "non-exportable", "user-scope", "access-control"]
        },
        backend: {}
      }),
    { code: "VES_SECRET_STORE_UNQUALIFIED" }
  );
});

test("OS backend failures are mapped without exposing private messages", async () => {
  const adapter = new QualifiedOsSecretAdapter({
    platform: "linux",
    evidence: {
      digest: "a".repeat(64),
      controls: ["secret-service", "locked-collection", "user-scope", "access-control"]
    },
    backend: {
      has: async () => {
        throw new Error("private native secret-store wording");
      },
      read: async () => undefined
    }
  });
  await assert.rejects(adapter.has(workspaceId, "logical"), (error) => {
    assert.equal(error.code, "VES_SECRET_BACKEND_FAILURE");
    assert.equal(error.message.includes("private native"), false);
    return true;
  });
});

test("platform security public errors are schema-valid", async () => {
  assert.deepEqual(platformSecurityPublicErrorRegistry.codes, [
    "VES_PATH_CHANGED",
    "VES_PATH_HANDLE_INVALID",
    "VES_PATH_LOGICAL_INVALID",
    "VES_PATH_NOT_FOUND",
    "VES_PATH_OUTSIDE_ROOT",
    "VES_PATH_ROOT_INVALID",
    "VES_PATH_ROOT_UNKNOWN",
    "VES_PATH_WORKSPACE_MISMATCH",
    "VES_SECRET_BACKEND_FAILURE",
    "VES_SECRET_BINDING_INVALID",
    "VES_SECRET_HANDLE_INVALID",
    "VES_SECRET_MISSING",
    "VES_SECRET_STORE_UNQUALIFIED",
    "VES_SECRET_WORKSPACE_MISMATCH",
    "VES_STATE_PLATFORM_UNSUPPORTED",
    "VES_STATE_ROOT_ESCAPE",
    "VES_STATE_ROOT_INVALID",
    "VES_WORKSPACE_ID_INVALID"
  ]);
  const schemas = await SchemaRegistry.load(new URL("../../schemas/", import.meta.url));
  for (const code of platformSecurityPublicErrorRegistry.codes) {
    assert.equal(
      schemas.validate("public-error", "1", platformSecurityPublicErrorRegistry.create(code, {})).code,
      code
    );
  }
});
