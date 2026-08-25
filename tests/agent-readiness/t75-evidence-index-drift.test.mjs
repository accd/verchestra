import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { buildEvidenceIndex } from "../../scripts/t75-evidence-index.mjs";

const FEATURE = new URL("../../.specs/features/platform-qualification-matrix/", import.meta.url);
const REVISION = "95b2b80a2c24fa3b956949dafee0383b4d3b9808";

const read = (name) => JSON.parse(readFileSync(new URL(name, FEATURE), "utf8"));

// The evidence index is only evidence if someone who did not run it can arrive
// at the same numbers. The five fleet indexes below are the artifacts the
// platform matrix uploaded at 97fa851; regenerating from them here is what keeps
// the recorded verdict from becoming a figure quoted out of a terminal.
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
  assert.equal(fleet.length, 5, "every declared gate profile is bound");
  for (const index of fleet) assert.equal(index.revision, REVISION);
  assert.deepEqual(fleet.map((index) => index.gate).sort(), [
    "gate:build",
    "gate:full",
    "gate:quick",
    "gate:release",
    "gate:security"
  ]);
});

test("the committed index is exactly what the committed fleet regenerates", () => {
  // This is the assertion that was missing. The drift test below compared only
  // summary counts, so a committed index generated from a DIFFERENT fleet run
  // passed unnoticed for as long as both runs happened to be green: the index
  // cited run ids 3276940xxxx at b738b047 while fleet/ held 3257939xxxx at
  // 97fa851, and nobody could regenerate the recorded verdict from the
  // recorded inputs. Comparing the whole object is what makes the index
  // independently reproducible rather than merely plausible.
  const committed = read("evidence-index.json");
  assert.deepEqual(committed, buildEvidenceIndex(read("matrix.json"), fleet, REVISION));
  assert.equal(committed.revision, REVISION);
  for (const profile of committed.profiles) assert.equal(profile.revision ?? REVISION, REVISION);
});

test("the recorded T75 verdict regenerates from the committed evidence", () => {
  const index = buildEvidenceIndex(read("matrix.json"), fleet, REVISION);
  assert.deepEqual(index.summary, {
    cases: 52,
    qualified: 42,
    contractQualified: 8,
    notQualified: 2,
    environmental: 0,
    contradictions: 0
  });
  const contradictions = index.dimensions.flatMap((entry) => entry.cases).filter((item) => item.contradiction);
  assert.equal(contradictions.length, 0);
  for (const profile of index.profiles) assert.deepEqual(profile.excused, []);
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
