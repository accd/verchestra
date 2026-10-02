// invariant: `task review` seals a Run Capsule over the Execution Package the
// plan bound. It proves that package exactly as `task approve` does, through
// the Run record's checked reader, before it reads the review surface, asks the
// human, or records anything. These cases call the command function on a real
// Workspace and stop at that refusal, so they need no credential and run on
// every platform.
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import { reviewTask } from "../../apps/vestra-cli/src/task/task-review.ts";
import { executionHarness, packageInput } from "../helpers/execution-package-fixture.mjs";
import {
  cleanupTaskCommandFixtures,
  listing,
  refusedState,
  taskCommandFixture
} from "../helpers/task-command-fixture.mjs";
import { RUN_ID, filled, planRecord } from "../helpers/task-run-record-fixture.mjs";

afterEach(cleanupTaskCommandFixtures);

async function inReview(planOverrides = () => ({})) {
  const fixture = await taskCommandFixture();
  const { builder } = executionHarness();
  const pkg = await builder.build(packageInput());
  const other = await builder.build(packageInput({ featureId: "feature:another" }));
  const bound = { packageId: pkg.artifactId, packageDigest: `sha256:${pkg.payloadDigest}` };
  const run = await fixture.planned("HUMAN_REVIEW", planRecord({ ...bound, ...planOverrides(other) }));
  await run.runRecord.savePackage(pkg);
  await run.runRecord.savePackage(other);
  const stored = (artifact) => join(run.directory, "packages", `${artifact.artifactId}.json`);
  const review = () =>
    reviewTask(fixture.io, { runId: RUN_ID, outcome: "accepted", surfaceDigest: filled("0"), confirmStdin: false });
  return { fixture, run, pkg, other, stored, review };
}

// why: with no task commit record a review that got past the package stops at
// the review surface, so this code is the proof that the package was accepted.
const PAST_THE_PACKAGE = "VES_TASK_REVIEW_UNAVAILABLE";

test("review accepts the Execution Package the plan bound and goes on to the review surface", async () => {
  const { review } = await inReview();
  await assert.rejects(review(), refusedState(PAST_THE_PACKAGE));
});

test("review refuses a package swapped after approval, before the surface is read or anything is recorded", async () => {
  const { fixture, run, pkg, other, stored, review } = await inReview();
  const original = await readFile(stored(pkg), "utf8");
  const before = await listing(run.directory);

  await writeFile(stored(pkg), await readFile(stored(other), "utf8"));
  await assert.rejects(review(), refusedState("VES_TASK_PACKAGE_INVALID"), "swapped for another sealed package");
  await writeFile(stored(pkg), "{not json");
  await assert.rejects(review(), refusedState("VES_TASK_PACKAGE_INVALID"), "damaged");
  await rm(stored(pkg));
  await assert.rejects(review(), refusedState("VES_TASK_PACKAGE_INVALID"), "missing");

  assert.equal(fixture.state(), "HUMAN_REVIEW", "a refused review moved the run");
  await writeFile(stored(pkg), original);
  assert.deepEqual(await listing(run.directory), before, "a refused review wrote to the Run directory");
  await assert.rejects(review(), refusedState(PAST_THE_PACKAGE), "the restored package is accepted again");
});

// invariant: a package the store finds intact is still not the approved one
// unless its payload digest is the digest the plan bound.
test("review refuses an intact package whose payload is not the one the plan bound", async () => {
  const { fixture, review } = await inReview((other) => ({ packageDigest: `sha256:${other.payloadDigest}` }));
  await assert.rejects(review(), refusedState("VES_TASK_PACKAGE_INVALID"));
  assert.equal(fixture.state(), "HUMAN_REVIEW");
});
