import { refTarget, taskBranchName, taskBranchRef } from "@verchestra/platform-node";

import { canonicalDigest, sha256 } from "./task-files.ts";
import { git } from "./task-git.ts";
import type { TaskPlanRecord } from "./task-plan-record.ts";
import type { RunRecord } from "./task-run-record.ts";

export function branchName(plan: TaskPlanRecord): string {
  return taskBranchName(plan.runId, plan.request.task.taskId);
}

// invariant: the review surface is everything the human accepts or rejects,
// and its digest is what they type back; any change to the commit, the
// anchored branch, the diff, or the verification report changes the digest.
export async function reviewSurface(
  repositoryRoot: string,
  plan: TaskPlanRecord,
  runRecord: Pick<RunRecord, "verifiedCommit">
) {
  const { commit, report } = await runRecord.verifiedCommit();
  const diff = await git(repositoryRoot, [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    commit.baseCommit,
    commit.commitId
  ]);
  const changedPaths = (await git(repositoryRoot, ["diff", "--name-only", commit.baseCommit, commit.commitId]))
    .split(/\r?\n/u)
    .filter(Boolean);
  const surface = {
    schemaVersion: 1,
    runId: plan.runId,
    taskId: plan.request.task.taskId,
    baseCommit: commit.baseCommit,
    commitId: commit.commitId,
    branch: branchName(plan),
    branchTarget: (await refTarget(repositoryRoot, taskBranchRef(plan.runId, plan.request.task.taskId))) ?? "missing",
    changedPaths,
    diffDigest: sha256(diff),
    gateEvidenceDigest: commit.gateEvidenceDigest,
    verification: { reportDigest: canonicalDigest(report), verdict: report["verdict"] }
  };
  return { surface, digest: canonicalDigest(surface), commit, report };
}
