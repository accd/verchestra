import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DURABLE_CRASH_EXIT_CODE,
  DURABLE_CRASH_PHASES,
  FULL_DURABLE_BOUNDARY_IDS,
  assertDurableBoundaryFacts
} from "../../packages/application/src/index.ts";

// T75 recovery matrix: is the crash/recovery matrix complete for the declared
// failure points?
//
// Two failure-point catalogs govern recovery in this repository, and they are
// declared in opposite ways.
//
//   * The self-test durable boundaries are a FROZEN RUNTIME ARRAY
//     (FULL_DURABLE_BOUNDARY_IDS). Every consumer iterates it, and
//     assertDurableBoundaryFacts independently recomputes the expected
//     boundary x phase cross product and refuses an incomplete one. A twelfth
//     boundary therefore adds two cases automatically and cannot silently pass.
//     That matrix is complete, and the first half of this file proves the
//     mechanism that makes it complete is live rather than assuming it.
//
//   * The activation fault points are a TYPE-ONLY UNION
//     (`export type ActivationFaultPoint`, transactional-activation.ts:41).
//     A type has no runtime value to iterate, so
//     tests/fault-injection/transactional-activation-faults.test.mjs writes its
//     seven crash points out by hand. The two lists agree today, and nothing
//     makes them agree: an eighth fault point would compile, ship, and leave
//     that matrix silently at 7 of 8. That is the drift this file closes,
//     without touching the existing suite.

const ACTIVATION_SOURCE_PATH = "packages/distribution/src/transactional-activation.ts";
const ACTIVATION_SOURCE = readFileSync(new URL(`../../${ACTIVATION_SOURCE_PATH}`, import.meta.url), "utf8");
const ACTIVATION_FAULT_SUITE_PATH = "tests/fault-injection/transactional-activation-faults.test.mjs";
const ACTIVATION_FAULT_SUITE = readFileSync(
  new URL("./transactional-activation-faults.test.mjs", import.meta.url),
  "utf8"
);
const CRASH_MATRIX_SUITE = readFileSync(new URL("./self-test-full-crash-matrix.test.mjs", import.meta.url), "utf8");

// The activation fault points, read from the union that declares them.
const ACTIVATION_FAULT_POINTS = (() => {
  const body = /export type ActivationFaultPoint =([^;]+);/u.exec(ACTIVATION_SOURCE)?.[1];
  assert.ok(body, `the ActivationFaultPoint union must be readable from ${ACTIVATION_SOURCE_PATH}`);
  return [...body.matchAll(/"([a-z-]+)"/gu)].map((match) => match[1]);
})();

const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const FINGERPRINT = ["full.package:pass"];

// A complete, valid fact set for the declared matrix. Built here rather than
// captured from a run so the completeness guard can be probed directly.
function completeFacts() {
  return FULL_DURABLE_BOUNDARY_IDS.flatMap((boundaryId) =>
    DURABLE_CRASH_PHASES.map((phase) => ({
      boundaryId,
      phase,
      logicalId: `self-test:${boundaryId}`,
      logicalResultCount: 1,
      resultDigest: digest(`result:${boundaryId}`),
      resultStatus: "STORED",
      rootIdentity: digest(`root:${boundaryId}:${phase}`),
      resumed: true,
      crashExitCode: DURABLE_CRASH_EXIT_CODE,
      resumeExitCode: 0,
      semanticFingerprint: FINGERPRINT
    }))
  );
}

const HAPPY_ROOT = digest("happy-path-root");

test("the declared recovery matrix is the boundary x phase cross product", () => {
  assert.equal(FULL_DURABLE_BOUNDARY_IDS.length, 11);
  assert.deepEqual([...DURABLE_CRASH_PHASES], ["before", "after"]);
  assert.equal(completeFacts().length, 22, "11 durable boundaries x 2 crash phases");
  assertDurableBoundaryFacts(completeFacts(), HAPPY_ROOT);
});

test("a recovery matrix missing any single boundary and phase is refused", () => {
  // The mechanism that makes the durable matrix complete rather than merely
  // currently-complete. Every one of the 22 cells is probed: dropping any one
  // must be refused by name, so no cell can be quietly skipped by a runner that
  // reports a partial result as a pass.
  for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS) {
    for (const phase of DURABLE_CRASH_PHASES) {
      const partial = completeFacts().filter((fact) => !(fact.boundaryId === boundaryId && fact.phase === phase));
      assert.equal(partial.length, 21);
      assert.throws(
        () => assertDurableBoundaryFacts(partial, HAPPY_ROOT),
        (error) => {
          assert.equal(error.code, "VES_SELFTEST_DURABLE_BOUNDARY_INVALID");
          assert.match(error.message, new RegExp(`${boundaryId}:${phase}`, "u"));
          return true;
        },
        `dropping ${boundaryId}:${phase} was accepted as a complete recovery matrix`
      );
    }
  }
});

test("a boundary the catalog does not declare cannot enter the recovery matrix", () => {
  // The closed half. A recovery result for an undeclared boundary is not extra
  // evidence, it is an unrecognised claim.
  const facts = completeFacts();
  facts[0] = { ...facts[0], boundaryId: "full.invented.stored" };
  assert.throws(() => assertDurableBoundaryFacts(facts, HAPPY_ROOT), {
    code: "VES_SELFTEST_DURABLE_BOUNDARY_INVALID"
  });
});

test("the crash matrix derives its cases from the product catalog, never a local copy", () => {
  // Why the durable half needs no drift test of its own: the suite iterates the
  // frozen export. If it ever transcribed the eleven ids instead, this fails
  // and the activation half's problem would have spread.
  assert.match(CRASH_MATRIX_SUITE, /import \{[^}]*FULL_DURABLE_BOUNDARY_IDS[^}]*\}/su);
  assert.match(CRASH_MATRIX_SUITE, /for \(const boundaryId of FULL_DURABLE_BOUNDARY_IDS\)/u);
  assert.match(CRASH_MATRIX_SUITE, /for \(const phase of DURABLE_CRASH_PHASES\)/u);
  for (const boundaryId of FULL_DURABLE_BOUNDARY_IDS)
    assert.equal(
      CRASH_MATRIX_SUITE.includes(`"${boundaryId}"`),
      false,
      `${boundaryId} is written out in the crash matrix suite; it must come from the catalog`
    );
});

test("the activation fault-point catalog is the seven declared crash points", () => {
  assert.deepEqual([...ACTIVATION_FAULT_POINTS].sort(), [
    "after-copy",
    "after-health",
    "after-journal-committed",
    "after-journal-prepared",
    "after-journal-published",
    "after-pointer",
    "after-publish"
  ]);
});

test("every declared activation fault point has a crash-convergence case", () => {
  // The drift fix. `ActivationFaultPoint` is a type, so the fault suite cannot
  // iterate it and lists the points by hand; this reads the union from the
  // product and checks the suite against it. An eighth fault point fails here
  // instead of shipping with no recovery evidence.
  for (const point of ACTIVATION_FAULT_POINTS)
    assert.ok(
      ACTIVATION_FAULT_SUITE.includes(`"${point}"`),
      `activation fault point ${point} has no case in ${ACTIVATION_FAULT_SUITE_PATH}`
    );
});

test("the activation fault suite claims no crash point the product does not declare", () => {
  // The other direction. A case naming a point the manager never triggers would
  // be evidence for a boundary that does not exist.
  const claimed = [...ACTIVATION_FAULT_SUITE.matchAll(/"(after-[a-z-]+)"/gu)].map((match) => match[1]);
  assert.ok(claimed.length > 0, "the fault suite must name its crash points");
  for (const point of new Set(claimed))
    assert.ok(
      ACTIVATION_FAULT_POINTS.includes(point),
      `${ACTIVATION_FAULT_SUITE_PATH} claims ${point}, which ActivationFaultPoint does not declare`
    );
});

test("every declared activation fault point is reachable in the activation source", () => {
  // A declared fault point the manager never awaits is an unreachable case: the
  // suite would pass on a crash that cannot happen.
  for (const point of ACTIVATION_FAULT_POINTS)
    assert.ok(
      ACTIVATION_SOURCE.includes(`this.#fault("${point}")`),
      `${point} is declared but never triggered in ${ACTIVATION_SOURCE_PATH}`
    );
});
