// invariant: slice 2a of .specs/features/database-registration/plan.md, in
// process. The Workspace is the end-to-end fixture's, set up with the real
// `vestra init`; every `vestra database` command under test runs here,
// through the CLI runner over executeDatabaseCommand, and main's dispatch
// through main(). The credential store is answered by the fake keychain, as
// for a child `vestra`.
// why: every product module is imported after the child process spy is
// installed (in `before`), because the Git runner keeps the promisified
// execFile it finds when it loads.
import "../helpers/deny-keychain-spawn.mjs";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import { after, afterEach, before, test } from "node:test";
import { promisify } from "node:util";

import { CREDENTIAL_TOOL } from "../helpers/deny-keychain-spawn.mjs";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";
import { linkDirectory, linkFile } from "../helpers/windows-links.mjs";

const DARWIN = process.platform === "darwin";
const LINUX = process.platform === "linux";
const WIN32 = process.platform === "win32";
const TIMEOUT = { timeout: 600_000 };
const SIGNING = "evidence-signing-passphrase";
const OTHER_WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab";
const MAXIMUM_DEFINITION_BYTES = 64 * 1024;

let credentials;
let store;
let fixtures;
let product;

// invariant: C22's sensor. Every child_process entry point is wrapped, as the
// outermost layer above the fakes, so a start the fakes answer is seen too.
const started = [];
let recording = false;

function spyOnChildProcesses() {
  const record = (file) => {
    if (recording) started.push(String(file));
  };
  const wrap = (original, name) =>
    function spied(file, ...rest) {
      record(name === "exec" || name === "execSync" ? String(file).trim().split(/\s/u)[0] : file);
      return original.call(this, file, ...rest);
    };
  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync", "fork"]) {
    const original = childProcess[name];
    const spied = wrap(original, name);
    const custom = original[promisify.custom];
    if (typeof custom === "function") Object.defineProperty(spied, promisify.custom, { value: wrap(custom, name) });
    childProcess[name] = spied;
  }
  syncBuiltinESMExports();
}

async function storeItems(names) {
  const items = names.map((name) => [`verchestra/${fixtures.WORKSPACE_ID}|${name}`, fixtures.CREDENTIALS[name]]);
  await writeFile(store, JSON.stringify({ items: Object.fromEntries(items) }));
}

// why: the fakes read the store path when they load and the store itself each
// time they are asked, so the path is named before the fixture module (which
// loads the POSIX fake) is imported, and one store serves every fixture of
// this file: each binds the same Workspace ID.
before(async () => {
  credentials = await mkdtemp(join(tmpdir(), "vdk-"));
  store = join(credentials, "keychain-store.json");
  process.env.VERCHESTRA_TEST_FAKE_KEYCHAIN_STORE = store;
  // why: the Secret Service backend asks only whether a session bus address
  // is set; the address names a socket that does not exist.
  if (LINUX) process.env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${join(credentials, "no-session-bus")}`;
  fixtures = await import("../helpers/task-cli-fixture.mjs");
  if (WIN32) await import("../helpers/fake-windows-spawn.mjs");
  spyOnChildProcesses();
  await storeItems([SIGNING]);
  const [command, cli, manifest, dataProbe, evidence, signing, registrationFile] = await Promise.all([
    import("../../apps/vestra-cli/src/database/database-command.ts"),
    import("../../apps/vestra-cli/src/cli.ts"),
    import("../../apps/vestra-cli/src/release-manifest.ts"),
    import("../../packages/data-probe/src/index.ts"),
    import("../../packages/evidence/src/index.ts"),
    import("../../apps/vestra-cli/src/task/task-signing.ts"),
    import("../../apps/vestra-cli/src/database/database-registration-file.ts")
  ]);
  product = { ...command, ...cli, ...manifest, ...dataProbe, ...evidence, ...signing, ...registrationFile };
});

after(() => rm(credentials, { recursive: true, force: true, maxRetries: 5 }));
afterEach(() => fixtures.cleanupTaskFixtures());

const databasesRoot = (fixture) => join(fixture.repository, ".verchestra", "databases");
const registrationPath = (fixture, databaseId) => join(databasesRoot(fixture), `${databaseId}.json`);

async function databaseEntries(fixture) {
  try {
    return (await readdir(databasesRoot(fixture))).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

// why: the fixture database is PostgreSQL `orders` with policy maxRows 100;
// a case names only what it changes.
function definition({ database = {}, policy = {} } = {}) {
  return {
    schemaVersion: 1,
    database: {
      databaseId: "orders",
      engine: "postgresql",
      logicalEnvironment: "production",
      classification: "confidential",
      approvedSchemas: ["public", "sales"],
      schemaSourceRefs: ["repo:db/migrations"],
      allowedPurposes: ["schema-discovery"],
      logicalCredentialName: "orders-reader",
      production: true,
      ...database
    },
    policy: {
      allowedObjects: ["public.orders", "sales.invoices"],
      allowedFunctions: ["count", "sum"],
      deniedFunctions: ["pg_read_file"],
      allowCatalogAccess: false,
      maxTimeoutMs: 5_000,
      maxRows: 100,
      maxBytes: 1_048_576,
      maxConcurrency: 2,
      ...policy
    }
  };
}

let definitions = 0;
async function definitionFile(fixture, value) {
  definitions += 1;
  const path = join(fixture.root, `definition-${definitions}.json`);
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
}

// why: the state root the fixture's `vestra init` resolved: from the home
// directory on POSIX, which os.homedir() reads from HOME, and from the local
// application data directory on Windows.
async function inWorkspaceHome(fixture, run) {
  if (WIN32) return run({ LOCALAPPDATA: join(fixture.root, "l") });
  const home = process.env.HOME;
  process.env.HOME = fixture.home;
  try {
    return await run({ HOME: fixture.home });
  } finally {
    if (home === undefined) delete process.env.HOME;
    else process.env.HOME = home;
  }
}

// invariant: the CLI runner parses the arguments against the release
// manifest and maps a refusal to its exit code, exactly as main() does; the
// command bus is the database family alone.
async function vestra(fixture, argv) {
  const stdout = [];
  const stderr = [];
  const exitCode = await inWorkspaceHome(fixture, (env) =>
    product.runCli({
      argv: ["database", ...argv, "--output", "json"],
      invokedAs: "vestra",
      installedManifest: product.installedReleaseManifest,
      installedCliVersion: product.installedReleaseManifest.semanticVersion,
      commandBus: {
        execute: (command) =>
          product.executeDatabaseCommand(command, {
            controlRoot: fixture.repository,
            platform: process.platform,
            env,
            stdin: Readable.from([]),
            stderr: (value) => stderr.push(value),
            pid: process.pid
          })
      },
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value)
    })
  );
  return { exitCode, json: JSON.parse(stdout.join("")), stderr: stderr.join("") };
}

const keychain = (fixture) => (DARWIN ? ["--keychain", fixture.keychain] : []);
const add = (fixture, path) =>
  vestra(fixture, ["add", ...(path === undefined ? [] : ["--definition", path]), ...keychain(fixture)]);
const list = (fixture) => vestra(fixture, ["list"]);
const remove = (fixture, databaseId) =>
  vestra(fixture, ["remove", ...(databaseId === undefined ? [] : ["--database", databaseId])]);

async function addDefinition(fixture, value) {
  return add(fixture, await definitionFile(fixture, value));
}

function succeeded(result, label) {
  assert.equal(result.exitCode, 0, `${label}: ${JSON.stringify(result.json)}`);
  assert.equal(result.json.ok, true, label);
  return result.json.data;
}

function refused(result, code, exitCode, label) {
  assert.equal(result.exitCode, exitCode, `${label}: ${JSON.stringify(result.json)}`);
  assert.equal(result.json.ok, false, label);
  assert.equal(result.json.error.code, code, `${label}: ${JSON.stringify(result.json.error)}`);
  return result.json.error;
}

function statementOf(envelope) {
  return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
}

async function registrationContent(fixture, databaseId) {
  return statementOf(JSON.parse(await readFile(registrationPath(fixture, databaseId), "utf8"))).predicate.content;
}

function expectedRegistration(value) {
  return product.normalizeDatabaseRegistration({
    schemaVersion: 1,
    workspaceId: fixtures.WORKSPACE_ID,
    ...value.database,
    policyRef: value.database.databaseId
  });
}

function expectedPolicy(value) {
  return product.normalizeDatabaseAccessPolicy({ ...value.policy, policyRef: value.database.databaseId });
}

const json = (value) => JSON.parse(JSON.stringify(value));

// why: the Workspace evidence key `add` created, unlocked as the CLI unlocks
// it, to sign bodies no command would write.
async function workspaceKey(fixture) {
  const workspace = {
    workspaceId: fixtures.WORKSPACE_ID,
    layout: { workspaceRoot: fixture.stateRoot },
    keysRoot: join(fixture.stateRoot, "keys"),
    tasksRoot: join(fixture.stateRoot, "tasks"),
    verificationRoot: join(fixture.stateRoot, "verification")
  };
  return {
    signer: await product.workspaceSigner(workspace, fixtures.CREDENTIALS[SIGNING]),
    trust: await product.workspaceTrustRoot(workspace)
  };
}

// why: the payload edited after signing, the signature kept; anyone can
// re-encode it, nobody but the Workspace key can sign it.
async function editRegistration(fixture, databaseId, edit) {
  const path = registrationPath(fixture, databaseId);
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const statement = statementOf(envelope);
  edit(statement.predicate.content);
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(path, `${JSON.stringify(envelope)}\n`);
}

function document(fixture, databaseId, { registration = {}, policy } = {}) {
  const value = definition({ database: { databaseId, ...registration } });
  return {
    registration: product.normalizeDatabaseRegistration({
      schemaVersion: 1,
      workspaceId: fixtures.WORKSPACE_ID,
      ...value.database,
      policyRef: databaseId
    }),
    policy: policy ?? expectedPolicy(value),
    registeredAt: new Date().toISOString()
  };
}

async function snapshot(directory) {
  const files = {};
  for (const name of (await readdir(directory)).sort())
    files[name] = (await readFile(join(directory, name))).toString("base64");
  return files;
}

async function credentialLookups() {
  return (await readFile(`${store}.log`, "utf8").catch(() => "")).split("\n").filter(Boolean).length;
}

test("add writes a signed registration of the definition", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const value = definition();
  const start = Date.now();
  const data = succeeded(await addDefinition(fixture, value), "add");
  const end = Date.now();
  const registration = expectedRegistration(value);
  assert.deepEqual(data, { databaseId: "orders", registrationDigest: registration.registrationDigest, created: true });
  assert.deepEqual(await databaseEntries(fixture), ["orders.json"]);
  const content = await registrationContent(fixture, "orders");
  assert.deepEqual(Object.keys(content).sort(), ["policy", "registeredAt", "registration"]);
  assert.deepEqual(content.registration, json(registration));
  assert.equal(content.registration.workspaceId, fixtures.WORKSPACE_ID);
  assert.equal(content.registration.policyRef, "orders");
  assert.deepEqual(content.policy, json(expectedPolicy(value)));
  assert.equal(content.policy.policyRef, "orders");
  assert.equal(new Date(content.registeredAt).toISOString(), content.registeredAt);
  const registeredAt = Date.parse(content.registeredAt);
  assert.ok(registeredAt >= start && registeredAt <= end, content.registeredAt);
  // The envelope verifies against the pinned anchor alone.
  const anchor = JSON.parse(await readFile(join(fixture.stateRoot, "keys", "task-evidence-trust.json"), "utf8"));
  const store_ = new product.WorkspaceDatabaseRegistrationStore({
    repositoryRoot: fixture.repository,
    workspaceId: fixtures.WORKSPACE_ID,
    trust: async () =>
      product.createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [anchor.publicKeyRef] })
  });
  assert.deepEqual(json(await store_.load(fixtures.WORKSPACE_ID, "orders")), json(registration));
});

test("add refuses an invalid registration and writes nothing", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  for (const [label, database, code] of [
    ["engine db2", { engine: "db2" }, "VES_DATABASE_ENGINE_UNSUPPORTED"],
    ["classification top-secret", { classification: "top-secret" }, "VES_DATABASE_REGISTRATION_INVALID"],
    ["databaseId Orders", { databaseId: "Orders" }, "VES_DATABASE_REGISTRATION_INVALID"],
    ["approvedSchemas []", { approvedSchemas: [] }, "VES_DATABASE_REGISTRATION_INVALID"],
    ["production yes", { production: "yes" }, "VES_DATABASE_REGISTRATION_INVALID"]
  ]) {
    refused(await addDefinition(fixture, definition({ database })), code, 5, label);
    assert.deepEqual(await databaseEntries(fixture), [], label);
  }
});

test("add refuses an invalid policy and writes nothing", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  for (const [label, policy] of [
    ["maxRows 0", { maxRows: 0 }],
    ["allowedObjects []", { allowedObjects: [] }],
    ["allowCatalogAccess no", { allowCatalogAccess: "no" }],
    ["an object with no schema", { allowedObjects: ["orders"] }]
  ]) {
    refused(await addDefinition(fixture, definition({ policy })), "VES_PROBE_POLICY_INVALID", 5, label);
    assert.deepEqual(await databaseEntries(fixture), [], label);
  }
});

test("add refuses a definition file that is not a definition", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const valid = definition();
  const { maxBytes, ...withoutMaxBytes } = valid.policy;
  assert.equal(maxBytes, 1_048_576);
  const cases = [
    ["no --definition", undefined],
    ["a missing file", join(fixture.root, "no-such-definition.json")],
    ["a directory", fixture.root],
    ["text that is not JSON", await definitionFile(fixture, "{ not json\n")],
    ["a JSON array", await definitionFile(fixture, "[]")],
    ["an extra top-level key", await definitionFile(fixture, { ...valid, notes: "orders database" })],
    [
      "database carrying workspaceId",
      await definitionFile(fixture, { ...valid, database: { ...valid.database, workspaceId: fixtures.WORKSPACE_ID } })
    ],
    [
      "policy carrying policyRef",
      await definitionFile(fixture, { ...valid, policy: { ...valid.policy, policyRef: "orders" } })
    ],
    ["policy without maxBytes", await definitionFile(fixture, { ...valid, policy: withoutMaxBytes })],
    ["schemaVersion 2", await definitionFile(fixture, { ...valid, schemaVersion: 2 })]
  ];
  assert.equal(cases.length, 10);
  for (const [label, path] of cases) {
    const error = refused(await add(fixture, path), "VES_CLI_ARGUMENT_INVALID", 2, label);
    assert.deepEqual(error.safeDetails, { argument: "--definition" }, label);
    assert.deepEqual(await databaseEntries(fixture), [], label);
  }
});

test("the definition file is at most 64 KiB", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const text = JSON.stringify(definition());
  const padded = (bytes) => `${text}${" ".repeat(bytes - Buffer.byteLength(text))}`;
  const over = await definitionFile(fixture, padded(MAXIMUM_DEFINITION_BYTES + 1));
  assert.equal((await readFile(over)).length, 65_537);
  const error = refused(await add(fixture, over), "VES_CLI_ARGUMENT_INVALID", 2, "65,537 bytes");
  assert.deepEqual(error.safeDetails, { argument: "--definition" });
  assert.deepEqual(await databaseEntries(fixture), []);
  const exact = await definitionFile(fixture, padded(MAXIMUM_DEFINITION_BYTES));
  assert.equal((await readFile(exact)).length, 65_536);
  assert.equal(succeeded(await add(fixture, exact), "65,536 bytes").created, true);
  assert.deepEqual(await databaseEntries(fixture), ["orders.json"]);
});

test("add refuses a credential name vestra secret set refuses", TIMEOUT, async () => {
  const { isValidLogicalSecretName } = await import("../../packages/platform-node/src/index.ts");
  const fixture = await fixtures.taskFixture();
  const underscored = definition({ database: { logicalCredentialName: "orders_reader" } });
  // why: the registration validator alone would accept it; the secret name
  // rule is what refuses it.
  assert.equal(expectedRegistration(underscored).logicalCredentialName, "orders_reader");
  assert.equal(isValidLogicalSecretName("orders_reader"), false);
  refused(await addDefinition(fixture, underscored), "VES_DATABASE_REGISTRATION_INVALID", 5, "orders_reader");
  assert.deepEqual(await databaseEntries(fixture), []);
  assert.equal(isValidLogicalSecretName("orders-reader.ro"), true);
  const dotted = definition({ database: { logicalCredentialName: "orders-reader.ro" } });
  assert.equal(succeeded(await addDefinition(fixture, dotted), "orders-reader.ro").created, true);
  assert.equal((await registrationContent(fixture, "orders")).registration.logicalCredentialName, "orders-reader.ro");
});

test("add refuses different content for a registered id", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  succeeded(await addDefinition(fixture, definition()), "add");
  const before = await readFile(registrationPath(fixture, "orders"));
  for (const [label, value] of [
    ["approvedSchemas changed", definition({ database: { approvedSchemas: ["public"] } })],
    ["maxRows 200", definition({ policy: { maxRows: 200 } })]
  ]) {
    refused(await addDefinition(fixture, value), "VES_DATABASE_REGISTRATION_CONFLICT", 5, label);
    assert.deepEqual(await readFile(registrationPath(fixture, "orders")), before, label);
    assert.deepEqual(await databaseEntries(fixture), ["orders.json"], label);
  }
});

test("add of the same definition again changes nothing", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const value = definition();
  const first = succeeded(await addDefinition(fixture, value), "add");
  const before = await readFile(registrationPath(fixture, "orders"));
  const reordered = definition({
    database: {
      approvedSchemas: ["sales", "public", "sales"],
      allowedPurposes: ["schema-discovery", "schema-discovery"]
    },
    policy: {
      allowedObjects: ["sales.invoices", "public.orders", "public.orders"],
      allowedFunctions: ["sum", "count"],
      deniedFunctions: ["pg_read_file", "pg_read_file"]
    }
  });
  for (const [label, candidate] of [
    ["the same definition", value],
    ["arrays reordered, one member repeated", reordered]
  ]) {
    const data = succeeded(await addDefinition(fixture, candidate), label);
    assert.deepEqual(
      data,
      { databaseId: "orders", registrationDigest: first.registrationDigest, created: false },
      label
    );
    assert.deepEqual(await readFile(registrationPath(fixture, "orders")), before, label);
    assert.deepEqual(await databaseEntries(fixture), ["orders.json"], label);
  }
});

test("list orders registrations by id in code-unit order", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const registrations = {};
  for (const [databaseId, database] of [
    ["orders_eu", { engine: "mysql" }],
    ["billing", { engine: "sqlserver", production: false }],
    ["orders.eu", { logicalEnvironment: "staging", classification: "internal" }],
    ["orders-eu", { classification: "restricted" }]
  ]) {
    const value = definition({ database: { databaseId, ...database } });
    succeeded(await addDefinition(fixture, value), databaseId);
    registrations[databaseId] = expectedRegistration(value);
  }
  const data = succeeded(await list(fixture), "list");
  assert.deepEqual(
    data.databases,
    ["billing", "orders-eu", "orders.eu", "orders_eu"].map((databaseId) => {
      const registration = registrations[databaseId];
      return {
        databaseId,
        engine: registration.engine,
        logicalEnvironment: registration.logicalEnvironment,
        classification: registration.classification,
        production: registration.production,
        registrationDigest: registration.registrationDigest,
        state: "valid"
      };
    })
  );
});

test("list reports every registration that does not verify as invalid", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  for (const databaseId of ["orders", "edited", "renamed"])
    succeeded(await addDefinition(fixture, definition({ database: { databaseId } })), databaseId);
  const key = await workspaceKey(fixture);
  // A payload edited after signing.
  await editRegistration(fixture, "edited", (content) => {
    content.policy.maxRows = 200;
  });
  // A body signed by the Workspace key that fails validation.
  const zero = document(fixture, "zero", {
    policy: { ...expectedPolicy(definition()), policyRef: "zero", maxRows: 0 }
  });
  await writeFile(registrationPath(fixture, "zero"), JSON.stringify(await product.sealRegistration(key.signer, zero)));
  // A body signed by the Workspace key for another Workspace.
  const foreign = document(fixture, "foreign");
  foreign.registration = product.normalizeDatabaseRegistration({
    ...Object.fromEntries(Object.entries(foreign.registration).filter(([name]) => name !== "registrationDigest")),
    workspaceId: OTHER_WORKSPACE_ID
  });
  await writeFile(
    registrationPath(fixture, "foreign"),
    JSON.stringify(await product.sealRegistration(key.signer, foreign))
  );
  // A valid registration renamed.
  await rename(registrationPath(fixture, "renamed"), registrationPath(fixture, "other"));
  // A link, not followed: its target would verify as `linked`. On Windows a
  // file link needs Developer Mode, so a junction to a directory stands in.
  const outside = join(fixture.root, "outside");
  await mkdir(outside);
  const target = join(outside, "linked.json");
  await writeFile(target, JSON.stringify(await product.sealRegistration(key.signer, document(fixture, "linked"))));
  if (WIN32) await linkDirectory(outside, registrationPath(fixture, "linked"));
  else await linkFile(target, registrationPath(fixture, "linked"));
  const outsideBefore = await snapshot(outside);
  // A file that is no registration.
  await writeFile(join(databasesRoot(fixture), "notes.txt"), "not a registration\n");
  const data = succeeded(await list(fixture), "list");
  const orders = expectedRegistration(definition());
  assert.deepEqual(data.databases, [
    { databaseId: "edited", state: "invalid" },
    { databaseId: "foreign", state: "invalid" },
    { databaseId: "linked", state: "invalid" },
    { databaseId: "notes.txt", state: "invalid" },
    {
      databaseId: "orders",
      engine: orders.engine,
      logicalEnvironment: orders.logicalEnvironment,
      classification: orders.classification,
      production: orders.production,
      registrationDigest: orders.registrationDigest,
      state: "valid"
    },
    { databaseId: "other", state: "invalid" },
    { databaseId: "zero", state: "invalid" }
  ]);
  assert.deepEqual(await snapshot(outside), outsideBefore);
});

test("list with no registration prints an empty array", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  assert.deepEqual(await databaseEntries(fixture), []);
  assert.deepEqual(succeeded(await list(fixture), "no directory"), { databases: [] });
  await mkdir(databasesRoot(fixture));
  assert.deepEqual(succeeded(await list(fixture), "an empty directory"), { databases: [] });
});

test("remove deletes the registration file", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  succeeded(await addDefinition(fixture, definition()), "add orders");
  succeeded(await addDefinition(fixture, definition({ database: { databaseId: "billing" } })), "add billing");
  assert.deepEqual(succeeded(await remove(fixture, "orders"), "remove orders"), {
    databaseId: "orders",
    removed: true
  });
  assert.deepEqual(await databaseEntries(fixture), ["billing.json"]);
  assert.deepEqual(
    succeeded(await list(fixture), "list").databases.map((entry) => entry.databaseId),
    ["billing"]
  );
  // A registration list reports invalid is removed the same way.
  await editRegistration(fixture, "billing", (content) => {
    content.policy.maxRows = 200;
  });
  assert.deepEqual(succeeded(await list(fixture), "list").databases, [{ databaseId: "billing", state: "invalid" }]);
  assert.deepEqual(succeeded(await remove(fixture, "billing"), "remove billing"), {
    databaseId: "billing",
    removed: true
  });
  assert.deepEqual(await databaseEntries(fixture), []);
  assert.deepEqual(succeeded(await list(fixture), "list").databases, []);
});

test("remove refuses an unknown or malformed database", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  refused(await remove(fixture, "orders"), "VES_DATABASE_NOT_FOUND", 5, "no registration directory");
  succeeded(await addDefinition(fixture, definition()), "add");
  const before = await readFile(registrationPath(fixture, "orders"));
  refused(await remove(fixture, "billing"), "VES_DATABASE_NOT_FOUND", 5, "an unregistered id");
  for (const [label, databaseId] of [
    ["a path out of the directory", "../orders"],
    ["an id with an upper-case letter", "Orders"],
    ["no --database", undefined]
  ]) {
    const error = refused(await remove(fixture, databaseId), "VES_CLI_ARGUMENT_INVALID", 2, label);
    assert.deepEqual(error.safeDetails, { argument: "--database" }, label);
  }
  assert.deepEqual(await databaseEntries(fixture), ["orders.json"]);
  assert.deepEqual(await readFile(registrationPath(fixture, "orders")), before);
});

test("the databases directory is never reached through a link", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  succeeded(await addDefinition(fixture, definition()), "add");
  const outside = join(fixture.root, "outside-databases");
  await rename(databasesRoot(fixture), outside);
  await linkDirectory(outside, databasesRoot(fixture));
  const before = await snapshot(outside);
  assert.deepEqual(Object.keys(before), ["orders.json"]);
  for (const [label, run] of [
    ["add", () => addDefinition(fixture, definition({ database: { databaseId: "billing" } }))],
    ["add of the registered definition", () => addDefinition(fixture, definition())],
    ["list", () => list(fixture)],
    ["remove", () => remove(fixture, "orders")]
  ]) {
    refused(await run(), "VES_DATABASE_DIRECTORY_INVALID", 5, label);
    assert.deepEqual(await snapshot(outside), before, label);
  }
});

test("add reads the passphrase only for a valid definition", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  succeeded(await addDefinition(fixture, definition()), "add with the passphrase bound");
  await storeItems([]);
  try {
    const before = await credentialLookups();
    const missing = refused(
      await addDefinition(fixture, definition({ database: { databaseId: "billing" } })),
      "VES_TASK_NOT_CONFIGURED",
      5,
      "no passphrase"
    );
    assert.deepEqual(missing.safeDetails, { requirement: SIGNING });
    assert.deepEqual(await databaseEntries(fixture), ["orders.json"]);
    assert.ok((await credentialLookups()) > before, "the credential store was not asked");
    const asked = await credentialLookups();
    refused(
      await addDefinition(fixture, definition({ database: { databaseId: "billing", engine: "db2" } })),
      "VES_DATABASE_ENGINE_UNSUPPORTED",
      5,
      "engine db2"
    );
    assert.equal(await credentialLookups(), asked, "a refused definition read a credential");
    assert.deepEqual(
      succeeded(await list(fixture), "list").databases.map((entry) => [entry.databaseId, entry.state]),
      [["orders", "valid"]]
    );
    assert.deepEqual(succeeded(await remove(fixture, "orders"), "remove"), { databaseId: "orders", removed: true });
    assert.equal(await credentialLookups(), asked, "list or remove read a credential");
    assert.deepEqual(await databaseEntries(fixture), []);
  } finally {
    await storeItems([SIGNING]);
  }
});

test("database commands start only Git and the credential tool", TIMEOUT, async () => {
  const fixture = await fixtures.taskFixture();
  const path = await definitionFile(fixture, definition());
  const allowed = (file) => ["git", "git.exe"].includes(basename(file).toLowerCase()) || CREDENTIAL_TOOL.test(file);
  const observe = async (label, run) => {
    started.length = 0;
    recording = true;
    let result;
    try {
      result = await run();
    } finally {
      recording = false;
    }
    succeeded(result, label);
    const files = [...started];
    assert.ok(files.length > 0, `${label} started nothing the spy saw`);
    assert.deepEqual(
      files.filter((file) => !allowed(file)),
      [],
      `${label} started another executable`
    );
    return files;
  };
  const added = await observe("add", () => add(fixture, path));
  assert.ok(
    added.some((file) => CREDENTIAL_TOOL.test(file)),
    `add read no credential: ${added.join(", ")}`
  );
  assert.ok(
    added.some((file) => !CREDENTIAL_TOOL.test(file)),
    `add located no Workspace: ${added.join(", ")}`
  );
  for (const [label, run] of [
    ["list", () => list(fixture)],
    ["remove", () => remove(fixture, "orders")]
  ]) {
    const files = await observe(label, run);
    assert.deepEqual(
      files.filter((file) => CREDENTIAL_TOOL.test(file)),
      [],
      `${label} started a credential tool`
    );
  }
});

test("main routes a vestra database command to the database commands", TIMEOUT, async (t) => {
  const { main } = await import("../../apps/vestra-cli/src/main.ts");
  const root = await temporaryDirectory(t, "vdm-");
  const cwd = process.cwd();
  const write = process.stdout.write;
  let stdout = "";
  let exitCode;
  // why: the CLI writes its envelope as text; the test runner's own messages
  // to its parent are binary and pass through untouched.
  process.stdout.write = function capture(chunk, ...rest) {
    if (typeof chunk !== "string") return write.call(this, chunk, ...rest);
    stdout += chunk;
    return true;
  };
  process.chdir(root);
  try {
    exitCode = await main("vestra", ["database", "list", "--output", "json"]);
  } finally {
    process.chdir(cwd);
    process.stdout.write = write;
  }
  const envelope = JSON.parse(stdout);
  assert.equal(exitCode, 5, stdout);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.command, "database list");
  assert.equal(envelope.error.code, "VES_INIT_WORKSPACE_MISSING");
  assert.deepEqual(await readdir(root), []);
});
