import type {
  ApprovalIntent,
  ApprovalRequest,
  NormalizedTaskRequest,
  NormalizedTaskRequestV2
} from "@verchestra/application";

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
// invariant: a run of a v2 request: a coordination plan of nodes inside the
// one executor run, then the same independent verifier.
export type CoordinatedPlan = TaskPlanRecord<NormalizedTaskRequestV2>;

export function isCoordinatedPlan(plan: TaskPlanRecord): plan is CoordinatedPlan {
  return plan.request.schemaVersion === 2;
}

// invariant: the driver that wrote the change the verifier judges. Only a
// Claude Code node writes in a coordinated run, so it is Claude Code either way.
export function implementerDriverId(request: PlannedTaskRequest): "claude-code" {
  return request.schemaVersion === 1 ? request.driver.driverId : "claude-code";
}
