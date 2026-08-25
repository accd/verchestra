import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { afterEach, test } from "node:test";

import { MachineBootstrapService } from "../../packages/application/src/index.ts";
import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import {
  MockSecretAdapter,
  RuntimeMachineProfileStore,
  SecretBroker,
  SecretBrokerBindingInspector
} from "../../packages/platform-node/src/index.ts";
import {
  canonicalConfig,
  claude,
  codex,
  executeInput,
  machineId,
  serviceOptions,
  workspaceId
} from "../helpers/machine-bootstrap-fixture.mjs";
import { cleanup, opened } from "../helpers/runtime-store-fixture.mjs";

afterEach(cleanup);

test("driver command containing control data is rejected before profile persistence", async () => {
  const candidate = claude();
  candidate.command = "claude\n--danger";
  const { service, store } = serviceOptions(MachineBootstrapService, [candidate]);
  await assert.rejects(service.execute(executeInput()), { code: "VES_BOOTSTRAP_INPUT_INVALID" });
  assert.equal(store.writes, 0);
});

test("duplicate Passport identities fail closed", async () => {
  const first = claude();
  const second = codex();
  second.passport.passportId = first.passport.passportId;
  const { service, store } = serviceOptions(MachineBootstrapService, [first, second]);
  await assert.rejects(service.execute(executeInput()), { code: "VES_BOOTSTRAP_INPUT_INVALID" });
  assert.equal(store.writes, 0);
});

test("unexpected candidate credential or session field is rejected", async () => {
  const candidate = { ...claude(), sessionToken: "top-secret" };
  const { service } = serviceOptions(MachineBootstrapService, [candidate]);
  await assert.rejects(service.execute(executeInput()), { code: "VES_BOOTSTRAP_INPUT_INVALID" });
});

test("Secret Broker inspector reports presence without exposing secret bytes", async () => {
  const adapter = new MockSecretAdapter();
  adapter.set(workspaceId, "jira.token", new TextEncoder().encode("private-value"));
  const broker = new SecretBroker({ adapter, workspaceId, idSource: () => "opaque-handle" });
  const inspector = new SecretBrokerBindingInspector({ broker, expectedStore: "mock OS store" });
  const binding = {
    workspaceId,
    logicalName: "jira.token",
    purpose: "Jira",
    blockedCapability: "jira",
    expectedStore: inspector.expectedStore
  };
  assert.equal(await inspector.isBound(binding), true);
  assert.equal(JSON.stringify(inspector).includes("private-value"), false);
  assert.equal(await inspector.isBound({ ...binding, logicalName: "missing.token" }), false);
});

test("runtime profile store rejects a profile for another Workspace", async () => {
  const { store: runtime } = await opened();
  const profiles = new RuntimeMachineProfileStore({ runtimeStore: runtime, workspaceId });
  const profile = {
    schemaVersion: 1,
    workspaceId: "workspace_018f0b6d-7b1a-7abc-8def-9123456789ab",
    machineId,
    cliVersion: "1.0.0",
    configVersion: 1,
    drivers: [],
    roles: [],
    secretBindings: []
  };
  await assert.rejects(profiles.save(profile), { code: "VES_BOOTSTRAP_PROFILE_FAILED" });
  assert.equal(runtime.getMachineProfile(workspaceId), undefined);
  runtime.close();
});

// Issue #58: the durable machine_profiles row used to be whatever
// JSON.stringify emitted, so its bytes — and the profile_digest derived from
// them, which surfaces as BootstrapResult.profileDigest — depended on the
// member order the caller happened to build the profile with. They are now the
// qualified canonical contract (canonicalizeJsonV2, RFC 8785 JCS).
const profileFor = (overrides = {}) => ({
  schemaVersion: 1,
  workspaceId,
  machineId,
  cliVersion: "1.0.0",
  configVersion: 1,
  drivers: [],
  roles: [],
  secretBindings: [],
  ...overrides
});

test("the durable machine profile row is written in canonical member order", async () => {
  const { store: runtime } = await opened();
  const profiles = new RuntimeMachineProfileStore({ runtimeStore: runtime, workspaceId });
  const receipt = await profiles.save(profileFor());
  const members = Object.keys(runtime.getMachineProfile(workspaceId));
  assert.deepEqual(members, [...members].sort());
  assert.equal(
    receipt.profileDigest,
    `sha256:${createHash("sha256").update(canonicalizeJsonV2(profileFor())).digest("hex")}`
  );
  runtime.close();
});

test("the same machine profile built in a different member order is not a profile change", async () => {
  const { store: runtime } = await opened();
  const profiles = new RuntimeMachineProfileStore({ runtimeStore: runtime, workspaceId });
  const first = await profiles.save(profileFor());
  const reordered = Object.fromEntries(Object.entries(profileFor()).reverse());
  assert.notDeepEqual(Object.keys(reordered), Object.keys(profileFor()));
  const second = await profiles.save(reordered);
  assert.equal(second.profileDigest, first.profileDigest);
  assert.equal(second.changed, false);
  runtime.close();
});

test("the machine profile digest does not depend on the ambient locale collation", async () => {
  const { store: runtime } = await opened();
  const profiles = new RuntimeMachineProfileStore({ runtimeStore: runtime, workspaceId });
  const plain = await profiles.save(profileFor());
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    const hostile = await profiles.save(profileFor());
    assert.equal(hostile.profileDigest, plain.profileDigest);
    assert.equal(hostile.changed, false);
  } finally {
    String.prototype.localeCompare = original;
    runtime.close();
  }
});

test("persisted machine profile contains no credential value, session, or local selection", async () => {
  const { store: runtime } = await opened();
  const profiles = new RuntimeMachineProfileStore({ runtimeStore: runtime, workspaceId });
  const adapter = new MockSecretAdapter();
  adapter.set(workspaceId, "jira.token", new TextEncoder().encode("never-persist-this"));
  const secrets = new SecretBrokerBindingInspector({
    broker: new SecretBroker({ adapter, workspaceId }),
    expectedStore: "qualified OS store"
  });
  const service = new MachineBootstrapService({
    discovery: { discover: async () => [claude(), codex()] },
    secrets,
    profiles,
    now: () => "2026-07-13T00:00:00.000Z"
  });
  const config = canonicalConfig({
    requiredSecrets: [{ logicalName: "jira.token", purpose: "Jira", blockedCapability: "jira", required: true }]
  });
  await service.execute(executeInput(config));
  const serialized = JSON.stringify(runtime.getMachineProfile(workspaceId));
  for (const prohibited of ["never-persist-this", "sessionToken", "credentialValue", "selectedModel"]) {
    assert.equal(serialized.includes(prohibited), false);
  }
  runtime.close();
});
