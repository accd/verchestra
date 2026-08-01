// RFC 8785 (JSON Canonicalization Scheme, JCS) encoder.
//
// Encode-only: hashing stays in packages/workspace (node:crypto is barred from
// domain). No third-party or node: imports (CJ-02).
//
// - Object members are ordered by UTF-16 code unit via the default
//   `Array.prototype.sort()` comparator (assumption A1).
// - Arrays are emitted in their given order — this encoder never sorts an
//   array; a caller that means a set must normalize it explicitly first.
// - Primitive emission (numbers, string escaping) is delegated to
//   `JSON.stringify`, which is already RFC 8785-conformant for finite values
//   (assumption A2).

function encodeString(value: string): string {
  return JSON.stringify(value);
}

function encodeNumber(value: number): string {
  return JSON.stringify(value);
}

function encodeArray(value: readonly unknown[]): string {
  return `[${value.map(encodeValue).join(",")}]`;
}

function encodeObject(value: Readonly<Record<string, unknown>>): string {
  const members = Object.keys(value)
    .sort()
    .map((key) => `${encodeString(key)}:${encodeValue(value[key])}`);
  return `{${members.join(",")}}`;
}

function encodeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return encodeNumber(value);
  if (typeof value === "string") return encodeString(value);
  if (Array.isArray(value)) return encodeArray(value);
  return encodeObject(value as Record<string, unknown>);
}

export function canonicalizeJsonV2(value: unknown): string {
  return encodeValue(value);
}
