import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import { canonicalizeJsonV2 } from "@verchestra/domain";

import type { KeyLifecycleErrorCode } from "./key-provider.ts";
import type { JsonValue } from "./types.ts";

export type IntegrityErrorCode =
  | "VES_INTEGRITY_NON_JSON_VALUE"
  | "VES_INTEGRITY_INVALID_UNICODE"
  | "VES_INTEGRITY_CYCLIC_VALUE"
  | "VES_INTEGRITY_RESOURCE_LIMIT"
  | "VES_INTEGRITY_INVALID_BINDING"
  | "VES_SIGNING_PURPOSE_DENIED"
  | "VES_TRUST_ROOT_INVALID"
  // Thrown when a stored artifact is not a DSSE envelope carrying a declared
  // in-toto attestation. Shares the name of the verification result code so the
  // same condition reads the same whether it is thrown or returned.
  | "VES_ENVELOPE_UNSUPPORTED"
  | KeyLifecycleErrorCode;

export class IntegrityError extends Error {
  readonly code: IntegrityErrorCode;

  constructor(code: IntegrityErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IntegrityError";
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
        throw new IntegrityError("VES_INTEGRITY_INVALID_UNICODE", "Unpaired high surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new IntegrityError("VES_INTEGRITY_INVALID_UNICODE", "Unpaired low surrogate");
    }
  }
}

function assertJsonValue(
  value: unknown,
  seen: Set<object>,
  budget: { nodes: number },
  depth = 0
): asserts value is JsonValue {
  budget.nodes += 1;
  if (depth > MAX_DEPTH || budget.nodes > MAX_NODES) {
    throw new IntegrityError("VES_INTEGRITY_RESOURCE_LIMIT", "JSON value exceeds safety limits");
  }

  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "Number must be finite");
    }
    return;
  }
  if (typeof value !== "object") {
    throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "Value is not JSON data");
  }
  if (seen.has(value)) {
    throw new IntegrityError("VES_INTEGRITY_CYCLIC_VALUE", "Cyclic JSON value");
  }

  const prototype = Object.getPrototypeOf(value) as object | null;
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "Only plain JSON objects are accepted");
  }
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) {
    throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "Symbol properties are not JSON data");
  }

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "Sparse arrays are not JSON data");
        }
        assertJsonValue(value[index], seen, budget, depth + 1);
      }
      return;
    }

    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      assertUnicode(key);
      if (!descriptor.enumerable || descriptor.get !== undefined || descriptor.set !== undefined) {
        throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "JSON properties must be enumerable data properties");
      }
      assertJsonValue(descriptor.value, seen, budget, depth + 1);
    }
  } finally {
    seen.delete(value);
  }
}

export function canonicalizeJson(value: unknown): string {
  assertJsonValue(value, new Set(), { nodes: 0 });
  const result = canonicalize(value);
  if (result === undefined) {
    throw new IntegrityError("VES_INTEGRITY_NON_JSON_VALUE", "Value has no JSON representation");
  }
  return result;
}

export function sha256Digest(value: unknown): string {
  return createHash("sha256").update(canonicalizeJson(value), "utf8").digest("hex");
}

export type EvidenceCanonicalizationVersion = 1 | 2;

export function canonicalizeJsonForVersion(version: EvidenceCanonicalizationVersion, value: unknown): string {
  return version === 1 ? canonicalizeJson(value) : canonicalizeJsonV2(value);
}

export function sha256DigestForVersion(version: EvidenceCanonicalizationVersion, value: unknown): string {
  return createHash("sha256").update(canonicalizeJsonForVersion(version, value), "utf8").digest("hex");
}
