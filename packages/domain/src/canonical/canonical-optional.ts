// V1's private serializers dropped `undefined` object members before encoding;
// `canonicalizeJsonV2` rejects them instead, because a value the encoder cannot
// represent is a caller mistake far more often than it is an intended absence.
//
// A migrating owner whose accepted inputs legitimately carry optional members
// declares that here rather than re-implementing the drop privately — three
// separate copies of this walk is the exact shape #58 exists to remove. The
// drop is deep and it is the only V1 leniency reproduced: a non-finite number,
// a function, a symbol, or a cycle still fails closed inside the encoder.

export function dropUndefinedMembers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUndefinedMembers);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, member]) => member !== undefined)
      .map(([key, member]) => [key, dropUndefinedMembers(member)])
  );
}
