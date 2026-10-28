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
  // why: `codePointAt` joins a well-formed pair into one code point above
  // U+FFFF, so a surrogate it returns is one with no partner.
  let index = 0;
  while (index < value.length) {
    const code = value.codePointAt(index) ?? 0;
    if (code >= 0xd800 && code <= 0xdbff) {
      throw new CanonicalJsonError("VES_CANONICAL_INVALID_UNICODE", "Unpaired high surrogate");
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError("VES_CANONICAL_INVALID_UNICODE", "Unpaired low surrogate");
    }
    index += code > 0xffff ? 2 : 1;
  }
}

// Returns true for an accepted scalar and false for an object or array, which
// the caller walks; every other value is refused here.
function assertScalar(value: unknown): boolean {
  if (value === undefined) {
    throw new CanonicalJsonError("VES_CANONICAL_UNDEFINED_VALUE", "undefined is not canonical JSON data");
  }
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") {
    assertUnicode(value);
    return true;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalJsonError("VES_CANONICAL_NON_FINITE_NUMBER", "Number must be finite");
    }
    return true;
  }
  if (typeof value !== "object") {
    throw new CanonicalJsonError("VES_CANONICAL_NON_JSON_VALUE", "Value is not canonical JSON data");
  }
  return false;
}

function assertArrayItems(
  value: readonly unknown[],
  seen: Set<object>,
  budget: { nodes: number },
  depth: number
): void {
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      throw new CanonicalJsonError("VES_CANONICAL_SPARSE_ARRAY", "Sparse arrays are not canonical JSON data");
    }
    assertValue(value[index], seen, budget, depth + 1);
  }
}

function dataPropertyValue(value: object, key: string | symbol): unknown {
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
  return descriptor.value;
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
  if (assertScalar(value)) return;
  const container = value as object;
  if (seen.has(container)) {
    throw new CanonicalJsonError("VES_CANONICAL_CYCLIC_VALUE", "Cyclic value cannot be canonicalized");
  }

  const prototype = Object.getPrototypeOf(container) as object | null;
  if (!Array.isArray(container) && prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError("VES_CANONICAL_INVALID_PROTOTYPE", "Only plain JSON objects are accepted");
  }

  seen.add(container);
  try {
    if (Array.isArray(container)) {
      assertArrayItems(container, seen, budget, depth);
      return;
    }

    for (const key of Reflect.ownKeys(container)) {
      assertValue(dataPropertyValue(container, key), seen, budget, depth + 1);
    }
  } finally {
    seen.delete(container);
  }
}

export function assertCanonicalJsonValue(value: unknown): asserts value is JsonValue {
  assertValue(value, new Set(), { nodes: 0 }, 0);
}
