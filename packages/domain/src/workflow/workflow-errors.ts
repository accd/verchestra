import { PublicErrorRegistry, type PublicErrorDefinition } from "../errors/public-error.ts";

const workflowError = (
  code: string,
  category: PublicErrorDefinition["category"],
  retryability: PublicErrorDefinition["retryability"],
  recovery: string
): PublicErrorDefinition =>
  Object.freeze({
    code,
    category,
    component: "workflow",
    retryability,
    recovery,
    documentationVersion: "1",
    safeDetails: Object.freeze({})
  });

export const WORKFLOW_PUBLIC_ERROR_DEFINITIONS = Object.freeze([
  workflowError("VES_WORKFLOW_ACTOR_DENIED", "security", "never", "Use an actor authorized for this transition."),
  workflowError(
    "VES_WORKFLOW_APPROVAL_REQUIRED",
    "policy",
    "after-change",
    "Obtain a current Human Execution Approval."
  ),
  workflowError(
    "VES_WORKFLOW_APPROVAL_STALE",
    "security",
    "after-change",
    "Refresh the bound execution state and request approval again."
  ),
  workflowError(
    "VES_WORKFLOW_AUTHOR_VERIFIER_CONFLICT",
    "security",
    "after-change",
    "Assign verification to an identity distinct from the implementation author."
  ),
  workflowError(
    "VES_WORKFLOW_COMMAND_REJECTED",
    "state",
    "after-change",
    "Refresh the run and choose a command legal in its current state."
  ),
  workflowError(
    "VES_WORKFLOW_EVIDENCE_REQUIRED",
    "validation",
    "after-change",
    "Produce the declared transition evidence before retrying."
  ),
  workflowError(
    "VES_WORKFLOW_HANDOFF_APPROVAL_REQUIRED",
    "policy",
    "after-change",
    "Obtain publication-only Handoff Approval and its receipt."
  ),
  workflowError(
    "VES_WORKFLOW_RUN_KIND_MISMATCH",
    "validation",
    "never",
    "Use the command only with its declared run kind."
  ),
  workflowError(
    "VES_WORKFLOW_SUCCESSOR_INVALID",
    "integrity",
    "after-change",
    "Verify the package, source binding, local bindings, policy, claim, and successor linkage."
  ),
  workflowError(
    "VES_WORKFLOW_TERMINAL",
    "state",
    "never",
    "Create a linked successor run instead of mutating a terminal run."
  ),
  workflowError(
    "VES_WORKFLOW_VERSION_CONFLICT",
    "conflict",
    "after-change",
    "Reload the current run version before deciding again."
  )
]);

export const workflowPublicErrorRegistry = new PublicErrorRegistry(WORKFLOW_PUBLIC_ERROR_DEFINITIONS);
