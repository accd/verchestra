import { join } from "node:path";

import type { TaskRunCommit } from "@verchestra/application";

import { stateInvalid } from "./task-errors.ts";
import { readOptionalRecord } from "./task-evidence.ts";
import { canonicalDigest, sha256, writeSealedRecord } from "./task-files.ts";
import { git, refTarget, taskBranch } from "./task-git.ts";
import type { TaskPlanRecord } from "./task-plan-record.ts";
import { reportPath } from "./task-verifier.ts";

const OBJECT_ID = /^[a-f0-9]{40}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export function commitPath(runDirectory: string): string {
  return join(runDirectory, "commit.json");
}

export async function saveCommit(runDirectory: string, commit: TaskRunCommit): Promise<void> {
  await writeSealedRecord(commitPath(runDirectory), commit);
}

export async function loadCommit(runDirectory: string): Promise<TaskRunCommit | undefined> {
  const row = await readOptionalRecord(commitPath(runDirectory), "task commit record");
  if (row === undefined) return undefined;
  const refs = row["gateEvidenceRefs"];
  if (
    typeof row["commitId"] !== "string" ||
    !OBJECT_ID.test(row["commitId"]) ||
    typeof row["baseCommit"] !== "string" ||
    !OBJECT_ID.test(row["baseCommit"]) ||
    typeof row["gateEvidenceDigest"] !== "string" ||
    !DIGEST.test(row["gateEvidenceDigest"]) ||
    !Array.isArray(refs)
  )
    throw stateInvalid("VES_TASK_STATE_MALFORMED", "The task commit record is malformed");
  return row as unknown as TaskRunCommit;
}

export function branchName(plan: TaskPlanRecord): string {
  return `vestra/${plan.runId}/${plan.request.task.taskId}`;
}

// invariant: the review surface is everything the human accepts or rejects,
// and its digest is what they type back; any change to the commit, the
// anchored branch, the diff, or the verification report changes the digest.
export async function reviewSurface(repositoryRoot: string, plan: TaskPlanRecord, runDirectory: string) {
  const commit = await loadCommit(runDirectory);
  const report = await readOptionalRecord(reportPath(runDirectory), "verification report");
  if (commit === undefined || report === undefined)
    throw stateInvalid("VES_TASK_REVIEW_UNAVAILABLE", "The run has no verified task commit to review");
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
    branchTarget: (await refTarget(repositoryRoot, taskBranch(plan.runId, plan.request.task.taskId))) ?? "missing",
    changedPaths,
    diffDigest: sha256(diff),
    gateEvidenceDigest: commit.gateEvidenceDigest,
    verification: { reportDigest: canonicalDigest(report), verdict: report["verdict"] }
  };
  return { surface, digest: canonicalDigest(surface), commit, report };
}
