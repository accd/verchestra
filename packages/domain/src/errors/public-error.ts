import { Digest } from "../primitives/digest.ts";
import { DomainValueError } from "../primitives/errors.ts";

export const ERROR_CATEGORIES = [
  "validation",
  "policy",
  "state",
  "conflict",
  "external",
  "integrity",
  "security",
  "internal"
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const RETRYABILITY_CLASSES = ["never", "after-change", "safe", "reconcile-first"] as const;
export type Retryability = (typeof RETRYABILITY_CLASSES)[number];
export type SafeDetailType = "string" | "number" | "boolean";
export type SafeDetailValue = string | number | boolean;

export interface PublicErrorDefinition {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly component: string;
  readonly retryability: Retryability;
  readonly recovery: string;
  readonly documentationVersion: string;
  readonly safeDetails: Readonly<Record<string, SafeDetailType>>;
}

export interface PublicErrorEnvelope {
  readonly schemaVersion: "1";
  readonly code: string;
  readonly category: ErrorCategory;
  readonly component: string;
  readonly retryability: Retryability;
  readonly recovery: string;
  readonly safeDetails: Readonly<Record<string, SafeDetailValue>>;
  readonly documentationVersion: string;
  readonly evidenceRef?: string;
  readonly causeChainDigest?: string;
}

interface PublicErrorContext {
  readonly evidenceRef?: string;
  readonly causeChainDigest?: Digest;
}

const CODE_PATTERN = /^VES_[A-Z0-9_]+$/u;
const COMPONENT_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const SENSITIVE_KEY_PATTERN = /(secret|password|passwd|token|credential|authorization|cookie|privatekey)/iu;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_SAFE_STRING_LENGTH = 1_024;

function invalidDefinition(message: string): never {
  throw new DomainValueError("VES_ERROR_DEFINITION_INVALID", message);
}

function validateDefinition(definition: PublicErrorDefinition): PublicErrorDefinition {
  const detailEntries = Object.entries(definition.safeDetails);
  if (
    !CODE_PATTERN.test(definition.code) ||
    !ERROR_CATEGORIES.includes(definition.category) ||
    !COMPONENT_PATTERN.test(definition.component) ||
    !RETRYABILITY_CLASSES.includes(definition.retryability) ||
    definition.recovery.trim().length === 0 ||
    definition.documentationVersion.trim().length === 0 ||
    detailEntries.some(
      ([key, type]) =>
        !DETAIL_KEY_PATTERN.test(key) ||
        SENSITIVE_KEY_PATTERN.test(key) ||
        !(["string", "number", "boolean"] as const).includes(type)
    )
  ) {
    invalidDefinition("Public error definition is malformed or unsafe");
  }
  return Object.freeze({
    ...definition,
    safeDetails: Object.freeze({ ...definition.safeDetails })
  });
}

function validateDetails(
  definition: PublicErrorDefinition,
  input: Readonly<Record<string, unknown>>
): Readonly<Record<string, SafeDetailValue>> {
  const expected = Object.keys(definition.safeDetails).sort();
  const actual = Object.keys(input).sort();
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    throw new DomainValueError("VES_ERROR_DETAILS_INVALID", "Safe detail fields do not match the registry");
  }

  const details: Record<string, SafeDetailValue> = {};
  for (const key of expected) {
    const value = input[key];
    const expectedType = definition.safeDetails[key];
    if (
      typeof value !== expectedType ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      (typeof value === "string" &&
        (value.length > MAX_SAFE_STRING_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)))
    ) {
      throw new DomainValueError("VES_ERROR_DETAILS_INVALID", `Safe detail ${key} is invalid`);
    }
    details[key] = value as SafeDetailValue;
  }
  return Object.freeze(details);
}

export class PublicErrorRegistry {
  readonly #definitions: ReadonlyMap<string, PublicErrorDefinition>;

  constructor(definitions: readonly PublicErrorDefinition[]) {
    const registry = new Map<string, PublicErrorDefinition>();
    for (const input of definitions) {
      const definition = validateDefinition(input);
      if (registry.has(definition.code)) invalidDefinition(`Duplicate error code ${definition.code}`);
      registry.set(definition.code, definition);
    }
    this.#definitions = registry;
  }

  get definitions(): readonly PublicErrorDefinition[] {
    return Object.freeze([...this.#definitions.values()]);
  }

  get codes(): readonly string[] {
    return Object.freeze([...this.#definitions.keys()].sort());
  }

  create(
    code: string,
    details: Readonly<Record<string, unknown>>,
    context: PublicErrorContext = {}
  ): PublicErrorEnvelope {
    const definition = this.#definitions.get(code);
    if (definition === undefined) {
      throw new DomainValueError("VES_ERROR_CODE_UNKNOWN", `Unknown public error code ${code}`);
    }
    if (context.evidenceRef !== undefined && !REFERENCE_PATTERN.test(context.evidenceRef)) {
      throw new DomainValueError("VES_ERROR_DETAILS_INVALID", "Evidence reference is invalid");
    }
    return Object.freeze({
      schemaVersion: "1",
      code: definition.code,
      category: definition.category,
      component: definition.component,
      retryability: definition.retryability,
      recovery: definition.recovery,
      safeDetails: validateDetails(definition, details),
      documentationVersion: definition.documentationVersion,
      ...(context.evidenceRef === undefined ? {} : { evidenceRef: context.evidenceRef }),
      ...(context.causeChainDigest === undefined ? {} : { causeChainDigest: context.causeChainDigest.hex })
    });
  }
}

export class PublicErrorException extends Error {
  readonly code: string;
  readonly envelope: PublicErrorEnvelope;

  constructor(envelope: PublicErrorEnvelope, privateMessage: string, options?: ErrorOptions) {
    super(privateMessage, options);
    this.name = "PublicErrorException";
    this.code = envelope.code;
    this.envelope = envelope;
  }

  toJSON(): PublicErrorEnvelope {
    return this.envelope;
  }
}
