// invariant: #379, the Linux Secret Service backend's command protocol,
// against a fake `secret-tool` and `dbus-send` runner. Platform-independent:
// nothing here spawns a process.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CredentialToolUnavailableError,
  DBUS_SEND_EXECUTABLE,
  LinuxSecretServiceBackend,
  MAX_CREDENTIAL_VALUE_BYTES,
  PRESENCE_TIMEOUT_MS,
  READ_TIMEOUT_MS,
  SECRET_TOOL_EXECUTABLE,
  WRITE_TIMEOUT_MS,
  createOsCredentialStore,
  searchItemsArguments,
  secretToolChildEnvironment
} from "../../packages/platform-node/src/index.ts";
import { DOCTOR_PROBE_TIMEOUT_MS } from "../../packages/application/src/index.ts";
import { fakeSecretToolRunner } from "../helpers/fake-credential-tool-runners.mjs";

const workspaceId = "workspace_0b0e8d4c-6a1e-4f7a-9d55-3e3c6f0c1a2b";
const locator = Object.freeze({ namespace: `verchestra/${workspaceId}`, logicalName: "anthropic-api-key" });
const attributes = ["service", locator.namespace, "account", locator.logicalName];
const search = {
  tool: "dbus-send",
  args: [
    "--session",
    "--print-reply",
    "--dest=org.freedesktop.secrets",
    "/org/freedesktop/secrets",
    "org.freedesktop.Secret.Service.SearchItems",
    `dict:string:string:service,${locator.namespace},account,${locator.logicalName}`
  ],
  stdin: undefined,
  timeoutMs: PRESENCE_TIMEOUT_MS
};
const value = () => new TextEncoder().encode("sk-ant-unit-value-123");
const answer =
  (exitCode, stderr = "", stdout = "") =>
  async () => ({ exitCode, stdout, stderr });
const reply = (unlocked, locked) =>
  "method return time=1.0 sender=:1.1 -> destination=:1.2 serial=7 reply_serial=2\n" +
  `   array [\n${unlocked}   ]\n   array [\n${locked}   ]\n`;
const path = '      object path "/org/freedesktop/secrets/collection/login/1"\n';

test("both tools are fixed absolute paths, never a PATH lookup", () => {
  assert.equal(SECRET_TOOL_EXECUTABLE, "/usr/bin/secret-tool");
  assert.equal(DBUS_SEND_EXECUTABLE, "/usr/bin/dbus-send");
});

test("presence is an attribute-only SearchItems call inside the doctor's budget", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  assert.equal(await backend.has(locator), false);
  assert.deepEqual(fake.invocations, [search]);
  assert.deepEqual(searchItemsArguments(locator), search.args);
  assert.ok(PRESENCE_TIMEOUT_MS < DOCTOR_PROBE_TIMEOUT_MS);
});

test("an unlocked match is present, no match is absent, and a locked-only match needs a person", async () => {
  const has = (stdout) => new LinuxSecretServiceBackend({ runner: answer(0, "", stdout) }).has(locator);
  assert.equal(await has(reply(path, "")), true);
  assert.equal(await has(reply(path, path)), true);
  assert.equal(await has(reply("", "")), false);
  await assert.rejects(has(reply("", path)), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
  for (const malformed of [
    "",
    "   array [\n   ]\n",
    reply("", "").replace("method return", "error"),
    `${reply("", "")}   array [\n   ]\n`
  ])
    await assert.rejects(has(malformed), { code: "VES_SECRET_BACKEND_FAILURE" }, JSON.stringify(malformed));
});

test("tool errors are classified by the tools' own wording, which never reaches the error", async () => {
  for (const [stderr, code] of [
    ["secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY\n", "VES_SECRET_STORE_UNAVAILABLE"],
    [
      'Failed to open connection to "session" message bus: Unable to autolaunch a dbus-daemon without a $DISPLAY for X11\n',
      "VES_SECRET_STORE_UNAVAILABLE"
    ],
    [
      "Error org.freedesktop.DBus.Error.ServiceUnknown: The name org.freedesktop.secrets was not provided by any .service files\n",
      "VES_SECRET_STORE_UNAVAILABLE"
    ],
    ["secret-tool: Could not connect: No such file or directory\n", "VES_SECRET_STORE_UNAVAILABLE"],
    ["secret-tool: Cannot create an item in a locked collection\n", "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED"],
    ["secret-tool: Prompt dismissed\n", "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED"],
    ["secret-tool: something else went wrong\n", "VES_SECRET_BACKEND_FAILURE"]
  ]) {
    const backend = new LinuxSecretServiceBackend({ runner: answer(1, stderr) });
    for (const operation of [
      () => backend.has(locator),
      () => backend.read(locator),
      () => backend.store(locator, value())
    ])
      await assert.rejects(
        operation(),
        (error) => error.code === code && !error.message.includes(stderr.trim()),
        stderr
      );
  }
  for (const exitCode of [2, 127, null]) {
    const backend = new LinuxSecretServiceBackend({ runner: answer(exitCode) });
    await assert.rejects(backend.has(locator), { code: "VES_SECRET_BACKEND_FAILURE" });
  }
});

test("a timeout needs a person and a missing tool is not configured, never a hang or a failure", async () => {
  const timedOut = new LinuxSecretServiceBackend({
    runner: async () => ({ exitCode: null, timedOut: true, stdout: "", stderr: "" })
  });
  const missing = new LinuxSecretServiceBackend({
    runner: async () => {
      throw new CredentialToolUnavailableError();
    }
  });
  for (const operation of ["has", "read", "delete"]) {
    await assert.rejects(timedOut[operation](locator), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
    await assert.rejects(missing[operation](locator), { code: "VES_SECRET_STORE_UNAVAILABLE" });
  }
  await assert.rejects(timedOut.store(locator, value()), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
  await assert.rejects(missing.store(locator, value()), { code: "VES_SECRET_STORE_UNAVAILABLE" });
});

test("read returns exactly the piped stdout bytes; a miss is confirmed by a search before it is absent", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  assert.equal(await backend.read(locator), undefined);
  assert.deepEqual(fake.invocations, [
    { tool: "secret-tool", args: ["lookup", ...attributes], stdin: undefined, timeoutMs: READ_TIMEOUT_MS },
    search
  ]);
  await backend.store(locator, value());
  fake.invocations.length = 0;
  assert.deepEqual(await backend.read(locator), value());
  assert.equal(fake.invocations.length, 1, "a hit needs no search");
});

test("a locked item is never read as absent and never replaced", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  await backend.store(locator, value());
  fake.locked.add(`${locator.namespace}\u0000${locator.logicalName}`);
  await assert.rejects(backend.has(locator), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
  await assert.rejects(backend.read(locator), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
  await assert.rejects(backend.delete(locator), { code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED" });
  await assert.rejects(backend.store(locator, new TextEncoder().encode("sk-ant-new")), {
    code: "VES_SECRET_KEYCHAIN_INTERACTION_REQUIRED"
  });
  assert.equal(fake.invocations.filter((invocation) => invocation.args[0] === "clear").length, 0);
});

test("a lookup miss for an unlocked item is a failure, not an absence", async () => {
  const fake = fakeSecretToolRunner({
    override: (record) => (record.args[0] === "lookup" ? { exitCode: 1, stdout: "", stderr: "" } : undefined)
  });
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  await backend.store(locator, value());
  await assert.rejects(backend.read(locator), { code: "VES_SECRET_BACKEND_FAILURE" });
});

test("store passes the value on stdin only, labels the item, and verifies it landed", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  await backend.store(locator, value());
  const [write, verify] = fake.invocations;
  assert.deepEqual(write.args, [
    "store",
    `--label=Verchestra credential ${locator.namespace}/${locator.logicalName}`,
    ...attributes
  ]);
  assert.equal(write.tool, "secret-tool");
  assert.equal(write.stdin, "sk-ant-unit-value-123");
  assert.equal(write.timeoutMs, WRITE_TIMEOUT_MS);
  assert.deepEqual(verify, search);
  assert.equal(fake.invocations.length, 2);
  for (const invocation of fake.invocations)
    assert.equal(invocation.args.join(" ").includes("sk-ant-unit-value-123"), false);
});

test("a rotation is one replacing store, never a clear followed by a store", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  await backend.store(locator, value());
  fake.invocations.length = 0;
  await backend.store(locator, new TextEncoder().encode("sk-ant-rotated"));
  assert.deepEqual(
    fake.invocations.map((invocation) => invocation.args[0]),
    ["store", "--session"]
  );
  assert.equal(new TextDecoder().decode(await backend.read(locator)), "sk-ant-rotated");
  assert.equal(fake.items.size, 1);
});

test("a store that exits 0 but did not land is a failure", async () => {
  const fake = fakeSecretToolRunner({
    override: (record) => (record.args[0] === "store" ? { exitCode: 0, stdout: "", stderr: "" } : undefined)
  });
  await assert.rejects(new LinuxSecretServiceBackend({ runner: fake.runner }).store(locator, value()), {
    code: "VES_SECRET_BACKEND_FAILURE"
  });
});

test("delete reports false without clearing when absent, and verifies removal when present", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  assert.equal(await backend.delete(locator), false);
  assert.deepEqual(fake.invocations, [search]);
  await backend.store(locator, value());
  fake.invocations.length = 0;
  assert.equal(await backend.delete(locator), true);
  assert.deepEqual(
    fake.invocations.map((invocation) => [invocation.tool, invocation.args[0]]),
    [
      ["dbus-send", "--session"],
      ["secret-tool", "clear"],
      ["dbus-send", "--session"]
    ]
  );
  assert.deepEqual(fake.invocations[1].args, ["clear", ...attributes]);
  const stuck = fakeSecretToolRunner({
    override: (record) => (record.args[0] === "clear" ? { exitCode: 0, stdout: "", stderr: "" } : undefined)
  });
  const stubborn = new LinuxSecretServiceBackend({ runner: stuck.runner });
  await stubborn.store(locator, value());
  await assert.rejects(stubborn.delete(locator), { code: "VES_SECRET_BACKEND_FAILURE" });
  const raced = fakeSecretToolRunner({
    override: (record) => {
      if (record.args[0] !== "clear") return undefined;
      raced.items.clear();
      return { exitCode: 1, stdout: "", stderr: "" };
    }
  });
  const racing = new LinuxSecretServiceBackend({ runner: raced.runner });
  await racing.store(locator, value());
  assert.equal(await racing.delete(locator), true, "a clear that found nothing after presence still ends absent");
});

test("an invalid locator or value is refused before any process runs", async () => {
  const fake = fakeSecretToolRunner();
  const backend = new LinuxSecretServiceBackend({ runner: fake.runner });
  for (const bad of [
    { namespace: "verchestra/not-a-workspace", logicalName: "anthropic-api-key" },
    { namespace: locator.namespace, logicalName: "UPPER" },
    { namespace: locator.namespace, logicalName: "a,b" },
    { namespace: `other/${workspaceId}`, logicalName: "anthropic-api-key" }
  ]) {
    await assert.rejects(backend.has(bad), { code: "VES_SECRET_BINDING_INVALID" });
    await assert.rejects(backend.store(bad, value()), { code: "VES_SECRET_BINDING_INVALID" });
    await assert.rejects(backend.delete(bad), { code: "VES_SECRET_BINDING_INVALID" });
  }
  for (const invalid of [
    new Uint8Array(),
    new TextEncoder().encode("two words"),
    new Uint8Array(MAX_CREDENTIAL_VALUE_BYTES + 1).fill(0x41)
  ])
    await assert.rejects(backend.store(locator, invalid), { code: "VES_SECRET_VALUE_INVALID" });
  assert.equal(fake.invocations.length, 0);
});

test("the child environment reaches the session bus and nothing else", () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus",
    XDG_RUNTIME_DIR: "/run/user/1000",
    DISPLAY: ":0",
    WAYLAND_DISPLAY: "wayland-0",
    ANTHROPIC_API_KEY: "sk-ant-ambient",
    PATH: "/opt/evil/bin:/usr/bin"
  });
  try {
    const environment = secretToolChildEnvironment();
    for (const key of Object.keys(environment))
      assert.ok(
        ["PATH", "LC_ALL", "HOME", "USER", "LOGNAME", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"].includes(key),
        key
      );
    assert.equal(environment.PATH, "/usr/bin:/bin");
    assert.equal(environment.LC_ALL, "C");
    assert.equal(environment.DBUS_SESSION_BUS_ADDRESS, "unix:path=/run/user/1000/bus");
    assert.equal(environment.DISPLAY, undefined, "no X11 autolaunch of a new bus");
    assert.equal(environment.ANTHROPIC_API_KEY, undefined);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test("the linux store is the qualified Secret Service adapter and refuses a keychain path", () => {
  const fake = fakeSecretToolRunner();
  const store = createOsCredentialStore({ platform: "linux", runner: fake.runner });
  assert.equal(store.storeId, "secret-service-credential");
  assert.equal(store.keychain, "default");
  assert.throws(() => createOsCredentialStore({ platform: "linux", keychainPath: "/tmp/a.keychain-db" }), {
    code: "VES_SECRET_KEYCHAIN_INVALID"
  });
});
