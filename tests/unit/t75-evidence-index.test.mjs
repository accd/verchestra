import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { canonicalizeJsonV2 } from "../../packages/domain/src/index.ts";
import { buildEvidenceIndex } from "../../scripts/t75-evidence-index.mjs";

const SCRIPT = new URL("../../scripts/t75-evidence-index.mjs", import.meta.url);
const matrix = JSON.parse(
  readFileSync(new URL("../../.specs/features/platform-qualification-matrix/matrix.json", import.meta.url), "utf8")
);

const REVISION = "a".repeat(40);
const FLEET_LEGS = ["win32-x64", "linux-x64", "linux-arm64", "darwin-arm64"];
const GATES = matrix.dimensions.find((entry) => entry.dimension === "gate-profile").cases.map((item) => item.case);

const digestOf = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

const identityOf = (name, revision) => {
  const [platform, arch] = name.split("-");
  return { revision, platform, arch, runtime: "v24.14.0" };
};

// A missing leg never ran, so it carries no identity and no digests — the shape
// the workflow actually emits for a job that stayed queued.
const leg = (name, status = "qualified", revision = REVISION) => {
  if (status === "missing") return { leg: name, status };
  const identity = identityOf(name, revision);
  return { leg: name, status, identity, identityDigest: digestOf(identity), legDigest: `sha256:${"d".repeat(64)}` };
};

const fleetIndex = (gate, overrides = {}) => {
  const legs = overrides.legs ?? FLEET_LEGS.map((name) => leg(name));
  return {
    schemaVersion: 1,
    runId: `run-${gate}`,
    gate: `gate:${gate}`,
    revision: REVISION,
    complete: legs.length > 0 && legs.every((entry) => entry.status === "qualified"),
    legs,
    ...overrides
  };
};

// The matrix declares five gate profiles because no single profile runs every
// stage. A green baseline therefore needs all five dispatched, not one.
const greenFleet = () => GATES.map((gate) => fleetIndex(gate));

const caseOf = (index, dimension, name) =>
  index.dimensions.find((entry) => entry.dimension === dimension).cases.find((item) => item.case === name);

const allCases = (index) => index.dimensions.flatMap((entry) => entry.cases);

// T75's completion checklist requires publishing the complete matrix AND a
// signed evidence index. The index reconciles the declared matrix (a reviewed
// claim) against the observed fleet evidence. Concatenating them is not the
// artifact: it would carry the authority of evidence while contradicting it.

test("the index binds the candidate revision", () => {
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  assert.equal(index.revision, REVISION);
  assert.equal(index.task, "T75");
  assert.equal(index.summary.contradictions, 0, "a complete green fleet contradicts nothing");
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
      buildEvidenceIndex(
        matrix,
        [...greenFleet(), fleetIndex("full", { runId: "x", revision: "b".repeat(40) })],
        REVISION
      ),
    /fleet index x binds/u
  );
});

test("a leg that ran a different candidate is refused", () => {
  // The index-level revision can agree while an individual leg names another
  // commit; the leg's own claim is what proves what it exercised.
  assert.throws(
    () =>
      buildEvidenceIndex(
        matrix,
        [fleetIndex("security", { legs: [leg("win32-x64", "qualified", "c".repeat(40))] })],
        REVISION
      ),
    /leg win32-x64 ran c{40}, not the candidate/u
  );
});

test("a leg whose identity digest does not cover its identity is refused", () => {
  const tampered = leg("win32-x64");
  tampered.identity = { ...tampered.identity, runtime: "v0.0.0" };
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security", { legs: [tampered] })], REVISION),
    /identity digest that does not cover its identity/u
  );
});

test("a fleet index that disagrees with its own legs is refused", () => {
  assert.throws(
    () =>
      buildEvidenceIndex(
        matrix,
        [fleetIndex("security", { legs: [leg("win32-x64", "failed")], complete: true })],
        REVISION
      ),
    /claims complete=true but its legs say false/u
  );
});

test("a run of a profile the matrix does not declare is refused", () => {
  assert.throws(
    () => buildEvidenceIndex(matrix, [fleetIndex("security", { gate: "gate:not-a-profile" })], REVISION),
    /ran gate:not-a-profile, which the matrix does not declare/u
  );
});

test("a malformed revision is refused rather than recorded", () => {
  assert.throws(() => buildEvidenceIndex(matrix, greenFleet(), "not-a-sha"), /40-character commit sha/u);
});

test("a red fleet cannot be published under a green declaration", () => {
  // The severest failure this artifact can have: the declaration says qualified,
  // every leg failed, and the index reports a green fleet anyway.
  const red = GATES.map((gate) =>
    fleetIndex(gate, {
      legs: [
        leg("win32-x64", "failed"),
        leg("linux-x64", "failed"),
        leg("linux-arm64", "digest-mismatch"),
        leg("darwin-arm64", "missing")
      ]
    })
  );
  const index = buildEvidenceIndex(matrix, red, REVISION);
  for (const name of FLEET_LEGS) {
    const entry = caseOf(index, "platform", name);
    assert.equal(entry.status, "not-qualified", `${name} must not be recorded as qualified`);
    assert.equal(entry.declaredStatus, "qualified", "the declaration it contradicts stays visible");
    assert.match(entry.contradiction, /declared qualified, but observed/u);
  }
  for (const gate of GATES) assert.equal(caseOf(index, "gate-profile", gate).status, "not-qualified");
  assert.equal(index.summary.contradictions, FLEET_LEGS.length + GATES.length);
  const declaredQualified = allCases(matrix.dimensions ? { dimensions: matrix.dimensions } : index).length;
  assert.ok(declaredQualified > 0);
  assert.equal(
    index.summary.qualified,
    matrix.dimensions.flatMap((entry) => entry.cases).filter((item) => item.status === "qualified").length -
      FLEET_LEGS.length -
      GATES.length
  );
});

test("a single failed leg is enough to withhold qualification", () => {
  const broken = fleetIndex("security", {
    legs: [leg("win32-x64", "failed"), ...FLEET_LEGS.slice(1).map((name) => leg(name))]
  });
  const index = buildEvidenceIndex(
    matrix,
    [...GATES.filter((g) => g !== "security").map((g) => fleetIndex(g)), broken],
    REVISION
  );
  const entry = caseOf(index, "platform", "win32-x64");
  assert.equal(entry.status, "not-qualified", "passing under one profile does not overrule failing under another");
  assert.match(entry.contradiction, /failed in gate:security \(run run-security\)/u);
  assert.equal(caseOf(index, "platform", "linux-x64").status, "qualified");
});

test("a gate profile that was never dispatched is not qualified", () => {
  // Every profile is declared qualified because no single profile runs every
  // stage. An index built from one dispatch must not inherit the declaration's
  // word for the other four.
  const index = buildEvidenceIndex(matrix, [fleetIndex("security")], REVISION);
  assert.equal(caseOf(index, "gate-profile", "security").status, "qualified");
  for (const gate of GATES.filter((entry) => entry !== "security")) {
    const entry = caseOf(index, "gate-profile", gate);
    assert.equal(entry.status, "not-qualified", `${gate} was not dispatched`);
    assert.match(entry.contradiction, /no supplied fleet evidence covers this case/u);
  }
});

test("a gate profile that half-ran has not exercised its stages", () => {
  // A dispatch that lost a leg the declaration expects proves the profile ran
  // somewhere, not everywhere.
  const partial = fleetIndex("full", { legs: FLEET_LEGS.slice(1).map((name) => leg(name)) });
  const index = buildEvidenceIndex(
    matrix,
    [...GATES.filter((g) => g !== "full").map((g) => fleetIndex(g)), partial],
    REVISION
  );
  const entry = caseOf(index, "gate-profile", "full");
  assert.equal(entry.status, "not-qualified");
  assert.match(entry.contradiction, /incomplete \(win32-x64\) in gate:full/u);
});

test("a leg declared qualified that no supplied profile covers is not qualified", () => {
  // Silence is not a pass.
  const index = buildEvidenceIndex(
    matrix,
    GATES.map((gate) => fleetIndex(gate, { legs: [leg("win32-x64")] })),
    REVISION
  );
  const entry = caseOf(index, "platform", "linux-arm64");
  assert.equal(entry.status, "not-qualified");
  assert.match(entry.contradiction, /no supplied fleet evidence covers this case/u);
});

test("an observation never silently upgrades a declaration", () => {
  // darwin-x64 is declared environmental. A green leg for it means the
  // declaration is stale, and that is reported — not resolved by the generator.
  const index = buildEvidenceIndex(
    matrix,
    GATES.map((gate) => fleetIndex(gate, { legs: [...FLEET_LEGS.map((name) => leg(name)), leg("darwin-x64")] })),
    REVISION
  );
  const entry = caseOf(index, "platform", "darwin-x64");
  assert.equal(entry.status, "environmental");
  assert.match(entry.contradiction, /the declaration is stale/u);
  // A disagreement the summary does not count is a disagreement the CLI will not
  // act on, so the count covers this direction too.
  assert.equal(index.summary.contradictions, 1);
});

test("only the fleet-answerable dimensions are reconciled", () => {
  // No fleet run can confirm or refute a database engine, so those statuses pass
  // through from the declaration untouched. Reconciliation keys on the
  // dimension, not on a case's prose evidence note.
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  const engine = caseOf(index, "database", "postgresql");
  assert.equal(engine.status, "contract-qualified");
  assert.deepEqual(engine.observed, []);
  assert.equal(engine.contradiction, undefined);
});

test("every declared case reaches the index, not only the qualified ones", () => {
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  const declared = matrix.dimensions.flatMap((entry) => entry.cases.map((item) => `${entry.dimension}/${item.case}`));
  const recorded = index.dimensions.flatMap((entry) => entry.cases.map((item) => `${entry.dimension}/${item.case}`));
  assert.deepEqual(recorded.sort(), declared.sort());
  assert.ok(index.summary.contractQualified > 0, "the contract-only engines must be visible in the summary");
  assert.ok(index.summary.environmental > 0, "the Intel leg must be visible as environmental, not absent");
  for (const item of allCases(index)) {
    assert.equal(typeof item.evidence, "string", `${item.case} must carry its evidence note`);
    // Present on agreeing rows too: a reader compares the pair without having to
    // know which rows the generator chose to annotate.
    assert.equal(typeof item.declaredStatus, "string", `${item.case} must carry its declared status`);
  }
});

test("an observation names the run it came from", () => {
  // An index that records a status without its provenance cannot be re-checked
  // against the run that produced it.
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  assert.deepEqual(caseOf(index, "platform", "win32-x64").observed, [
    ...GATES.map((gate) => ({ gate: `gate:${gate}`, runId: `run-${gate}`, status: "qualified" }))
  ]);
  assert.deepEqual(caseOf(index, "gate-profile", "release").observed, [
    { gate: "gate:release", runId: "run-release", status: "qualified" }
  ]);
});

test("the summary is counted from the reconciled rows, so it cannot drift", () => {
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  const rows = allCases(index);
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
  // Every dimension, not only the reconciled one: an unknown status anywhere is
  // counted by no tally and would silently shrink the summary.
  for (const dimension of ["platform", "database", "gate-profile"]) {
    const stale = structuredClone(matrix);
    stale.dimensions.find((entry) => entry.dimension === dimension).cases[0].status = "probably-fine";
    assert.throws(() => buildEvidenceIndex(stale, greenFleet(), REVISION), /unknown status probably-fine/u);
  }
});

test("each dispatched profile is recorded with its run and its per-leg identity", () => {
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  assert.deepEqual(
    index.profiles.map((profile) => profile.gate),
    GATES.map((gate) => `gate:${gate}`)
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
    identityDigest: digestOf(identityOf("win32-x64", REVISION)),
    legDigest: `sha256:${"d".repeat(64)}`
  });
});

test("an environmentally absent leg does not mark every profile unexercised", () => {
  // darwin-x64 never dequeues, which is why the matrix declares it
  // environmental. If that absence made every profile incomplete, one retiring
  // runner queue would report the entire gate-profile dimension unqualified.
  const index = buildEvidenceIndex(
    matrix,
    GATES.map((gate) =>
      fleetIndex(gate, { legs: [...FLEET_LEGS.map((name) => leg(name)), leg("darwin-x64", "missing")] })
    ),
    REVISION
  );
  for (const gate of GATES) assert.equal(caseOf(index, "gate-profile", gate).status, "qualified");
  assert.equal(caseOf(index, "platform", "darwin-x64").status, "environmental");
  assert.equal(index.summary.contradictions, 0);
  // The workflow's own completeness field still says what it says: not every leg
  // it listed came back green.
  assert.equal(index.profiles[0].complete, false);
});

test("an incomplete fleet is recorded as incomplete", () => {
  const index = buildEvidenceIndex(
    matrix,
    [fleetIndex("security", { legs: [...FLEET_LEGS.map((name) => leg(name)), leg("darwin-x64", "missing")] })],
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
    [...greenFleet(), fleetIndex("security", { runId: "run-security-2" })],
    REVISION
  );
  assert.equal(index.profiles.length, GATES.length + 1);
  assert.equal(caseOf(index, "platform", "win32-x64").observed.length, GATES.length + 1);
  assert.equal(caseOf(index, "gate-profile", "security").observed.length, 2);
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
  const index = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  assert.equal(index.signingState.signed, false);
  assert.match(index.signingState.reason, /signing identity|key-custody/u);
  assert.match(index.signingState.reason, /AD-014/u, "the signature must be scheduled, not merely deferred");
});

test("a downstream verifier can recompute the digest from the published bytes", () => {
  // The artifact is only checkable if its digest is reproducible by someone who
  // did not build it. That reader has the declared canonicalizationVersion and
  // the body — nothing else — so this recomputes it exactly as they would.
  const published = buildEvidenceIndex(matrix, greenFleet(), REVISION);
  const body = Object.fromEntries(
    Object.entries(published).filter(([field]) => field !== "bodyDigest" && field !== "signingState")
  );
  assert.equal(body.canonicalizationVersion, 2);
  assert.equal(published.bodyDigest, `sha256:${createHash("sha256").update(canonicalizeJsonV2(body)).digest("hex")}`);
  const other = buildEvidenceIndex(matrix, [...greenFleet(), fleetIndex("security", { runId: "run-other" })], REVISION);
  assert.notEqual(published.bodyDigest, other.bodyDigest, "which runs were cited must reach the digest");
});

test("a declared case with no evidence note is refused by name", () => {
  const silent = structuredClone(matrix);
  delete silent.dimensions.find((entry) => entry.dimension === "database").cases[0].evidence;
  assert.throws(() => buildEvidenceIndex(silent, greenFleet(), REVISION), /declares no evidence note/u);
});

// The CLI is the only thing a qualification step actually runs, so its exit code
// is the enforcement surface: an index that records a contradiction inside a
// file nobody checks enforces nothing.

const runCli = (fleet) => {
  const dir = mkdtempSync(join(tmpdir(), "t75-index-"));
  const files = fleet.map((index, position) => {
    const file = join(dir, `fleet-${position}.json`);
    writeFileSync(file, JSON.stringify(index));
    return file;
  });
  const out = join(dir, "evidence-index.json");
  // Invoked through the `--` separator that `pnpm run` forwards, so the test
  // exercises the documented house-style invocation rather than a tidier one.
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(SCRIPT), "--", "--revision", REVISION, "--out", out, ...files],
    { encoding: "utf8" }
  );
  return { ...result, index: existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null };
};

test("the CLI succeeds when the declaration and the fleet agree", () => {
  const result = runCli(greenFleet());
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.index.summary.contradictions, 0);
  assert.equal(result.index.revision, REVISION);
});

test("the CLI fails when the fleet contradicts the declaration", () => {
  // It still writes the index — the contradiction is the finding, and suppressing
  // the artifact would hide it — but it refuses to exit clean on one.
  const result = runCli([fleetIndex("security")]);
  assert.equal(result.status, 1, "a contradicting generation must not report success");
  assert.ok(result.index.summary.contradictions > 0);
});
