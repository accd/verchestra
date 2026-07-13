import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscoveryRouter } from "../../packages/agent-runtime/src/discovery/discovery-router.ts";
import { digest, output } from "../helpers/discovery-fixture.mjs";

test("normalization creates a content-addressed review-pending packet", () => {
  const packet = new DiscoveryRouter().normalize(output());
  assert.equal(packet.packetDigest.startsWith("sha256:"), true);
  assert.equal(packet.humanReviewRequired, true);
  assert.equal(packet.promotionStatus, "pending-review");
  assert.equal(packet.evidence[0].trust, "untrusted");
});

for (const status of ["available", "missing", "stale", "contradictory", "outside-scope"]) {
  test(`finding preserves explicit ${status} state without assumption`, () => {
    const packet = new DiscoveryRouter().normalize(
      output({
        findings: [{ id: `finding_${status.replace("-", "_")}`, status, detail: status, sourceIds: ["evidence_repo"] }]
      })
    );
    assert.equal(packet.findings[0].status, status);
    assert.equal(packet.findings[0].assumption, false);
  });
}

for (const [name, mutation] of [
  ["absolute", { logicalPath: "/src/app.ts" }],
  ["parent", { logicalPath: "src/../secret" }],
  ["Windows", { logicalPath: "C:/src/app.ts" }],
  ["backslash", { logicalPath: "src\\app.ts" }],
  ["line zero", { startLine: 0 }],
  ["reversed lines", { startLine: 10, endLine: 2 }],
  ["digest", { contentDigest: "raw" }]
]) {
  test(`packet rejects invalid anchor ${name}`, () => {
    assert.throws(
      () => new DiscoveryRouter().normalize(output({ anchors: [{ ...output().anchors[0], ...mutation }] })),
      (error) => error.code === "VES_DISCOVERY_ANCHOR_INVALID"
    );
  });
}

test("packet rejects evidence without complete revision provenance", () => {
  const item = output().evidence[0];
  assert.throws(
    () =>
      new DiscoveryRouter().normalize(output({ evidence: [{ ...item, source: { ...item.source, revision: "" } }] })),
    (error) => error.code === "VES_DISCOVERY_EVIDENCE_INVALID"
  );
});

test("packet rejects evidence pointing outside stable anchors", () => {
  assert.throws(
    () =>
      new DiscoveryRouter().normalize(
        output({ evidence: [{ ...output().evidence[0], anchorIds: ["anchor_missing"] }] })
      ),
    (error) => error.code === "VES_DISCOVERY_EVIDENCE_INVALID"
  );
});

test("packet enforces bounded content bytes", () => {
  const router = new DiscoveryRouter({ maximumEvidence: 5, maximumFindings: 5, maximumContentBytes: 4 });
  assert.throws(
    () => router.normalize(output()),
    (error) => error.code === "VES_DISCOVERY_OUTPUT_LIMIT"
  );
});

test("source content digest remains controller-provided provenance", () => {
  assert.equal(new DiscoveryRouter().normalize(output()).evidence[0].source.contentDigest, digest);
});
