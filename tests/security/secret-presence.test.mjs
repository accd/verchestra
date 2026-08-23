import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { MockSecretAdapter, SecretBroker } from "../../packages/platform-node/src/index.ts";
import { secretPresence } from "../../packages/platform-node/src/readonly.ts";

// DDL-09 (#207): a live secret-presence doctor probe (T15) observes only
// whether a secret is present, never its value, and never mints a real
// handle to obtain that answer.

const workspaceId = "workspace_018f0b6d-7b1a-7abc-8def-0123456789ab";
const logicalName = "database.orders.readonly";

function fixture() {
  const adapter = new MockSecretAdapter();
  const broker = new SecretBroker({ adapter, workspaceId, idSource: () => "secret-handle-1" });
  return { adapter, broker };
}

test("reports true when the secret is present", async () => {
  const { adapter } = fixture();
  adapter.set(workspaceId, logicalName, new TextEncoder().encode("credential-value"));
  assert.equal(await secretPresence(adapter, workspaceId, logicalName), true);
});

test("reports false when the secret is absent", async () => {
  const { adapter } = fixture();
  assert.equal(await secretPresence(adapter, workspaceId, logicalName), false);
});

test("the returned value is a boolean, never the secret's bytes", async () => {
  const { adapter } = fixture();
  adapter.set(workspaceId, logicalName, new TextEncoder().encode("credential-value"));
  const result = await secretPresence(adapter, workspaceId, logicalName);
  assert.equal(typeof result, "boolean");
  assert.equal(JSON.stringify(result).includes("credential-value"), false);
});

test("never binds a real handle to answer presence, through any broker instance", async () => {
  const { adapter } = fixture();
  adapter.set(workspaceId, logicalName, new TextEncoder().encode("credential-value"));
  // Spied on the class prototype, not one fixture instance: secretPresence
  // must never mint a handle even through a broker it constructs internally,
  // not only one the test happens to hold a reference to.
  const bindSpy = mock.method(SecretBroker.prototype, "bind");

  await secretPresence(adapter, workspaceId, logicalName);

  assert.equal(bindSpy.mock.callCount(), 0);
});

test("never reads the secret's stored bytes to answer presence", async () => {
  const { adapter } = fixture();
  adapter.set(workspaceId, logicalName, new TextEncoder().encode("credential-value"));
  const readSpy = mock.method(adapter, "read");

  await secretPresence(adapter, workspaceId, logicalName);

  assert.equal(readSpy.mock.callCount(), 0);
});
