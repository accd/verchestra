// T70: pure helpers in the CLI's self-test composition, tested directly
// without a filesystem or a spawned process.
import assert from "node:assert/strict";
import test from "node:test";
import { placementMatchesExpectation, snapshotsIdentical } from "../../apps/vestra-cli/src/index.ts";

test("identical snapshots compare equal", () => {
  assert.equal(snapshotsIdentical(["a:1", "b:2"], ["a:1", "b:2"]), true);
});

test("a changed digest is detected", () => {
  assert.equal(snapshotsIdentical(["a:1"], ["a:2"]), false);
});

test("an added file is detected", () => {
  assert.equal(snapshotsIdentical(["a:1"], ["a:1", "b:2"]), false);
});

test("a removed file is detected", () => {
  assert.equal(snapshotsIdentical(["a:1", "b:2"], ["a:1"]), false);
});

test("two empty snapshots compare equal", () => {
  assert.equal(snapshotsIdentical([], []), true);
});

test("placement matches when project count and ignored path both match", () => {
  const inventory = { projects: [{ logicalPath: ".", ignoredByControl: false }] };
  assert.equal(placementMatchesExpectation(inventory, { projectCount: 1, ignoredProjectPath: null }), true);
});

test("placement fails when project count differs", () => {
  const inventory = { projects: [{ logicalPath: ".", ignoredByControl: false }] };
  assert.equal(placementMatchesExpectation(inventory, { projectCount: 2, ignoredProjectPath: null }), false);
});

test("placement fails when a project is unexpectedly ignored", () => {
  const inventory = { projects: [{ logicalPath: "projects/x", ignoredByControl: true }] };
  assert.equal(placementMatchesExpectation(inventory, { projectCount: 1, ignoredProjectPath: null }), false);
});

test("placement fails when the expected ignored path is not actually ignored", () => {
  const inventory = { projects: [{ logicalPath: "projects/x", ignoredByControl: false }] };
  assert.equal(placementMatchesExpectation(inventory, { projectCount: 1, ignoredProjectPath: "projects/x" }), false);
});
