import type { ApprovalIntent, ApprovalRequest, NormalizedTaskRequest } from "@verchestra/application";

type Digest = `sha256:${string}`;

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
  readonly markerSeal?: typeof MARKER_SEAL;
}
