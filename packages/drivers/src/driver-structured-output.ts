import { canonicalizeJsonV2, resultStructured, type DriverEventOf } from "@verchestra/domain";

import { DriverProtocolError } from "./index.ts";

// invariant: what a session asks of its provider when its result is
// structured: the JSON Schema the provider holds its final answer to, and the
// most bytes of canonical JSON that answer may take. The application owns the
// schema; the driver passes it on and bounds the answer, nothing more.
export interface DriverStructuredOutput {
  readonly schema: Readonly<Record<string, unknown>>;
  readonly maxBytes: number;
}

// why: the schema travels as one process argument for Claude Code, so it is
// held well below the smallest per-argument limit of a supported platform.
export const MAXIMUM_OUTPUT_SCHEMA_BYTES = 16_384;
// why: a result becomes one payload in the run's payload store, whose entries
// are bounded at 1 MiB (MAXIMUM_EXECUTION_PAYLOAD_BYTES).
export const MAXIMUM_STRUCTURED_RESULT_BYTES = 1_048_576;

// invariant: a validated request. The schema is its canonical text, so the
// provider receives the same bytes for the same schema on every run.
export interface StructuredOutputPlan {
  readonly schemaText: string;
  readonly maxBytes: number;
}

const byName = (left: string, right: string) => Number(left > right) - Number(left < right);

interface DriverNaming {
  readonly errorCodePrefix: string;
  readonly noun: string;
}

function canonicalSchema(schema: unknown): string | undefined {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return undefined;
  try {
    return canonicalizeJsonV2(schema);
  } catch {
    return undefined;
  }
}

function validBound(maxBytes: unknown): maxBytes is number {
  return (
    Number.isSafeInteger(maxBytes) &&
    (maxBytes as number) >= 1 &&
    (maxBytes as number) <= MAXIMUM_STRUCTURED_RESULT_BYTES
  );
}

// invariant: no request, no plan. A request whose members are not exactly the
// schema and the bound, whose schema is not a canonical JSON object within its
// size, or whose bound is not a count up to the result ceiling is refused with
// `<prefix>_OUTPUT_SCHEMA_INVALID` before anything is spawned.
export function structuredOutputPlan(
  request: DriverStructuredOutput | undefined,
  naming: DriverNaming
): StructuredOutputPlan | undefined {
  if (request === undefined) return undefined;
  const members = request !== null && typeof request === "object" ? Object.keys(request).sort(byName).join(",") : "";
  const schemaText = members === "maxBytes,schema" ? canonicalSchema(request.schema) : undefined;
  const schemaBytes = schemaText === undefined ? Infinity : new TextEncoder().encode(schemaText).byteLength;
  if (schemaText === undefined || schemaBytes > MAXIMUM_OUTPUT_SCHEMA_BYTES || !validBound(request.maxBytes))
    throw new DriverProtocolError(
      `${naming.errorCodePrefix}_OUTPUT_SCHEMA_INVALID`,
      `${naming.noun} structured output request is invalid`
    );
  return Object.freeze({ schemaText, maxBytes: request.maxBytes });
}

// invariant: what a provider's structured answer becomes: the bounded event,
// or the stable code its run fails with. An answer the provider did not give
// is `<prefix>_STRUCTURED_OUTPUT_MISSING`; one canonical JSON cannot spell is
// `_INVALID`; one beyond the bound is `_LIMIT`. Nothing of the answer is in
// the code.
export function structuredAnswer(
  reported: unknown,
  plan: StructuredOutputPlan,
  errorCodePrefix: string
): DriverEventOf<"result.structured"> | { readonly code: string } {
  if (reported === undefined || reported === null) return { code: `${errorCodePrefix}_STRUCTURED_OUTPUT_MISSING` };
  const read = resultStructured(reported, plan.maxBytes);
  if (read === "invalid") return { code: `${errorCodePrefix}_STRUCTURED_OUTPUT_INVALID` };
  if (read === "too-large") return { code: `${errorCodePrefix}_STRUCTURED_OUTPUT_LIMIT` };
  return read;
}
