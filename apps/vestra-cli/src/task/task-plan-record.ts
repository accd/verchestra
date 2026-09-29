import { join } from "node:path";

import {
  normalizeTaskRequest,
  type ApprovalIntent,
  type ApprovalRequest,
  type NormalizedTaskRequest
} from "@verchestra/application";

import { stateInvalid, taskError } from "./task-errors.ts";
import { canonicalDigest, objectRow, readSealedRecord, textField, writeSealedRecord } from "./task-files.ts";
import { runDirectory, type TaskWorkspace } from "./task-workspace.ts";

type Digest = `sha256:${string}`;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

export const IMPLEMENTER_ACTOR = "actor:claude-code-implementer";
export const VERIFIER_ACTOR = "actor:codex-verifier";
export const HUMAN_ACTOR = "human:local-operator";
export const WRITE_CAPABILITY = "worktree-write";

// invariant: everything a later command needs to act on a planned run, sealed
// by its own digest. The request is re-normalized on every load, so a record
// can never carry a request the intake contract would refuse.
export interface TaskPlanRecord {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly request: NormalizedTaskRequest;
  readonly requestDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly contextManifestDigest: Digest;
  readonly policyViewDigest: Digest;
  readonly gatePlanDigest: Digest;
  readonly packageId: string;
  readonly packageDigest: Digest;
  readonly approvalIntent: ApprovalIntent;
  readonly approvalRequest: ApprovalRequest;
}

export function planRecordPath(workspace: TaskWorkspace, runId: string): string {
  return join(runDirectory(workspace, runId), "plan.json");
}

export async function savePlanRecord(workspace: TaskWorkspace, record: TaskPlanRecord): Promise<void> {
  await writeSealedRecord(planRecordPath(workspace, record.runId), record);
}

function digestField(row: Readonly<Record<string, unknown>>, key: string): Digest {
  const value = row[key];
  if (typeof value !== "string" || !DIGEST.test(value))
    throw stateInvalid("VES_TASK_STATE_MALFORMED", `plan.${key} is not a digest`);
  return value as Digest;
}

function validated(workspace: TaskWorkspace, runId: string, stored: unknown): TaskPlanRecord {
  const row = objectRow(stored, "plan");
  if (row["schemaVersion"] !== 1 || row["runId"] !== runId || row["workspaceId"] !== workspace.workspaceId)
    throw stateInvalid("VES_TASK_STATE_MISMATCH", "The plan record belongs to another run or Workspace");
  let request: NormalizedTaskRequest;
  try {
    request = normalizeTaskRequest(row["request"]);
  } catch (error) {
    throw stateInvalid("VES_TASK_STATE_MALFORMED", "The stored task request no longer validates", { cause: error });
  }
  for (const key of [
    "requestDigest",
    "sourceStateDigest",
    "contextManifestDigest",
    "policyViewDigest",
    "gatePlanDigest",
    "packageDigest"
  ])
    digestField(row, key);
  if (canonicalDigest(request) !== row["requestDigest"])
    throw stateInvalid("VES_TASK_STATE_TAMPERED", "The stored task request does not match its digest");
  textField(row, "packageId", "plan");
  textField(row, "createdAt", "plan");
  const approval = objectRow(row["approvalRequest"], "plan.approvalRequest");
  digestField(approval, "bindingDigest");
  textField(approval, "approvalId", "plan.approvalRequest");
  objectRow(row["approvalIntent"], "plan.approvalIntent");
  return { ...(row as unknown as TaskPlanRecord), request };
}

export async function loadPlanRecord(workspace: TaskWorkspace, runId: string): Promise<TaskPlanRecord> {
  const stored = await readSealedRecord(planRecordPath(workspace, runId), "plan record");
  if (stored === undefined)
    throw taskError("VES_TASK_RUN_NOT_FOUND", {}, "No planned run with this ID exists in the Workspace");
  return validated(workspace, runId, stored);
}
