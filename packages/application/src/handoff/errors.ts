// Error taxonomy for the portable handoff boundary.

export type HandoffErrorCode =
  | "VES_HANDOFF_INPUT_INVALID"
  | "VES_HANDOFF_PRIVATE_MATERIAL"
  | "VES_HANDOFF_SOURCE_STALE"
  | "VES_HANDOFF_PACKAGE_INVALID"
  | "VES_HANDOFF_ARTIFACT_INVALID"
  | "VES_HANDOFF_WORKSPACE_MISMATCH"
  | "VES_HANDOFF_WORKFLOW_REJECTED"
  | "VES_HANDOFF_PUBLICATION_APPROVAL_INVALID"
  | "VES_HANDOFF_RECONCILIATION_REQUIRED"
  | "VES_HANDOFF_PUBLICATION_INVALID"
  | "VES_HANDOFF_CLAIM_INVALID"
  | "VES_HANDOFF_CAPSULE_INVALID"
  | "VES_HANDOFF_FINAL_RECORD_INVALID"
  | "VES_HANDOFF_SUCCESSOR_MISMATCH"
  | "VES_HANDOFF_LOCAL_BINDINGS_REQUIRED"
  | "VES_HANDOFF_POLICY_DENIED"
  | "VES_HANDOFF_CLAIM_REQUIRED"
  | "VES_HANDOFF_ACCEPTANCE_INVALID"
  | "VES_HANDOFF_EXECUTION_APPROVAL_INVALID";

export class HandoffError extends Error {
  readonly code: HandoffErrorCode;

  constructor(code: HandoffErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HandoffError";
    this.code = code;
  }
}

export function fail(code: HandoffErrorCode, message: string): never {
  throw new HandoffError(code, message);
}
