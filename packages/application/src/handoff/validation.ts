// Shared primitive types, deny lists, and generic validators used by every
// handoff normalizer. Nothing here knows about handoff structure.

import { fail, type HandoffErrorCode } from "./errors.ts";

export type Row = Record<string, unknown>;
export type Digest = `sha256:${string}`;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,511}$/u;
const ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}|file:|\/(?:home|Users|private|tmp|var)\/)/u;
const PROHIBITED = new Set([
  "provider",
  "providerId",
  "backend",
  "backendId",
  "model",
  "modelId",
  "session",
  "sessionId",
  "threadId",
  "transcript",
  "credential",
  "credentials",
  "secretValue",
  "token",
  "providerToken",
  "localPath",
  "absolutePath"
]);

export function exact<const Key extends string>(
  value: unknown,
  label: string,
  keys: readonly Key[],
  code: HandoffErrorCode
): Record<Key, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code, `${label} must be an object`);
  const row = value as Row;
  if (Object.keys(row).some((key) => !(keys as readonly string[]).includes(key)))
    fail(code, `${label} contains unknown fields`);
  return row as Record<Key, unknown>;
}

export function token(value: unknown, label: string, code: HandoffErrorCode): string {
  if (typeof value !== "string" || !SAFE.test(value)) fail(code, `${label} is invalid`);
  return value;
}

export function digest(value: unknown, label: string, code: HandoffErrorCode): Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) fail(code, `${label} is invalid`);
  return value as Digest;
}

export function integer(value: unknown, label: string, min: number, max: number, code: HandoffErrorCode): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max)
    fail(code, `${label} is invalid`);
  return value as number;
}

export function literal<T extends string>(
  value: unknown,
  label: string,
  values: readonly T[],
  code: HandoffErrorCode
): T {
  if (typeof value !== "string" || !values.includes(value as T)) fail(code, `${label} is invalid`);
  return value as T;
}

export function strings(value: unknown, label: string, code: HandoffErrorCode, allowEmpty = false): readonly string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 100)
    fail(code, `${label} is invalid`);
  const result = value.map((entry, index) => token(entry, `${label}[${index}]`, code));
  if (new Set(result).size !== result.length) fail(code, `${label} contains duplicates`);
  return Object.freeze(result);
}

export function freeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Row)) freeze(child, seen);
  return Object.freeze(value);
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Row)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function rejectPrivate(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (ABSOLUTE.test(value)) fail("VES_HANDOFF_PRIVATE_MATERIAL", "Handoff contains a machine-local path");
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("VES_HANDOFF_PRIVATE_MATERIAL", "Handoff input is cyclic");
  seen.add(value);
  for (const [key, entry] of Object.entries(value as Row)) {
    if (PROHIBITED.has(key)) fail("VES_HANDOFF_PRIVATE_MATERIAL", `Handoff field is prohibited: ${key}`);
    rejectPrivate(entry, seen);
  }
  seen.delete(value);
}
