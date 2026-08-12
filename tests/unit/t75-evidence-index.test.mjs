import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { buildEvidenceIndex } from "../../scripts/t75-evidence-index.mjs";

const matrix = JSON.parse(
  readFileSync(new URL("../../.specs/features/platform-qualification-matrix/matrix.json", import.meta.url), "utf8")
);

const REVISION = "a".repeat(40);
const FLEET_LEGS = ["win32-x64", "linux-x64", "linux-arm64", "darwin-arm64"];

const identity = (leg) => {
  const [platform, arch] = leg.split("-");
  return { revision: REVISION, platform, arch, runtime: "v24.14.0" };
};

const leg = (name, status = "qualified") =>
  status === "missing"
    ? { leg: name, status }
    : {
        leg: name,
        status,
        identity: identity(name),
        identityDigest: `sha256:${"c".repeat(64)}`,
        legDigest: `sha256:${"d".repeat(64)}`
      };

// The declared matrix says darwin-x64 never dequeues, so a realistic fleet
// carries the four legs that do run.
const fleetIndex = (gate, overrides = {}) => ({
  schemaVersion: 1,
  runId: `run-${gate}`,
  gate: `gate:${gate}`,
  revision: REVISION,
  complete: true,
  legs: FLEET_LEGS.map((name) => leg(name)),
  ...overrides
});

const caseOf = (index, dimension, name) =>
  index.dimensions.find((entry) => entry.dimension === dimension).cases.find((item) => item.case === name);

// T75's completion checklist requires publishing the complete matrix AND a
// signed evidence index. The index reconciles the declared matrix (a reviewed
// claim) with the observed fleet evidence (which answers only the platform
// dimension). Concatenating them is not the artifact.

test("the index binds the candidate revision", () => {
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  assert.equal(index.revision, REVISION);
  assert.equal(index.task, "T75");
});

test("a fleet index bound to a different candidate is refused", () => {
  // Evidence collected at different revisions is not evidence about one release.
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security", { revision: "b".repeat(40) })], REVISION),
    /binds .*, not the candidate/u
  );
});

test("a fleet index whose own legs disagreed about the candidate is refused", () => {
  // The workflow writes revision:null exactly when its legs report more than one
  // revision, and uploads that file before throwing. Accepting it would stamp
  // the candidate onto evidence its producer rejected.
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security", { revision: null })], REVISION),
    /binds no single revision/u
  );
});

test("every supplied fleet index is checked, not only the first", () => {
  assert.throws(
    () =>
      buildEvidenceIndex(matrix, [fleetIndex("full"), fleetIndex("security", { revision: "b".repeat(40) })], REVISION),
    /run-security binds/u
  );
});

test("a malformed revision is refused rather than recorded", () => {
  assert.throws(() => buildEvidenceIndex(matrix, [fleetIndex("security")], "not-a-sha"), /40-character commit sha/u);
});

test("a red fleet cannot be published under a green declaration", () => {
  // The severest failure this artifact can have: the declaration says qualified,
  // every leg failed, and the index reports a green fleet anyway.
  const red = fleetIndex("security", {
    complete: false,
    legs: [
      leg("win32-x64", "failed"),
      leg("linux-x64", "failed"),
      leg("linux-arm64", "digest-mismatch"),
      leg("darwin-arm64", "missing")
    ]
  });
  const index = buildEvidenceIndex(matrix, [red], REVISION);
  for (const name of FLEET_LEGS) {
    const entry = caseOf(index, "platform", name);
    assert.equal(entry.status, "not-qualified", `${name} must not be recorded as qualified`);
    assert.equal(entry.declaredStatus, "qualified", "the declaration it contradicts stays visible");
    assert.match(entry.contradiction, /declared qualified, but observed/u);
  }
  assert.equal(index.summary.contradictions, 4);
  const declaredQualified = matrix.dimensions
    .flatMap((entry) => entry.cases)
    .filter((item) => item.status === "qualified");
  assert.equal(
    index.summary.qualified,
    declaredQualified.length - FLEET_LEGS.length,
    "the four red legs leave the qualified count"
  );
});

test("a single failed leg is enough to withhold qualification", () => {
  const index = buildEvidenceIndex(
    matrix,
    [
      fleetIndex("full"),
      fleetIndex("security", { legs: [leg("win32-x64", "failed"), ...FLEET_LEGS.slice(1).map((n) => leg(n))] })
    ],
    REVISION
  );
  const entry = caseOf(index, "platform", "win32-x64");
  assert.equal(entry.status, "not-qualified", "passing under one profile does not overrule failing under another");
  assert.match(entry.contradiction, /failed in gate:security \(run run-security\)/u);
  assert.equal(caseOf(index, "platform", "linux-x64").status, "qualified");
});

test("a leg declared qualified that no supplied profile covers is not qualified", () => {
  // Silence is not a pass. An index built from a fleet that never ran a leg must
  // not inherit the declaration's word for it.
  const index = buildEvidenceIndex(matrix, [fleetIndex("security", { legs: [leg("win32-x64")] })], REVISION);
  const entry = caseOf(index, "platform", "linux-arm64");
  assert.equal(entry.status, "not-qualified");
  assert.match(entry.contradiction, /no supplied fleet profile covers this leg/u);
});

test("an observation never silently upgrades a declaration", () => {
  // darwin-x64 is declared environmental. A green leg for it means the
  // declaration is stale, and that is reported — not resolved by the generator.
  const index = buildEvidenceIndex(
    matrix,
    [fleetIndex("security", { legs: [...FLEET_LEGS.map((n) => leg(n)), leg("darwin-x64")] })],
    REVISION
  );
  const entry = caseOf(index, "platform", "darwin-x64");
  assert.equal(entry.status, "environmental");
  assert.match(entry.contradiction, /the declaration is stale/u);
});

test("only the fleet-answerable dimension is reconciled", () => {
  // No platform leg can confirm or refute a database engine, so those statuses
  // pass through from the declaration untouched. Reconciliation keys on the
  // dimension, not on a case's prose evidence note.
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  const engine = caseOf(index, "database", "postgresql");
  assert.equal(engine.status, "contract-qualified");
  assert.deepEqual(engine.observed, []);
  assert.equal(engine.contradiction, undefined);
});

test("every declared case reaches the index, not only the qualified ones", () => {
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  const declared = matrix.dimensions.flatMap((entry) => entry.cases.map((item) => `${entry.dimension}/${item.case}`));
  const recorded = index.dimensions.flatMap((entry) => entry.cases.map((item) => `${entry.dimension}/${item.case}`));
  assert.deepEqual(recorded.sort(), declared.sort());
  assert.ok(index.summary.contractQualified > 0, "the contract-only engines must be visible in the summary");
  assert.ok(index.summary.environmental > 0, "the Intel leg must be visible as environmental, not absent");
  for (const item of index.dimensions.flatMap((entry) => entry.cases))
    assert.equal(typeof item.evidence, "string", `${item.case} must carry its evidence note`);
});

test("the summary is counted from the reconciled rows, so it cannot drift", () => {
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  const rows = index.dimensions.flatMap((entry) => entry.cases);
  assert.equal(index.summary.cases, rows.length);
  assert.equal(index.summary.qualified, rows.filter((item) => item.status === "qualified").length);
  assert.equal(
    index.summary.cases,
    index.summary.qualified + index.summary.contractQualified + index.summary.notQualified + index.summary.environmental
  );
});

test("an unrecognised status is refused rather than counted as nothing", () => {
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security", { legs: [leg("win32-x64", "flaky")] })], REVISION),
    /unknown status flaky/u
  );
  const stale = structuredClone(matrix);
  stale.dimensions[0].cases[0].status = "probably-fine";
  assert.throws(() => buildEvidenceIndex(stale, [fleetIndex("security")], REVISION), /unknown status probably-fine/u);
});

test("each dispatched profile is recorded with its run and its per-leg identity", () => {
  const index = buildEvidenceIndex(
    matrix,
    ["quick", "full", "security", "release"].map((gate) => fleetIndex(gate)),
    REVISION
  );
  assert.deepEqual(
    index.profiles.map((profile) => profile.gate),
    ["gate:quick", "gate:full", "gate:security", "gate:release"]
  );
  const [first] = index.profiles;
  assert.equal(first.complete, true);
  // Criterion 3 binds platform, arch, runtime, candidate revision and the
  // digests. A leg recorded without them cannot be re-checked against its run.
  assert.deepEqual(first.legs[0], {
    leg: "win32-x64",
    status: "qualified",
    platform: "win32",
    arch: "x64",
    runtime: "v24.14.0",
    revision: REVISION,
    identityDigest: `sha256:${"c".repeat(64)}`,
    legDigest: `sha256:${"d".repeat(64)}`
  });
});

test("an incomplete fleet is recorded as incomplete", () => {
  const index = buildEvidenceIndex(
    matrix,
    [
      fleetIndex("security", {
        complete: false,
        legs: [...FLEET_LEGS.map((n) => leg(n)), leg("darwin-x64", "missing")]
      })
    ],
    REVISION
  );
  assert.equal(index.profiles[0].complete, false);
  assert.deepEqual(index.profiles[0].legs.at(-1), {
    leg: "darwin-x64",
    status: "missing",
    platform: null,
    arch: null,
    runtime: null,
    revision: null,
    identityDigest: null,
    legDigest: null
  });
});

test("a re-dispatch of the same profile is kept as separate evidence", () => {
  // Collapsing by gate would erase the run that a re-dispatch exists to compare
  // against.
  const index = buildEvidenceIndex(
    matrix,
    [fleetIndex("security"), fleetIndex("security", { runId: "run-security-2" })],
    REVISION
  );
  assert.equal(index.profiles.length, 2);
  assert.deepEqual(
    index.profiles.map((profile) => profile.runId),
    ["run-security", "run-security-2"]
  );
  assert.equal(caseOf(index, "platform", "win32-x64").observed.length, 2);
});

test("the same run supplied twice is refused", () => {
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security"), fleetIndex("security")], REVISION),
    /appears twice/u
  );
});

test("the index states plainly that it is unsigned, and why", () => {
  // "not configured", never a pass — the rule the product applies to a missing
  // provider, applied to its own evidence. Signing with the repository's
  // TEST-ONLY fixture key would look like signed evidence and carry no trust.
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  assert.equal(index.signingState.signed, false);
  assert.match(index.signingState.reason, /signing identity|key-custody/u);
  assert.match(index.signingState.reason, /AD-014/u, "the signature must be scheduled, not merely deferred");
});

test("the body digest is canonical and covers the recorded evidence", () => {
  const base = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  assert.equal(base.canonicalizationVersion, 2);
  assert.match(base.bodyDigest, /^sha256:[a-f0-9]{64}$/u);
  const cited = buildEvidenceIndex(matrix, [fleetIndex("security", { runId: "run-other" })], REVISION);
  assert.notEqual(base.bodyDigest, cited.bodyDigest, "which runs were cited must reach the digest");
  const digested = buildEvidenceIndex(
    matrix,
    [
      fleetIndex("security", {
        legs: [leg("win32-x64"), ...FLEET_LEGS.slice(1).map((n) => leg(n))].map((entry) => ({
          ...entry,
          legDigest: `sha256:${"e".repeat(64)}`
        }))
      })
    ],
    REVISION
  );
  assert.notEqual(base.bodyDigest, digested.bodyDigest, "the evidence digests must reach the body digest");
});

test("a downstream verifier can recompute the digest from the published bytes", () => {
  // The artifact is only checkable if its digest is reproducible by someone who
  // did not build it. That reader has the declared canonicalizationVersion and
  // the body — nothing else — so this recomputes the digest exactly as they
  // would, rather than trusting the value the generator wrote next to it.
  const published = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  // A verifier strips the two fields that are about the digest rather than
  // covered by it, then recomputes over what is left.
  const body = Object.fromEntries(
    Object.entries(published).filter(([field]) => field !== "bodyDigest" && field !== "signingState")
  );
  assert.equal(body.canonicalizationVersion, 2);
  assert.equal(published.bodyDigest, `sha256:${createHash("sha256").update(canonicalizeJsonV2(body)).digest("hex")}`);
});

test("a declared case with no evidence note is refused by name", () => {
  const silent = structuredClone(matrix);
  delete silent.dimensions.find((entry) => entry.dimension === "database").cases[0].evidence;
  assert.throws(() => buildEvidenceIndex(silent, [fleetIndex("security")], REVISION), /declares no evidence note/u);
});
