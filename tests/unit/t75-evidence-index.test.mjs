import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildEvidenceIndex } from "../../scripts/t75-evidence-index.mjs";

const matrix = JSON.parse(
  readFileSync(new URL("../../.specs/features/platform-qualification-matrix/matrix.json", import.meta.url), "utf8")
);

const REVISION = "a".repeat(40);

const fleetIndex = (gate, overrides = {}) => ({
  schemaVersion: 1,
  runId: `run-${gate}`,
  gate: `gate:${gate}`,
  revision: REVISION,
  complete: false,
  legs: [
    { leg: "win32-x64", status: "qualified", legDigest: `sha256:${"1".repeat(64)}` },
    { leg: "darwin-x64", status: "missing" }
  ],
  ...overrides
});

// T75's completion checklist requires publishing the complete matrix AND a
// signed evidence index. The index is the join of the declared matrix (a claim,
// bound to its canonical sources) with the observed fleet evidence (which covers
// only the platform dimension). Neither alone is the record.

test("the index binds the candidate revision", () => {
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  assert.equal(index.revision, REVISION);
  assert.equal(index.task, "T75");
});

test("a fleet index bound to a different candidate is refused", () => {
  // Evidence collected at different revisions is not evidence about one
  // release, and silently merging it would be the worst kind of index.
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security", { revision: "b".repeat(40) })], REVISION),
    /binds .*, not the candidate/u
  );
});

test("a malformed revision is refused rather than recorded", () => {
  assert.throws(() => buildEvidenceIndex(matrix, [fleetIndex("security")], "not-a-sha"), /40-character commit sha/u);
});

test("every declared case reaches the index, not only the qualified ones", () => {
  // The whole point: an index listing only what passed reports a green fleet by
  // omission.
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  const declared = matrix.dimensions.flatMap((entry) => entry.cases.map((item) => `${entry.dimension}/${item.case}`));
  const recorded = index.dimensions.flatMap((entry) => entry.cases.map((item) => `${entry.dimension}/${item.case}`));
  assert.deepEqual(recorded.sort(), declared.sort());
  assert.ok(index.summary.contractQualified > 0, "the contract-only engines must be visible in the summary");
  assert.ok(index.summary.environmental > 0, "the Intel leg must be visible as environmental, not absent");
});

test("the summary is counted from the rows, so it cannot drift from them", () => {
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  const rows = index.dimensions.flatMap((entry) => entry.cases);
  assert.equal(index.summary.cases, rows.length);
  assert.equal(index.summary.qualified, rows.filter((item) => item.status === "qualified").length);
  assert.equal(
    index.summary.cases,
    index.summary.qualified + index.summary.contractQualified + index.summary.notQualified + index.summary.environmental
  );
});

test("each dispatched profile is recorded with its run and its per-leg outcome", () => {
  const index = buildEvidenceIndex(
    matrix,
    ["quick", "full", "security", "release"].map((gate) => fleetIndex(gate)),
    REVISION
  );
  assert.deepEqual(
    index.profiles.map((profile) => profile.gate),
    ["gate:quick", "gate:full", "gate:security", "gate:release"]
  );
  for (const profile of index.profiles) {
    assert.equal(profile.complete, false, "a fleet with a missing leg is not complete");
    assert.deepEqual(
      profile.legs.map((leg) => leg.status),
      ["qualified", "missing"]
    );
  }
});

test("the index states plainly that it is unsigned, and why", () => {
  // "not configured", never a pass — the rule the product applies to a missing
  // provider, applied to its own evidence. Signing with the repository's
  // TEST-ONLY fixture key would look like signed evidence and carry no trust.
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  assert.equal(index.signingState.signed, false);
  assert.match(index.signingState.reason, /signing identity|key-custody/u);
});

test("the body digest covers the recorded evidence", () => {
  const base = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  const other = buildEvidenceIndex(matrix, [fleetIndex("security", { runId: "run-other" })], REVISION);
  assert.match(base.bodyDigest, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(base.bodyDigest, other.bodyDigest, "which runs were cited must reach the digest");
});
