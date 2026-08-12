import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { buildEvidenceIndex } from "../../scripts/t75-evidence-index.mjs";

const FEATURE = new URL("../../.specs/features/platform-qualification-matrix/", import.meta.url);
const REVISION = "9aab070897947620fc2afd70160671eef95dcf2b";

const read = (name) => JSON.parse(readFileSync(new URL(name, FEATURE), "utf8"));

// The evidence index is only evidence if someone who did not run it can arrive
// at the same numbers. The four fleet indexes below are the artifacts the
// platform matrix uploaded at 9aab070; regenerating from them here is what keeps
// the recorded verdict from becoming a figure quoted out of a terminal. This is
// interim evidence: 9aab070 is not the qualification revision, and B3 replaces
// these files and this expectation with the run that is.
//
// What this is NOT: a proof of the generator. It is a golden test over one input
// -- a regression anchor that catches a behavioural change reaching the recorded
// verdict, and nothing more. The generator's discrimination lives in
// tests/unit/t75-evidence-index.test.mjs, and the T75 report should say so
// rather than cite this file as evidence the reconciliation is correct.

const fleet = readdirSync(new URL("fleet/", FEATURE))
  .sort()
  .map((name) => read(`fleet/${name}`));

test("the committed fleet evidence binds one candidate", () => {
  assert.equal(fleet.length, 4, "four dispatches, because no single profile runs every stage");
  for (const index of fleet) assert.equal(index.revision, REVISION);
  assert.deepEqual(fleet.map((index) => index.gate).sort(), [
    "gate:build",
    "gate:full",
    "gate:release",
    "gate:security"
  ]);
});

test("the recorded T75 verdict regenerates from the committed evidence", () => {
  const index = buildEvidenceIndex(read("matrix.json"), fleet, REVISION);
  assert.deepEqual(index.summary, {
    cases: 52,
    qualified: 40,
    contractQualified: 8,
    notQualified: 3,
    environmental: 1,
    contradictions: 1
  });
  // The one contradiction is a real finding about T75, not a defect in the
  // generator: `quick` is declared qualified and no dispatch at this revision
  // covers it. T75 needs a gate=quick dispatch at the qualification revision.
  const contradictions = index.dimensions.flatMap((entry) => entry.cases).filter((item) => item.contradiction);
  assert.equal(contradictions.length, 1);
  assert.equal(contradictions[0].case, "quick");
  assert.match(contradictions[0].contradiction, /no supplied fleet evidence covers this case/u);
  // Every profile's coverage claim was reached with the Intel leg excluded, and
  // says so.
  for (const profile of index.profiles) assert.deepEqual(profile.excused, ["darwin-x64=missing"]);
});

// The generator re-derives a passing leg's `legDigest` by rebuilding the record
// the workflow sealed. That reconstruction is a copy of workflow logic living in
// another file, and the drift test above cannot notice it going stale: its inputs
// are frozen in today's shape, so it would keep passing while every newly
// produced fleet index was refused. These assertions are the tie.
//
// Same pattern the repository already uses for `gate-stages.mjs`: pin the
// canonical text, so changing it forces the copy to be changed with it.
//
// The tie is one-way and only complete by composition: these assertions pin the
// workflow side, and the drift test above pins the generator's copy against
// frozen bytes. Neither is redundant with the other -- delete either and a
// coherent change to the sealed record shape passes unnoticed on that side.

const workflow = readFileSync(new URL("../../.github/workflows/platform-matrix.yml", import.meta.url), "utf8");

test("the sealed leg record the generator rebuilds is the one the workflow seals", () => {
  assert.match(workflow, /const record = \{ schemaVersion: 2, identity, identityDigest \};/u);
  assert.match(
    workflow,
    /const outcome = \{ result: process\.env\.GATE_OUTCOME === "success" \? "pass" : "fail", reported: process\.env\.GATE_OUTCOME \};/u
  );
  assert.match(workflow, /const sealed = \{ \.\.\.record, outcome \};/u);
  assert.match(workflow, /createHash\("sha256"\)\.update\(JSON\.stringify\(sealed\)\)/u);
});

test("the statuses the generator reconciles are the ones the workflow emits", () => {
  // `digest-mismatch` carries identity and no digests, deliberately: the digests
  // are what failed. The generator has to accept that shape rather than refuse
  // to publish a record of the tampering.
  assert.match(workflow, /return \{ leg, status: "digest-mismatch", identity: record\.identity \};/u);
  assert.match(workflow, /status: record\.outcome\?\.result === "pass" \? "qualified" : "failed"/u);
  assert.match(workflow, /status: "missing"/u);
});
