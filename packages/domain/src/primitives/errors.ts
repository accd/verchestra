export type DomainErrorCode =
  | "VES_ID_INVALID"
  | "VES_ID_KIND_MISMATCH"
  | "VES_REQUIREMENT_ID_INVALID"
  | "VES_LOGICAL_PATH_INVALID"
  | "VES_DIGEST_INVALID"
  | "VES_INSTANT_INVALID"
  | "VES_ACTOR_INVALID"
  | "VES_CLASSIFICATION_INVALID"
  | "VES_ERROR_DEFINITION_INVALID"
  | "VES_ERROR_CODE_UNKNOWN"
  | "VES_ERROR_DETAILS_INVALID";

export class DomainValueError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = "DomainValueError";
    this.code = code;
  }
}
