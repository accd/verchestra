// Rejects any value RFC 8785 cannot faithfully represent, before encoding.
//
// Rule set ported (not imported — evidence is an adapter package and the
// inward dependency rule forbids domain from depending on it) from
// packages/evidence/src/integrity/canonical.ts:31-105.

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type CanonicalJsonErrorCode =
  | "VES_CANONICAL_UNDEFINED_VALUE"
  | "VES_CANONICAL_NON_JSON_VALUE"
  | "VES_CANONICAL_SPARSE_ARRAY"
  | "VES_CANONICAL_ACCESSOR_PROPERTY"
  | "VES_CANONICAL_SYMBOL_KEY"
  | "VES_CANONICAL_CYCLIC_VALUE"
  | "VES_CANONICAL_NON_FINITE_NUMBER"
  | "VES_CANONICAL_INVALID_PROTOTYPE"
  | "VES_CANONICAL_INVALID_UNICODE"
  | "VES_CANONICAL_RESOURCE_LIMIT";

export class CanonicalJsonError extends Error {
  readonly code: CanonicalJsonErrorCode;

  constructor(code: CanonicalJsonErrorCode, message: string) {
    super(message);
    this.name = "CanonicalJsonError";
    this.code = code;
  }
}

const MAX_DEPTH = 128;
const MAX_NODES = 100_000;

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) {
        throw new CanonicalJsonError("VES_CANONICAL_INVALID_UNICODE", "Unpaired high surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError("VES_CANONICAL_INVALID_UNICODE", "Unpaired low surrogate");
    }
  }
}

function assertValue(
  value: unknown,
  seen: Set<object>,
  budget: { nodes: number },
  depth: number
): asserts value is JsonValue {
  budget.nodes += 1;
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) {
    throw new CanonicalJsonError("VES_CANONICAL_RESOURCE_LIMIT", "Canonical JSON value exceeds safety limits");
  }
  if (value === undefined) {
    throw new CanonicalJsonError("VES_CANONICAL_UNDEFINED_VALUE", "undefined is not canonical JSON data");
  }
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("VES_CANONICAL_NON_FINITE_NUMBER", "Number must be finite");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError("VES_CANONICAL_NON_JSON_VALUE", "Value is not canonical JSON data");
  }
  if (seen.has(value)) {
    throw new CanonicalJsonError("VES_CANONICAL_CYCLIC_VALUE", "Cyclic value cannot be canonicalized");
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError("VES_CANONICAL_INVALID_PROTOTYPE", "Only plain JSON objects are accepted");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new CanonicalJsonError("VES_CANONICAL_SPARSE_ARRAY", "Sparse arrays are not canonical JSON data");
        }
        assertValue(value[index], seen, budget, depth + 1);
      }
      return;
    }

    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") {
        throw new CanonicalJsonError("VES_CANONICAL_SYMBOL_KEY", "Symbol properties are not canonical JSON data");
      }
      assertUnicode(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw new CanonicalJsonError(
          "VES_CANONICAL_ACCESSOR_PROPERTY",
          "Canonical JSON properties must be enumerable data properties"
        );
      }
      assertValue(descriptor.value, seen, budget, depth + 1);
    }
  } finally {
    seen.delete(value);
  }
}

export function assertCanonicalJsonValue(value: unknown): asserts value is JsonValue {
  assertValue(value, new Set(), { nodes: 0 }, 0);
}
