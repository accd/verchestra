// invariant: the memory tables are STRICT, so a nullable TEXT column reads back
// as a string or NULL. Anything else means that invariant broke, and the read
// fails closed with the caller's corruption error instead of rendering an
// object or a byte list as text.
export function nullableText(value: unknown, corrupt: () => Error): string | null {
  if (value === null || typeof value === "string") return value;
  throw corrupt();
}
