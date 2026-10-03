import type {
  ApprovalIntent,
  ApprovalRequest,
  NormalizedTaskRequest,
  NormalizedTaskRequestV2
} from "@verchestra/application";

import { notConfigured } from "./task-errors.ts";

type Digest = `sha256:${string}`;

// invariant: a planned run holds a normalized Task Request of either version;
// the request carries its own schemaVersion, so the plan record keeps its own.
export type PlannedTaskRequest = NormalizedTaskRequest | NormalizedTaskRequestV2;

export const IMPLEMENTER_ACTOR = "actor:claude-code-implementer";
export const VERIFIER_ACTOR = "actor:codex-verifier";
export const HUMAN_ACTOR = "human:local-operator";
export const WRITE_CAPABILITY = "worktree-write";

// invariant: the seal a run planned now names for the five markers of its Run
// directory. A plan record without `markerSeal` belongs to a run planned
// before the markers were sealed: that run keeps its plain markers, and its
// plan record is never rewritten to add the member.
export const MARKER_SEAL = 1;

// invariant: everything a later command needs to act on a planned run. The
// Run record seals it by its own digest and validates it on every load.
export interface TaskPlanRecord<Request extends PlannedTaskRequest = PlannedTaskRequest> {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly workspaceId: string;
  readonly createdAt: string;
  readonly request: Request;
  readonly requestDigest: Digest;
  readonly sourceStateDigest: Digest;
  readonly contextManifestDigest: Digest;
  readonly policyViewDigest: Digest;
  readonly gatePlanDigest: Digest;
  readonly packageId: string;
  readonly packageDigest: Digest;
  readonly approvalIntent: ApprovalIntent;
  readonly approvalRequest: ApprovalRequest;
  readonly markerSeal?: typeof MARKER_SEAL;
}

// invariant: a run of a v1 request: one implementer session, then the verifier.
export type SingleSessionPlan = TaskPlanRecord<NormalizedTaskRequest>;

function isSingleSession(plan: TaskPlanRecord): plan is SingleSessionPlan {
  return plan.request.schemaVersion === 1;
}

// why: a coordinated (v2) plan names no single implementer. Until the
// coordinated driver composes its nodes, a command that would drive or review
// an implementer refuses such a run here, before it reads a credential,
// applies a transition, or creates a worktree, and leaves it as it was.
export function singleSessionPlan(plan: TaskPlanRecord): SingleSessionPlan {
  if (!isSingleSession(plan))
    throw notConfigured("coordinated-run", "This build cannot run or review a coordinated task plan");
  return plan;
}
