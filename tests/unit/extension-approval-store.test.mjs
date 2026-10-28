// invariant: door 3 of .specs/features/probe-host-composition/plan.md. An
// extension approval is a DSSE envelope at
// `<Workspace state>/extension-approvals/<approvalRef>.json`, a revocation is
// `<approvalRef>.revoked.json`, and the lookup admission consults answers only
// with an approval whose signature verifies, that has not expired, and that no
// revocation file names.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { ExtensionApprovalStore } from "../../apps/vestra-cli/src/extension/extension-approval-store.ts";
import { EVIDENCE_KEY_ID, EVIDENCE_PURPOSES } from "../../apps/vestra-cli/src/task/task-signing.ts";

const BASE = "https://accd.github.io/verchestra/attestation";
const APPROVED_AT = new Date("2026-10-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5 })));
});

function body(approvalRef, overrides = {}) {
  return {
    approvalRef,
    extensionId: "plugin:acme-orders-probe",
    lockDigest: `sha256:${"1".repeat(64)}`,
    componentDigest: `sha256:${"2".repeat(64)}`,
    launchDigest: `sha256:${"3".repeat(64)}`,
    launch: { executable: "/usr/bin/node", args: ["--no-warnings"], environment: { PROBE_REGION: "eu" } },
    approvedAt: APPROVED_AT.toISOString(),
    expiresAt: new Date(APPROVED_AT.getTime() + 30 * DAY).toISOString(),
    ...overrides
  };
}

// why: the clock is the store's own, so a test moves time without waiting.
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "vas-"));
  roots.push(root);
  const signer = NodeEd25519Signer.generate({ keyId: EVIDENCE_KEY_ID, purposes: [...EVIDENCE_PURPOSES] });
  const trust = createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [signer.publicKeyRef] });
  const clock = { now: new Date(APPROVED_AT.getTime() + 1000) };
  const directory = join(root, "extension-approvals");
  const store = new ExtensionApprovalStore({ directory, trust: async () => trust, now: () => clock.now });
  return { root, directory, signer, trust, clock, store };
}

function statementOf(envelope) {
  return JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
}

test("approval and revocation records have their declared shape", async () => {
  const { directory, signer, store } = await setup();
  const approval = body("orders-probe-001");
  await store.record(approval, signer);
  const recorded = JSON.parse(await readFile(join(directory, "orders-probe-001.json"), "utf8"));
  assert.deepEqual(Object.keys(recorded).sort(), ["payload", "payloadType", "signatures"]);
  assert.equal(recorded.payloadType, "application/vnd.in-toto+json");
  assert.equal(recorded.signatures.length, 1);
  assert.equal(recorded.signatures[0].keyid, EVIDENCE_KEY_ID);
  const statement = statementOf(recorded);
  assert.equal(statement.predicateType, `${BASE}/extension-approval/v1`);
  assert.equal(statement.predicate.binding.purpose, "approval");
  assert.deepEqual(Object.keys(statement.predicate.content).sort(), [
    "approvalRef",
    "approvedAt",
    "componentDigest",
    "expiresAt",
    "extensionId",
    "launch",
    "launchDigest",
    "lockDigest"
  ]);
  assert.deepEqual(statement.predicate.content, approval);
  const revocation = await store.revoke("orders-probe-001", signer);
  assert.deepEqual(Object.keys(revocation).sort(), ["approvalRef", "revokedAt"]);
  const revoked = JSON.parse(await readFile(join(directory, "orders-probe-001.revoked.json"), "utf8"));
  assert.deepEqual(Object.keys(revoked).sort(), ["payload", "payloadType", "signatures"]);
  const revokedStatement = statementOf(revoked);
  assert.equal(revokedStatement.predicateType, `${BASE}/extension-approval-revocation/v1`);
  assert.equal(revokedStatement.predicate.binding.purpose, "approval");
  assert.deepEqual(revokedStatement.predicate.content, revocation);
  assert.deepEqual((await readdir(directory)).sort(), ["orders-probe-001.json", "orders-probe-001.revoked.json"]);
});

test("lookup returns only a verified, unexpired, unrevoked approval", async () => {
  const { directory, signer, clock, store } = await setup();
  const untouched = body("untouched");
  await store.record(untouched, signer);
  await store.record(body("edited"), signer);
  await store.record(body("expiring", { expiresAt: new Date(APPROVED_AT.getTime() + DAY).toISOString() }), signer);
  await store.record(body("revoked"), signer);
  // Edited: the signed payload names another launch; the signature is kept.
  const path = join(directory, "edited.json");
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const statement = statementOf(envelope);
  statement.predicate.content.launchDigest = `sha256:${"9".repeat(64)}`;
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  await store.revoke("revoked", signer);
  // why: before time moves, the expiring approval is still answered, so only
  // its expiry can explain the answer below.
  assert.deepEqual(
    await store.lookup("expiring"),
    body("expiring", { expiresAt: new Date(APPROVED_AT.getTime() + DAY).toISOString() })
  );
  clock.now = new Date(APPROVED_AT.getTime() + 2 * DAY);
  assert.deepEqual(await store.lookup("untouched"), untouched);
  assert.equal(await store.lookup("edited"), undefined);
  assert.equal(await store.lookup("expiring"), undefined);
  assert.equal(await store.lookup("revoked"), undefined);
  assert.equal(await store.lookup("never-recorded"), undefined);
  // invariant: a revocation fails closed; one whose signature does not verify
  // still blocks the approval it names.
  await store.record(body("forged-revocation"), signer);
  await writeFile(join(directory, "forged-revocation.revoked.json"), "{}");
  assert.equal(await store.lookup("forged-revocation"), undefined);
});

test("two concurrent approvals for one ref leave one record", async () => {
  const { directory, signer, store } = await setup();
  const first = body("orders-probe-001");
  const second = body("orders-probe-001", { launchDigest: `sha256:${"4".repeat(64)}` });
  const outcomes = await Promise.allSettled([store.record(first, signer), store.record(second, signer)]);
  const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.envelope.code, "VES_EXTENSION_APPROVAL_EXISTS");
  assert.deepEqual(await readdir(directory), ["orders-probe-001.json"]);
  const winner = outcomes[0].status === "fulfilled" ? first : second;
  assert.deepEqual(await store.lookup("orders-probe-001"), winner);
});
