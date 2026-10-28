// invariant: door 3 and AC 8 of .specs/features/probe-host-composition/plan.md.
// `list` reports every approval file in code-unit order of its reference, each
// `active`, `expired`, `revoked`, or `invalid` (its record does not verify),
// and reads nothing from an invalid one. The approvals directory is real: a
// file or link in its place is refused, never followed, and a read creates
// nothing. Only an approval that verifies can be revoked.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { ExtensionApprovalStore } from "../../apps/vestra-cli/src/extension/extension-approval-store.ts";
import { EVIDENCE_KEY_ID, EVIDENCE_PURPOSES } from "../../apps/vestra-cli/src/task/task-signing.ts";
import { temporaryDirectory } from "../helpers/temporary-directory.mjs";

const APPROVED_AT = new Date("2026-10-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function body(approvalRef, overrides = {}) {
  return {
    approvalRef,
    extensionId: `plugin:acme-${approvalRef}`,
    lockDigest: `sha256:${"1".repeat(64)}`,
    componentDigest: `sha256:${"2".repeat(64)}`,
    launchDigest: `sha256:${"3".repeat(64)}`,
    launch: { executable: "/usr/bin/node", args: [], environment: {} },
    approvedAt: APPROVED_AT.toISOString(),
    expiresAt: new Date(APPROVED_AT.getTime() + 30 * DAY).toISOString(),
    ...overrides
  };
}

// why: the clock is the store's own, so a test moves time without waiting.
async function setup(t, trusted = true) {
  const root = await temporaryDirectory(t, "val-");
  const signer = NodeEd25519Signer.generate({ keyId: EVIDENCE_KEY_ID, purposes: [...EVIDENCE_PURPOSES] });
  const trust = createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [signer.publicKeyRef] });
  const clock = { now: new Date(APPROVED_AT.getTime() + 1000) };
  const directory = join(root, "extension-approvals");
  const store = new ExtensionApprovalStore({
    directory,
    trust: async () => (trusted ? trust : undefined),
    now: () => clock.now
  });
  return { root, directory, signer, trust, clock, store };
}

function listed(approval, state) {
  return {
    approvalRef: approval.approvalRef,
    extensionId: approval.extensionId,
    componentDigest: approval.componentDigest,
    launchDigest: approval.launchDigest,
    expiresAt: approval.expiresAt,
    state
  };
}

function invalid(approvalRef) {
  return {
    approvalRef,
    extensionId: null,
    componentDigest: null,
    launchDigest: null,
    expiresAt: null,
    state: "invalid"
  };
}

test("list reports each approval in code-unit order with its state", async (t) => {
  const { directory, signer, clock, store } = await setup(t);
  assert.deepEqual(await store.list(), []);
  // why: a read of an absent store creates nothing.
  await assert.rejects(readdir(directory), { code: "ENOENT" });

  // why: code-unit order differs from insertion order here:
  // "-" (0x2d) < "1" (0x31) < "_" (0x5f) < "z" (0x7a).
  const active = body("orders-2");
  const expired = body("orders1", { expiresAt: new Date(APPROVED_AT.getTime() + DAY).toISOString() });
  const revoked = body("orders_1");
  const edited = body("ordersz");
  for (const approval of [edited, revoked, expired, active]) await store.record(approval, signer);
  await store.revoke(revoked.approvalRef, signer);
  const path = join(directory, "ordersz.json");
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  statement.predicate.content.expiresAt = new Date(APPROVED_AT.getTime() + 300 * DAY).toISOString();
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  // A record that is not JSON, and a directory under a record's name, are
  // listed invalid; a name that is no approval reference is not listed.
  await writeFile(join(directory, "not-json.json"), "{ not json\n");
  await mkdir(join(directory, "a-directory.json"));
  await writeFile(join(directory, "Upper.json"), "{}\n");
  await writeFile(join(directory, "notes.txt"), "not an approval\n");

  assert.deepEqual(await store.list(), [
    invalid("a-directory"),
    invalid("not-json"),
    listed(active, "active"),
    listed(expired, "active"),
    listed(revoked, "revoked"),
    invalid("ordersz")
  ]);
  clock.now = new Date(APPROVED_AT.getTime() + 2 * DAY);
  assert.deepEqual(
    (await store.list()).map((entry) => [entry.approvalRef, entry.state]),
    [
      ["a-directory", "invalid"],
      ["not-json", "invalid"],
      ["orders-2", "active"],
      ["orders1", "expired"],
      ["orders_1", "revoked"],
      ["ordersz", "invalid"]
    ]
  );
});

test("without a pinned anchor no approval verifies", async (t) => {
  const { signer, store } = await setup(t, false);
  const approval = body("orders-probe-001");
  await store.record(approval, signer);
  assert.equal(await store.exists(approval.approvalRef), true);
  assert.equal(await store.lookup(approval.approvalRef), undefined);
  assert.deepEqual(await store.list(), [invalid(approval.approvalRef)]);
  await assert.rejects(store.revoke(approval.approvalRef, signer), (error) => {
    assert.equal(error.envelope.code, "VES_EXTENSION_FAILED");
    assert.deepEqual(error.envelope.safeDetails, { reason: "VES_EXTENSION_APPROVAL_INVALID" });
    return true;
  });
});

test("only an approval that verifies is revoked", async (t) => {
  const { directory, signer, store } = await setup(t);
  await store.record(body("edited"), signer);
  const path = join(directory, "edited.json");
  const envelope = JSON.parse(await readFile(path, "utf8"));
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
  statement.predicate.content.launchDigest = `sha256:${"9".repeat(64)}`;
  envelope.payload = Buffer.from(JSON.stringify(statement), "utf8").toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(
    store.revoke("edited", signer),
    (error) => error.envelope.safeDetails.reason === "VES_EXTENSION_APPROVAL_INVALID"
  );
  assert.deepEqual(await readdir(directory), ["edited.json"]);
});

test("exists answers for a record on file, and a malformed reference names none", async (t) => {
  const { signer, store } = await setup(t);
  assert.equal(await store.exists("orders-probe-001"), false);
  await store.record(body("orders-probe-001"), signer);
  assert.equal(await store.exists("orders-probe-001"), true);
  assert.equal(await store.exists("billing-probe"), false);
  for (const malformed of ["Orders", "orders.revoked", "../orders", ""]) {
    assert.equal(await store.lookup(malformed), undefined, malformed);
    await assert.rejects(
      store.exists(malformed),
      (error) => error.envelope.code === "VES_EXTENSION_APPROVAL_NOT_FOUND",
      malformed
    );
  }
});

test("an approvals path that is not a directory is refused", async (t) => {
  const { directory, signer, store } = await setup(t);
  await writeFile(directory, "not a directory\n");
  const refusal = (error) =>
    error.envelope.code === "VES_EXTENSION_FAILED" && error.envelope.safeDetails.reason === "VES_STATE_ROOT_ESCAPE";
  await assert.rejects(store.list(), refusal);
  await assert.rejects(store.exists("orders-probe-001"), refusal);
  await assert.rejects(store.record(body("orders-probe-001"), signer), refusal);
  await assert.rejects(store.assertRevocable("orders-probe-001"), refusal);
  assert.equal(await readFile(directory, "utf8"), "not a directory\n");
});
