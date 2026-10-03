// invariant: an approval request is what a human reviews and what every later
// check rebuilds, and its sealed approval is what `task approve` persists. The
// golden values were recorded from the approval module as it stood before each
// approval operation declared its own ports (revision c7755c4), so a moved
// byte, digest or identity fails here.
import assert from "node:assert/strict";
import { test } from "node:test";

import { ApprovalRecorder, ApprovalRequester, ApprovalVerifier } from "../../packages/application/src/index.ts";
import { FixedClock, IsoInstant, canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { ArtifactSealer, NodeEd25519Signer, createTrustRoot } from "../../packages/evidence/src/index.ts";
import { NodeContentDigest } from "../../packages/platform-node/src/index.ts";
import { MemoryAuthorityStore, intent, now, review } from "../helpers/authority-fixture.mjs";

const approver = { kind: "human", id: "human:local-operator" };
const contentDigest = new NodeContentDigest();
const digestOf = (value) => contentDigest.sha256(canonicalizeJsonV2(value));

// why: a sealed approval is byte-stable only under a fixed signing seed; the
// PKCS #8 header is the fixed DER prefix of every Ed25519 private key.
const PKCS8_ED25519_HEADER = Buffer.from("302e020100300506032b657004220420", "hex");
const fixedSigner = () =>
  NodeEd25519Signer.fromPkcs8(
    { keyId: "workspace-task-evidence", purposes: ["approval"] },
    Buffer.concat([PKCS8_ED25519_HEADER, Buffer.alloc(32, 7)])
  );

// why: the review surface as `task plan` shapes it (task-plan.ts
// `approvalIntent`), so the golden is a planned request, not an arbitrary one.
function plannedIntent() {
  const workspaceId = intent().workspaceId;
  return intent({
    review: review({
      scope: ["path:src", "path:cli.js"],
      protectedPaths: ["path:.git", "path:.verchestra"],
      tasks: ["task-1"],
      dataAccess: ["repository:read-at-revision"],
      capabilities: ["worktree-write"],
      selectedPassports: ["claude-code:claude-opus", "codex:gpt-5-codex"],
      destinations: ["provider:anthropic", "provider:openai"],
      budgets: ["cost-usd:5", "tokens:200000", "duration-ms:600000"],
      claims: [`workspace-writer-lease:${workspaceId}`],
      gates: ["unit"],
      risks: ["risk:low"],
      assumptions: ["single-writer", "no-merge"],
      completionCriteria: ["REQ-1"],
      evidenceRefs: [`package:sha256:${"8".repeat(64)}`, `context:sha256:${"9".repeat(64)}`]
    })
  });
}

function ports() {
  const clock = new FixedClock(IsoInstant.parse(now));
  const signer = fixedSigner();
  const sealer = new ArtifactSealer({ signer, now: () => new Date(clock.now().value) });
  const trust = createTrustRoot({ trustRootId: "workspace-task-evidence", version: 1, keys: [signer.publicKeyRef] });
  const binding = (payload) => ({
    schema: { name: "approval-grant", version: 1 },
    purpose: "approval",
    bindingId: payload.approvalId,
    sourceStateDigest: payload.binding.sourceStateDigest.slice(7)
  });
  let sequence = 0;
  return {
    store: new MemoryAuthorityStore(),
    digest: contentDigest,
    clock,
    uuid: () => `018f0b6d-7b1a-7abc-8def-${String(++sequence).padStart(12, "0")}`,
    artifacts: {
      seal: async (payload) => sealer.seal(payload, binding(payload)),
      verify: async (artifact) =>
        sealer.verify(artifact, trust, { ...binding(artifact.payload), now: new Date(clock.now().value) })
    }
  };
}

test("a planned approval request is the recorded golden", () => {
  const request = new ApprovalRequester(ports()).request(plannedIntent());
  assert.equal(request.approvalId, "approval_018f0b6d-7b1a-7abc-8def-000000000001");
  assert.equal(request.requestedAt, now);
  assert.equal(request.bindingDigest, "sha256:24fa6956afd76eacc7e04f6fa1ffc584460e8c1033cd33775b53eb6a7dee500c");
  assert.equal(digestOf(request), "sha256:ab48e1583f3a94b5d12322bf5e281d7ae4b5537273dbc64a67b1b8540d9cbf6a");
});

test("the sealed approval of a planned request is the recorded golden", async () => {
  const fixture = ports();
  const record = await new ApprovalRecorder(fixture).record(
    new ApprovalRequester(fixture).request(plannedIntent()),
    approver
  );
  assert.equal(record.artifact.artifactId, "6d9adccd94da1e391ebfa57b3572108ac8d4cc313cc3246fd059ca89cc2a3c70");
  assert.equal(
    record.artifact.dsse.signatures[0].sig,
    "_D1PD48SYZCu_ll3mHo1VJg8hqLjkAnDrPpPt_rdHguAJoKESqKdaMtljevKhjNwS-Tg7pr9w6rDuBmLrMv9DQ"
  );
  assert.equal(digestOf(record), "sha256:0111d6f19e739b7f9969baeafc850818efc45aac4c02a365f95240a462df1661");
  assert.deepEqual(await new ApprovalVerifier(fixture).verify(record.approvalId, record.binding), {
    valid: true,
    approvalId: "approval_018f0b6d-7b1a-7abc-8def-000000000001",
    bindingDigest: "sha256:24fa6956afd76eacc7e04f6fa1ffc584460e8c1033cd33775b53eb6a7dee500c"
  });
});
