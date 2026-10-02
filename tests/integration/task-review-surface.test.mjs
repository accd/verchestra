// invariant: the review surface is everything the human accepts or rejects,
// and its digest is what they type back. It is built from the Run record's
// commit record and verification report and from real git. The golden digests
// were recorded from the task sources as they stood before the Run record
// module existed (revision 0158e48), on a repository whose object IDs are the
// same on every machine, in the SHA-1 and SHA-256 object formats.
import assert from "node:assert/strict";
import { join } from "node:path";
import { after, test } from "node:test";

import { openRunRecord } from "../../apps/vestra-cli/src/task/task-run-record.ts";
import { reviewSurface } from "../../apps/vestra-cli/src/task/task-surface.ts";
import { git } from "../helpers/git-object-format-fixture.mjs";
import {
  RUN_ID,
  TASK_ID,
  WORKSPACE_ID,
  canonicalDigestOf,
  cleanupRunRecordFixtures,
  deterministicTaskRepository,
  filled,
  planRecord,
  taskCommit,
  taskRequest,
  temporaryRoot,
  verificationReport,
  withEmptyGitHome
} from "../helpers/task-run-record-fixture.mjs";

after(cleanupRunRecordFixtures);

const BRANCH = `vestra/${RUN_ID}/${TASK_ID}`;
const GOLDEN = Object.freeze({
  sha1: {
    baseCommit: "aaca1ba1c6fae3b122dd15b2192ba694146a3ae8",
    commitId: "f7af39cd8b8ad10794f49f54be46166baac28b8f",
    diffDigest: "sha256:35a59018fd6602ba3cc5aec27c042cb99c9ccb5263e7fe8b9c1a57c53e768be6",
    reportDigest: "sha256:e8e7fb0d2fd8a3bfb009e48bfc1fced6bd532242cea7d791c8bf9e86e26cc840",
    digest: "sha256:291be5eae659b0d357eb123a8c170fd9ffc75bff8542f9e8f438062e55e78aa2"
  },
  sha256: {
    baseCommit: "38fa70dfc6106812327bc00020ee282e96aca261035b9b5a50769672eab973e7",
    commitId: "cba0d1f49d0c67d8a715fd03aa8c9c32c826ce01db12db937b5e927c0fe26206",
    diffDigest: "sha256:471914a1f45481eb41389a620b74a6a98b84fd5e66ac73fb60f13792fb1fa1a9",
    reportDigest: "sha256:2c43817513c2293dc503af31d335828d5ca0a2d47c125296de4be2290417816f",
    digest: "sha256:3b45727821c9f995b2d20b02c1fffbdb9be68b10e6b4028d1c8152edf97090d0"
  }
});

async function verifiedRun(objectFormat) {
  const repository = await deterministicTaskRepository(objectFormat);
  const runRecord = openRunRecord(
    { workspaceId: WORKSPACE_ID, tasksRoot: join(await temporaryRoot(), "tasks") },
    RUN_ID
  );
  const plan = planRecord({ request: taskRequest(repository.baseCommit) });
  await runRecord.saveCommit(taskCommit({ commitId: repository.commitId, baseCommit: repository.baseCommit }));
  await runRecord.saveReport(verificationReport({ commitId: repository.commitId }));
  const surface = () => withEmptyGitHome(() => reviewSurface(repository.repositoryRoot, plan, runRecord));
  return { ...repository, runRecord, plan, surface };
}

for (const [objectFormat, golden] of Object.entries(GOLDEN)) {
  test(`the review surface of a ${objectFormat} run is the recorded golden`, async () => {
    const run = await verifiedRun(objectFormat);
    assert.equal(run.baseCommit, golden.baseCommit, "the fixture repository is not the recorded one");
    assert.equal(run.commitId, golden.commitId, "the fixture repository is not the recorded one");
    const review = await run.surface();
    assert.deepEqual(review.surface, {
      schemaVersion: 1,
      runId: RUN_ID,
      taskId: TASK_ID,
      baseCommit: golden.baseCommit,
      commitId: golden.commitId,
      branch: BRANCH,
      branchTarget: golden.commitId,
      changedPaths: ["src/value.txt"],
      diffDigest: golden.diffDigest,
      gateEvidenceDigest: filled("5"),
      verification: { reportDigest: golden.reportDigest, verdict: "PASS" }
    });
    assert.equal(review.digest, golden.digest);
    assert.equal(review.digest, canonicalDigestOf(review.surface));
    assert.equal(golden.reportDigest, canonicalDigestOf(verificationReport({ commitId: golden.commitId })));
    assert.deepEqual(review.commit, await run.runRecord.loadCommit());
    assert.deepEqual(review.report, await run.runRecord.loadReport());
  });

  test(`the ${objectFormat} surface digest moves with the report, the commit record, and the task branch`, async () => {
    const run = await verifiedRun(objectFormat);
    const digests = new Set([golden.digest]);
    const moved = async (label) => {
      const { digest } = await run.surface();
      assert.equal(digests.has(digest), false, `${label} left the surface digest where it was`);
      digests.add(digest);
    };

    await run.runRecord.saveReport(verificationReport({ commitId: run.commitId, verdict: "FAIL" }));
    await moved("a changed verification report");
    await run.runRecord.saveCommit(
      taskCommit({ commitId: run.commitId, baseCommit: run.baseCommit, gateEvidenceDigest: filled("6") })
    );
    await moved("a changed gate evidence digest");
    git(run.repositoryRoot, "update-ref", `refs/heads/${BRANCH}`, run.baseCommit);
    await moved("a moved task branch");
    git(run.repositoryRoot, "update-ref", "-d", `refs/heads/${BRANCH}`);
    await moved("a deleted task branch");
    assert.equal((await run.surface()).surface.branchTarget, "missing");
  });
}

test("a run with no verified task commit has no review surface, before any git call", async () => {
  const runRecord = openRunRecord(
    { workspaceId: WORKSPACE_ID, tasksRoot: join(await temporaryRoot(), "tasks") },
    RUN_ID
  );
  const absent = join(await temporaryRoot(), "no-repository");
  const unavailable = (error) => {
    assert.equal(error.envelope.code, "VES_TASK_STATE_INVALID");
    assert.equal(error.envelope.safeDetails.reason, "VES_TASK_REVIEW_UNAVAILABLE");
    return true;
  };
  await assert.rejects(reviewSurface(absent, planRecord(), runRecord), unavailable);
  await runRecord.saveCommit(taskCommit());
  await assert.rejects(reviewSurface(absent, planRecord(), runRecord), unavailable);
});
