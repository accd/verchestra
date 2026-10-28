// invariant: doors 1 and 2 of .specs/features/probe-host-composition/plan.md.
// The skill lock `vestra extension add` writes is `.verchestra/skills.lock.json`,
// replaced atomically with the previous generation kept beside it, and every
// signature in it is a DSSE envelope sealed by the Workspace evidence key under
// its existing `approval` purpose and verified against the pinned anchor alone.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { skillLockDigest } from "../../packages/agent-runtime/src/index.ts";
import { NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import {
  SkillLockFile,
  activateLock,
  extensionRegistry,
  sealSkillLock,
  sealWorkerSkill,
  workspaceLockVerifier
} from "../../apps/vestra-cli/src/extension/skill-lock-file.ts";
import {
  EVIDENCE_KEY_ID,
  EVIDENCE_PURPOSES,
  workspaceSigner,
  workspaceTrustRoot
} from "../../apps/vestra-cli/src/task/task-signing.ts";

const PASSPHRASE = "skill-lock-unit-passphrase";
// why: the exact bytes `vestra init` writes (packages/workspace/src/init/safe-init.ts).
const PLACEHOLDER = '{\n  "schemaVersion": 1,\n  "skills": []\n}\n';
const PREDICATE = "https://accd.github.io/verchestra/attestation/skill-lock/v1";
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

function worker(overrides = {}) {
  return {
    skillId: "acme-orders-probe",
    version: "1.0.0",
    license: "MIT",
    repository: "https://example.invalid/acme/orders.git",
    commit: "a".repeat(40),
    entry: { path: "probe/worker.mjs", digest: `sha256:${"d".repeat(64)}` },
    extensionId: "plugin:acme-orders-probe",
    approvalRef: "orders-probe-001",
    ...overrides
  };
}

function registration(input) {
  return {
    skillId: input.skillId,
    extensionId: input.extensionId,
    entryDigest: input.entry.digest,
    registeredAt: "2026-10-28T12:00:00.000Z"
  };
}

function requestFor(input) {
  return { skillId: input.skillId, extensionId: input.extensionId, entryPath: input.entry.path };
}

// why: a Workspace with `init`'s placeholder lock and its own evidence key,
// whose public half is pinned in the anchor file as task commands pin it.
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vsl-"));
  roots.push(root);
  const controlRoot = join(root, "repo");
  await mkdir(join(controlRoot, ".verchestra"), { recursive: true });
  await writeFile(join(controlRoot, ".verchestra", "skills.lock.json"), PLACEHOLDER);
  const workspaceRoot = join(root, "state");
  await mkdir(workspaceRoot, { recursive: true });
  const workspace = {
    workspaceId: "workspace_4b1c2d3e-5f60-4a7b-8c9d-0e1f2a3b4c5d",
    repositoryRoot: controlRoot,
    layout: { workspaceRoot },
    keysRoot: join(workspaceRoot, "keys"),
    tasksRoot: join(workspaceRoot, "tasks"),
    verificationRoot: join(workspaceRoot, "verification")
  };
  const signer = await workspaceSigner(workspace, PASSPHRASE);
  return { controlRoot, workspace, signer, file: new SkillLockFile(controlRoot) };
}

async function activate({ file, workspace, signer }, generation, inputs) {
  const skills = [];
  for (const input of inputs) skills.push(await sealWorkerSkill(signer, input));
  const candidate = await sealSkillLock(signer, { generation, skills });
  const registry = extensionRegistry(workspaceLockVerifier(await workspaceTrustRoot(workspace)), file.transaction());
  const last = inputs.at(-1);
  await activateLock({
    registry,
    file,
    current: await file.read(),
    candidate,
    registration: registration(last),
    entryPath: last.entry.path
  });
  return candidate;
}

function statementOf(envelope) {
  assert.equal(envelope.payloadType, "application/vnd.in-toto+json");
  return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
}

test("a lock the store writes verifies against the pinned anchor", async () => {
  const context = await setup();
  const input = worker();
  await activate(context, 1, [input]);
  const onDisk = await context.file.read();
  assert.equal(onDisk.kind, "lock");
  // why: the anchor is read back from its file, so verification uses the
  // pinned public key and no passphrase.
  const verifier = workspaceLockVerifier(await workspaceTrustRoot(context.workspace));
  assert.equal(await verifier.verifyLock(onDisk.lock), true);
  assert.equal(await verifier.verifySource(onDisk.lock.skills[0]), true);
  const resolved = await extensionRegistry(verifier).resolveExecutableExtension(onDisk.lock, requestFor(input));
  assert.equal(resolved.lockDigest, onDisk.lock.lockDigest);
  assert.deepEqual(resolved.entry, input.entry);
  assert.deepEqual(resolved.extensionRef, { kind: "plugin", id: input.extensionId, approvalRef: input.approvalRef });
  // why: a sensor; another key under the same id and purposes does not verify it.
  const stranger = NodeEd25519Signer.generate({ keyId: EVIDENCE_KEY_ID, purposes: [...EVIDENCE_PURPOSES] });
  const strangerVerifier = workspaceLockVerifier(
    createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [stranger.publicKeyRef] })
  );
  assert.equal(await strangerVerifier.verifyLock(onDisk.lock), false);
  assert.equal(await strangerVerifier.verifySource(onDisk.lock.skills[0]), false);
  await assert.rejects(
    extensionRegistry(strangerVerifier).resolveExecutableExtension(onDisk.lock, requestFor(input)),
    (error) => error.code === "VES_SKILL_SIGNATURE_INVALID"
  );
});

test("the init placeholder becomes generation 1", async () => {
  const context = await setup();
  const before = await context.file.read();
  assert.equal(before.kind, "bootstrap");
  assert.equal(before.digest, `sha256:${createHash("sha256").update(PLACEHOLDER).digest("hex")}`);
  const candidate = await activate(context, 1, [worker()]);
  const text = await readFile(join(context.controlRoot, ".verchestra", "skills.lock.json"), "utf8");
  const written = JSON.parse(text);
  assert.equal(written.schemaVersion, 1);
  assert.equal(written.generation, 1);
  assert.equal(written.lockDigest, candidate.lockDigest);
  assert.equal(written.lockDigest, skillLockDigest(written));
  assert.equal(written.skills.length, 1);
  const after = await context.file.read();
  assert.equal(after.kind, "lock");
  assert.equal(after.lock.generation, 1);
  // why: staging leaves nothing behind once the generation is in place.
  assert.deepEqual(await readdir(join(context.controlRoot, ".verchestra")), ["skills.lock.json"]);
});

test("the previous generation is kept for rollback", async () => {
  const context = await setup();
  await activate(context, 1, [worker()]);
  const lockPath = join(context.controlRoot, ".verchestra", "skills.lock.json");
  const generationOne = await readFile(lockPath);
  const second = worker({
    skillId: "acme-billing-probe",
    extensionId: "plugin:acme-billing-probe",
    approvalRef: "billing-probe-001",
    entry: { path: "probe/billing.mjs", digest: `sha256:${"e".repeat(64)}` }
  });
  const onDiskOne = await context.file.read();
  const candidate = await activate(context, 2, [worker(), second]);
  assert.equal(candidate.generation, 2);
  const kept = await readFile(join(context.controlRoot, ".verchestra", "skills.lock.1.json"));
  assert.deepEqual(kept, generationOne);
  assert.equal(JSON.parse(kept.toString("utf8")).lockDigest, onDiskOne.lock.lockDigest);
  const current = await context.file.read();
  assert.equal(current.lock.generation, 2);
  assert.deepEqual(
    current.lock.skills.map((skill) => skill.id),
    ["acme-orders-probe", "acme-billing-probe"]
  );
  assert.deepEqual((await readdir(join(context.controlRoot, ".verchestra"))).sort(), [
    "skills.lock.1.json",
    "skills.lock.json"
  ]);
});

test("an edited lock fails its signature", async () => {
  const context = await setup();
  const input = worker();
  await activate(context, 1, [input]);
  const { lock } = await context.file.read();
  const registry = extensionRegistry(workspaceLockVerifier(await workspaceTrustRoot(context.workspace)));
  // why: the unedited copy is accepted, so the signature decides the edited ones.
  const resolved = await registry.resolveExecutableExtension(structuredClone(lock), requestFor(input));
  assert.equal(resolved.lockDigest, lock.lockDigest);
  // An edit whose digest is recomputed, as anyone can recompute it, still
  // fails the lock signature.
  const edited = structuredClone(lock);
  edited.skills[0].version = "1.0.1";
  edited.lockDigest = skillLockDigest(edited);
  await assert.rejects(
    registry.resolveExecutableExtension(edited, requestFor(input)),
    (error) => error.code === "VES_SKILL_SIGNATURE_INVALID" && error.message === "Skill lock signature is invalid"
  );
  // A source edited under a lock signed again still fails its own signature.
  const source = structuredClone(lock);
  source.skills[0].source.repository = "https://example.invalid/mallory/orders.git";
  const resealed = await sealSkillLock(context.signer, { generation: 1, skills: source.skills });
  await assert.rejects(
    registry.resolveExecutableExtension(resealed, requestFor(input)),
    (error) => error.code === "VES_SKILL_SIGNATURE_INVALID" && error.message === "Skill source signature is invalid"
  );
});

test("lock signatures use the existing approval purpose", async () => {
  const context = await setup();
  await activate(context, 1, [worker()]);
  const { lock } = await context.file.read();
  for (const envelope of [lock.signature, lock.skills[0].source.signature]) {
    assert.deepEqual(Object.keys(envelope).sort(), ["payload", "payloadType", "signatures"]);
    const statement = statementOf(envelope);
    assert.equal(statement.predicateType, PREDICATE);
    assert.equal(statement.predicate.binding.purpose, "approval");
    assert.equal(envelope.signatures[0].keyid, EVIDENCE_KEY_ID);
  }
  assert.deepEqual(statementOf(lock.signature).predicate.content, {
    schemaVersion: lock.schemaVersion,
    generation: lock.generation,
    skills: lock.skills
  });
  // invariant: the Workspace key keeps exactly the purposes it was created
  // with; a stored key whose purposes differ would refuse to unlock.
  assert.deepEqual([...EVIDENCE_PURPOSES], ["execution-package", "approval", "run-capsule", "context-manifest"]);
  const keyFile = join(
    context.workspace.layout.workspaceRoot,
    "keys",
    `${createHash("sha256").update(EVIDENCE_KEY_ID).digest("hex")}.key.json`
  );
  assert.deepEqual(JSON.parse(await readFile(keyFile, "utf8")).publicKeyRef.purposes, [...EVIDENCE_PURPOSES]);
  const anchor = JSON.parse(await readFile(join(context.workspace.keysRoot, "task-evidence-trust.json"), "utf8"));
  assert.deepEqual(anchor.publicKeyRef.purposes, [...EVIDENCE_PURPOSES]);
  const reopened = await workspaceSigner(context.workspace, PASSPHRASE);
  assert.equal(reopened.publicKeyRef.publicKey, context.signer.publicKeyRef.publicKey);
});
