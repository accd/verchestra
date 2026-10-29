// invariant: doors 1 and 2 of .specs/features/database-registration/plan.md.
// A Workspace database registration is `.verchestra/databases/<databaseId>.json`,
// a DSSE envelope sealed by the Workspace evidence key under its existing
// `approval` purpose, created exclusively and never rewritten; the store over
// those files answers only registrations whose envelope verifies against the
// pinned anchor and whose body re-validates.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { normalizeDatabaseAccessPolicy, normalizeDatabaseRegistration } from "../../packages/data-probe/src/index.ts";
import {
  ArtifactSealer,
  NodeEd25519Signer,
  canonicalizeJsonForVersion,
  createTrustRoot,
  sealedArtifactFromEnvelope,
  sha256DigestForVersion
} from "../../packages/evidence/src/index.ts";
import {
  DatabaseRegistrationFiles,
  WorkspaceDatabaseRegistrationStore,
  sealRegistration
} from "../../apps/vestra-cli/src/database/database-registration-file.ts";
import {
  EVIDENCE_KEY_ID,
  EVIDENCE_PURPOSES,
  workspaceSigner,
  workspaceTrustRoot
} from "../../apps/vestra-cli/src/task/task-signing.ts";
import { linkDirectory, linkFile } from "../helpers/windows-links.mjs";

const WIN32 = process.platform === "win32";
const PASSPHRASE = "database-registration-unit-passphrase";
const WORKSPACE_ID = "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_WORKSPACE_ID = "workspace_018f0b6d-7b1a-7abc-8def-1123456789ab";
const PREDICATE = "https://accd.github.io/verchestra/attestation/database-registration/v1";
const REGISTERED_AT = "2026-10-29T10:00:00.000Z";
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

// why: the fixture database is PostgreSQL `orders` with policy maxRows 100;
// a case names only what it changes.
function registrationOf(databaseId, overrides = {}) {
  return normalizeDatabaseRegistration({
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
    databaseId,
    engine: "postgresql",
    logicalEnvironment: "production",
    classification: "confidential",
    approvedSchemas: ["public", "sales"],
    schemaSourceRefs: ["repo:db/migrations"],
    allowedPurposes: ["schema-discovery"],
    logicalCredentialName: "orders-reader",
    production: true,
    ...overrides,
    policyRef: databaseId
  });
}

function policyOf(databaseId, overrides = {}) {
  return {
    allowedObjects: ["public.orders", "sales.invoices"],
    allowedFunctions: ["count", "sum"],
    deniedFunctions: ["pg_read_file"],
    allowCatalogAccess: false,
    maxTimeoutMs: 5_000,
    maxRows: 100,
    maxBytes: 1_048_576,
    maxConcurrency: 2,
    ...overrides,
    policyRef: databaseId
  };
}

function documentOf(databaseId, { registration = {}, policy = {} } = {}) {
  return {
    registration: registrationOf(databaseId, registration),
    policy: normalizeDatabaseAccessPolicy(policyOf(databaseId, policy)),
    registeredAt: REGISTERED_AT
  };
}

// why: one Workspace evidence key, pinned in its anchor file as the task
// commands pin it, serves every repository a case creates.
async function evidenceKey() {
  const root = await mkdtemp(join(tmpdir(), "vdr-"));
  roots.push(root);
  const workspaceRoot = join(root, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = {
    workspaceId: WORKSPACE_ID,
    layout: { workspaceRoot },
    keysRoot: join(workspaceRoot, "keys"),
    tasksRoot: join(workspaceRoot, "tasks"),
    verificationRoot: join(workspaceRoot, "verification")
  };
  const signer = await workspaceSigner(workspace, PASSPHRASE);
  return { root, workspace, signer, trust: () => workspaceTrustRoot(workspace) };
}

async function repository(key, name = "repo") {
  const repositoryRoot = join(key.root, name);
  await mkdir(join(repositoryRoot, ".verchestra"), { recursive: true });
  const options = { repositoryRoot, workspaceId: WORKSPACE_ID, trust: key.trust };
  return {
    repositoryRoot,
    options,
    directory: join(repositoryRoot, ".verchestra", "databases"),
    files: new DatabaseRegistrationFiles(options),
    store: new WorkspaceDatabaseRegistrationStore(options)
  };
}

const registrationPath = (context, databaseId) => join(context.directory, `${databaseId}.json`);

function statementOf(envelope) {
  assert.equal(envelope.payloadType, "application/vnd.in-toto+json");
  return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
}

function expectationFor(databaseId, statement) {
  return {
    schema: { name: "database-registration", version: 1 },
    purpose: "approval",
    bindingId: `database-registration:${databaseId}`,
    sourceStateDigest: statement.predicate.binding.sourceStateDigest,
    now: new Date()
  };
}

async function verify(key, databaseId, envelope) {
  const sealer = new ArtifactSealer({ signer: key.signer });
  return sealer.verify(
    sealedArtifactFromEnvelope(envelope),
    await key.trust(),
    expectationFor(databaseId, statementOf(envelope))
  );
}

// why: an edit whose content digest is recomputed, as anyone can recompute
// it, so only the signature can refuse it.
function editedEnvelope(envelope, edit) {
  const statement = statementOf(envelope);
  edit(statement.predicate.content);
  statement.subject[0].digest.sha256 = sha256DigestForVersion(1, statement.predicate.content);
  const payload = Buffer.from(canonicalizeJsonForVersion(1, statement), "utf8").toString("base64");
  return { ...envelope, payload };
}

async function entries(path) {
  try {
    return (await readdir(path)).sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const json = (value) => JSON.parse(JSON.stringify(value));

test("a registration the store writes verifies against the pinned anchor", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  const document = documentOf("orders");
  assert.deepEqual(await context.files.create(document, key.signer), { created: true });
  assert.deepEqual(await entries(context.directory), ["orders.json"]);
  const envelope = JSON.parse(await readFile(registrationPath(context, "orders"), "utf8"));
  assert.deepEqual(Object.keys(envelope).sort(), ["payload", "payloadType", "signatures"]);
  assert.equal(envelope.signatures.length, 1);
  assert.equal(envelope.signatures[0].keyid, EVIDENCE_KEY_ID);
  const statement = statementOf(envelope);
  assert.equal(statement.predicateType, PREDICATE);
  assert.equal(statement.predicate.binding.purpose, "approval");
  assert.equal(statement.predicate.binding.bindingId, "database-registration:orders");
  assert.deepEqual(statement.predicate.content, json(document));
  // why: the anchor is read back from its file, so verification uses the
  // pinned public key and no passphrase.
  const verified = await verify(key, "orders", envelope);
  assert.equal(verified.ok, true, JSON.stringify(verified));
  assert.deepEqual(json(await context.store.load(WORKSPACE_ID, "orders")), json(document.registration));
  // why: a sensor; another key under the same id and purposes verifies nothing.
  const stranger = NodeEd25519Signer.generate({ keyId: EVIDENCE_KEY_ID, purposes: [...EVIDENCE_PURPOSES] });
  const strangerTrust = createTrustRoot({
    trustRootId: "workspace-task-evidence",
    version: 1,
    keys: [stranger.publicKeyRef]
  });
  const strangerStore = new WorkspaceDatabaseRegistrationStore({
    ...context.options,
    trust: async () => strangerTrust
  });
  assert.equal(await strangerStore.load(WORKSPACE_ID, "orders"), undefined);
  // invariant: the Workspace key keeps exactly the purposes it was created
  // with; a stored key whose purposes differ would refuse to unlock.
  assert.deepEqual([...EVIDENCE_PURPOSES], ["execution-package", "approval", "run-capsule", "context-manifest"]);
  const keyFile = join(
    key.workspace.layout.workspaceRoot,
    "keys",
    `${createHash("sha256").update(EVIDENCE_KEY_ID).digest("hex")}.key.json`
  );
  assert.deepEqual(JSON.parse(await readFile(keyFile, "utf8")).publicKeyRef.purposes, [...EVIDENCE_PURPOSES]);
  const anchor = JSON.parse(await readFile(join(key.workspace.keysRoot, "task-evidence-trust.json"), "utf8"));
  assert.deepEqual(anchor.publicKeyRef.purposes, [...EVIDENCE_PURPOSES]);
});

test("an edited registration fails its signature", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  const document = documentOf("orders");
  await context.files.create(document, key.signer);
  const path = registrationPath(context, "orders");
  const original = await readFile(path);
  const envelope = JSON.parse(original.toString("utf8"));
  const edited = editedEnvelope(envelope, (content) => {
    content.policy.maxRows = 200;
  });
  const editedPolicy = statementOf(edited).predicate.content.policy;
  // why: the edited body is itself a valid policy, so no body check refuses it.
  assert.deepEqual(json(normalizeDatabaseAccessPolicy(editedPolicy)), editedPolicy);
  const refused = await verify(key, "orders", edited);
  assert.deepEqual(refused, { ok: false, code: "VES_SIGNATURE_INVALID" });
  await writeFile(path, `${JSON.stringify(edited)}\n`);
  assert.equal(await context.store.load(WORKSPACE_ID, "orders"), undefined);
  assert.deepEqual(await context.store.list(WORKSPACE_ID), []);
  // The unedited copy verifies, so the signature decided.
  assert.equal((await verify(key, "orders", envelope)).ok, true);
  await writeFile(path, original);
  assert.deepEqual(json(await context.store.load(WORKSPACE_ID, "orders")), json(document.registration));
});

test("two concurrent adds of one id write one file", async () => {
  const key = await evidenceKey();
  for (let round = 0; round < 25; round += 1) {
    const context = await repository(key, `repo-${round}`);
    const writers = [new DatabaseRegistrationFiles(context.options), new DatabaseRegistrationFiles(context.options)];
    const documents = [documentOf("orders"), documentOf("orders", { policy: { maxRows: 200 } })];
    const results = await Promise.allSettled(writers.map((files, index) => files.create(documents[index], key.signer)));
    const won = results.findIndex((result) => result.status === "fulfilled");
    assert.notEqual(won, -1, `round ${round}: no writer won`);
    const lost = 1 - won;
    assert.deepEqual(results[won].value, { created: true }, `round ${round}`);
    assert.equal(results[lost].status, "rejected", `round ${round}: both writers succeeded`);
    assert.equal(results[lost].reason.code, "VES_DATABASE_REGISTRATION_CONFLICT", `round ${round}`);
    // The file verifies and holds the winner's registration and policy.
    const envelope = JSON.parse(await readFile(registrationPath(context, "orders"), "utf8"));
    assert.equal((await verify(key, "orders", envelope)).ok, true, `round ${round}`);
    assert.deepEqual(statementOf(envelope).predicate.content, json(documents[won]), `round ${round}`);
    const evaluation = await context.files.evaluate("orders");
    assert.equal(evaluation.state, "valid", `round ${round}`);
    assert.deepEqual(json(evaluation.document.policy), json(documents[won].policy), `round ${round}`);
    // No temporary file is left, in the directory or beside it.
    assert.deepEqual(await entries(context.directory), ["orders.json"], `round ${round}`);
    assert.deepEqual(await entries(join(context.repositoryRoot, ".verchestra")), ["databases"], `round ${round}`);
  }
});

// why: each of the entries `vestra database list` reports invalid (C13).
async function invalidEntries(key, context) {
  const outside = join(key.root, "outside");
  await mkdir(outside, { recursive: true });
  await context.files.create(documentOf("edited"), key.signer);
  const editedPath = registrationPath(context, "edited");
  const edited = editedEnvelope(JSON.parse(await readFile(editedPath, "utf8")), (content) => {
    content.policy.maxRows = 200;
  });
  await writeFile(editedPath, `${JSON.stringify(edited)}\n`);
  const zero = { ...documentOf("zero"), policy: policyOf("zero", { maxRows: 0 }) };
  await writeFile(registrationPath(context, "zero"), JSON.stringify(await sealRegistration(key.signer, zero)));
  const foreign = {
    ...documentOf("foreign"),
    registration: registrationOf("foreign", { workspaceId: OTHER_WORKSPACE_ID })
  };
  await writeFile(registrationPath(context, "foreign"), JSON.stringify(await sealRegistration(key.signer, foreign)));
  await context.files.create(documentOf("renamed"), key.signer);
  await rename(registrationPath(context, "renamed"), registrationPath(context, "other"));
  // why: the link's target is a registration that would verify as `linked`
  // if it were followed; on Windows a file link needs Developer Mode, so a
  // junction to a directory stands in for it (L-017).
  const target = join(outside, "linked.json");
  await writeFile(target, JSON.stringify(await sealRegistration(key.signer, documentOf("linked"))));
  if (WIN32) await linkDirectory(outside, registrationPath(context, "linked"));
  else await linkFile(target, registrationPath(context, "linked"));
  await writeFile(join(context.directory, "notes.txt"), "not a registration\n");
  return ["edited", "zero", "foreign", "other", "linked", "notes.txt"];
}

test("the store returns only registrations list reports valid", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  const orders = documentOf("orders");
  const billing = documentOf("billing", { registration: { engine: "mysql", production: false } });
  await context.files.create(orders, key.signer);
  await context.files.create(billing, key.signer);
  const invalid = await invalidEntries(key, context);
  assert.deepEqual(json(await context.store.load(WORKSPACE_ID, "orders")), json(orders.registration));
  for (const databaseId of [...invalid, "absent"])
    assert.equal(await context.store.load(WORKSPACE_ID, databaseId), undefined, databaseId);
  // A registration is answered only for this Workspace's own id.
  assert.equal(await context.store.load(OTHER_WORKSPACE_ID, "orders"), undefined);
  assert.equal(await context.store.load(OTHER_WORKSPACE_ID, "foreign"), undefined);
  assert.deepEqual(json(await context.store.list(WORKSPACE_ID)), json([billing.registration, orders.registration]));
  assert.deepEqual(await context.store.list(OTHER_WORKSPACE_ID), []);
  // The listing the command prints names every entry, invalid ones by name.
  assert.deepEqual(
    (await context.files.entries()).map((entry) => [
      entry.databaseId,
      entry.document === undefined ? "invalid" : "valid"
    ]),
    [
      ["billing", "valid"],
      ["edited", "invalid"],
      ["foreign", "invalid"],
      ["linked", "invalid"],
      ["notes.txt", "invalid"],
      ["orders", "valid"],
      ["other", "invalid"],
      ["zero", "invalid"]
    ]
  );
});

test("the store's save writes nothing", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  await assert.rejects(context.store.save(registrationOf("orders")), (error) => {
    assert.equal(error.code, "VES_DATABASE_REGISTRATION_INVALID");
    return true;
  });
  assert.deepEqual(await entries(join(context.repositoryRoot, ".verchestra")), []);
  assert.equal(await context.store.load(WORKSPACE_ID, "orders"), undefined);
  // An existing registration is left as it was.
  await context.files.create(documentOf("orders"), key.signer);
  const before = await readFile(registrationPath(context, "orders"));
  await assert.rejects(context.store.save(registrationOf("orders", { classification: "secret" })), {
    code: "VES_DATABASE_REGISTRATION_INVALID"
  });
  assert.deepEqual(await readFile(registrationPath(context, "orders")), before);
  assert.deepEqual(await entries(context.directory), ["orders.json"]);
});

// why: what the registration file module does beyond the checks' cases, so
// each refusal it makes is proven where it is made.
test("a concurrent add of the same registration is no change", async () => {
  const key = await evidenceKey();
  for (let round = 0; round < 5; round += 1) {
    const context = await repository(key, `same-${round}`);
    const writers = [new DatabaseRegistrationFiles(context.options), new DatabaseRegistrationFiles(context.options)];
    const document = documentOf("orders");
    const results = await Promise.all(writers.map((files) => files.create(document, key.signer)));
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true], `round ${round}`);
    assert.deepEqual(await entries(context.directory), ["orders.json"], `round ${round}`);
  }
});

test("a registration is read only in the form add writes", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  await context.files.create(documentOf("orders"), key.signer);
  const seal = (document) => sealRegistration(key.signer, document);
  const write = async (databaseId, value) =>
    writeFile(registrationPath(context, databaseId), typeof value === "string" ? value : JSON.stringify(value));
  const { registrationDigest, ...unsorted } = registrationOf("unsorted");
  await write("extra", await seal({ ...documentOf("extra"), notes: "not part of a registration" }));
  await write("instant", await seal({ ...documentOf("instant"), registeredAt: "yesterday" }));
  await write(
    "unsorted",
    await seal({
      ...documentOf("unsorted"),
      registration: { ...unsorted, approvedSchemas: ["sales", "public"], registrationDigest }
    })
  );
  await write(
    "policy",
    await seal({ ...documentOf("policy"), policy: normalizeDatabaseAccessPolicy(policyOf("other")) })
  );
  await write("text", "{ not json\n");
  await write("large", JSON.stringify({ padding: "x".repeat(1024 * 1024) }));
  await mkdir(join(context.directory, "folder.json"));
  await writeFile(join(context.directory, "Upper.json"), await readFile(registrationPath(context, "orders")));
  const listed = (await context.files.entries()).map((entry) => [entry.databaseId, entry.document !== undefined]);
  assert.deepEqual(listed, [
    ["Upper", false],
    ["extra", false],
    ["folder", false],
    ["instant", false],
    ["large", false],
    ["orders", true],
    ["policy", false],
    ["text", false],
    ["unsorted", false]
  ]);
  for (const databaseId of ["extra", "instant", "unsorted", "policy", "text", "large", "folder"])
    assert.deepEqual(await context.files.evaluate(databaseId), { state: "invalid" }, databaseId);
  // A name that is no database id names no registration.
  for (const databaseId of ["Upper", "../orders", "orders/../orders"])
    assert.deepEqual(await context.files.evaluate(databaseId), { state: "absent" }, databaseId);
  // No anchor, nothing verifies.
  const unanchored = new DatabaseRegistrationFiles({ ...context.options, trust: async () => undefined });
  assert.deepEqual(await unanchored.evaluate("orders"), { state: "invalid" });
});

test("remove deletes only what names a registration file", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  await assert.rejects(context.files.remove("orders"), { code: "VES_DATABASE_NOT_FOUND" });
  await context.files.create(documentOf("orders"), key.signer);
  for (const databaseId of ["../orders", "Orders", "absent"])
    await assert.rejects(context.files.remove(databaseId), { code: "VES_DATABASE_NOT_FOUND" }, databaseId);
  // A directory in a registration's place is not deleted.
  await mkdir(join(context.directory, "folder.json"));
  await assert.rejects(context.files.remove("folder"), (error) => {
    assert.notEqual(error.code, "VES_DATABASE_NOT_FOUND");
    return true;
  });
  assert.deepEqual(await entries(context.directory), ["folder.json", "orders.json"]);
  await context.files.remove("orders");
  assert.deepEqual(await entries(context.directory), ["folder.json"]);
});

test("the registrations are never reached through a link", async () => {
  const key = await evidenceKey();
  const context = await repository(key);
  await context.files.create(documentOf("orders"), key.signer);
  const outside = join(key.root, "outside");
  await rename(context.directory, outside);
  await linkDirectory(outside, context.directory);
  const refused = { code: "VES_DATABASE_DIRECTORY_INVALID" };
  await assert.rejects(context.files.entries(), refused);
  await assert.rejects(context.files.evaluate("orders"), refused);
  await assert.rejects(context.files.create(documentOf("billing"), key.signer), refused);
  await assert.rejects(context.files.remove("orders"), refused);
  await assert.rejects(context.store.load(WORKSPACE_ID, "orders"), refused);
  assert.deepEqual(await entries(outside), ["orders.json"]);
  // A file in the directory's place is refused the same way.
  const fileInPlace = await repository(key, "file-in-place");
  await writeFile(fileInPlace.directory, "not a directory\n");
  await assert.rejects(fileInPlace.files.entries(), refused);
  await assert.rejects(fileInPlace.files.create(documentOf("orders"), key.signer), refused);
});
