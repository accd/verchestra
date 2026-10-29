import {
  PublicErrorException,
  type ErrorCategory,
  type PublicErrorRegistry,
  type Retryability,
  type SafeDetailType
} from "@verchestra/domain";

import { publicError as taskPublicError } from "./task-public-error.ts";

// why: every definition of a command family that shares the task io names the
// family's component and documentation version 1, and no safe detail unless
// it lists one; only what differs is written per code, and each code stays a
// literal the family's error factory takes.
export function familyErrorDefinitions<const Component extends string>(component: Component) {
  return <const Code extends string>(
    code: Code,
    category: ErrorCategory,
    retryability: Retryability,
    recovery: string,
    safeDetails: Readonly<Record<string, SafeDetailType>> = {}
  ) =>
    ({
      code,
      category,
      component,
      retryability,
      recovery,
      documentationVersion: "1",
      safeDetails
    }) as const;
}

export interface PublicErrorFamily {
  readonly registry: PublicErrorRegistry;
  // invariant: the family's catch-all code; its one safe detail is `reason`.
  readonly failed: string;
  readonly message: string;
  // why: a family may name a whole class of codes it does not own.
  readonly refine?: (code: string, error: unknown) => PublicErrorException | undefined;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { readonly code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

// invariant: what a family command shows for an error. A public refusal stays
// as it is; a family code with no safe detail becomes its own envelope; a code
// the family refines becomes the envelope it names; anything else is mapped
// as a task command maps it, with the family's catch-all in place of
// VES_TASK_FAILED.
export function familyPublicError(family: PublicErrorFamily, error: unknown): PublicErrorException {
  if (error instanceof PublicErrorException) return error;
  const code = codeOf(error);
  const definition = family.registry.definitions.find((entry) => entry.code === code);
  if (definition !== undefined && Object.keys(definition.safeDetails).length === 0)
    return new PublicErrorException(family.registry.create(definition.code, {}), family.message, { cause: error });
  const refined = code === undefined ? undefined : family.refine?.(code, error);
  if (refined !== undefined) return refined;
  const mapped = taskPublicError(error);
  if (mapped.envelope.code !== "VES_TASK_FAILED") return mapped;
  return new PublicErrorException(
    family.registry.create(family.failed, { ...mapped.envelope.safeDetails }),
    family.message,
    { cause: error }
  );
}
