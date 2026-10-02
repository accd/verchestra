// invariant: longer values are replaced first, so a sensitive value that
// contains another is never left partly readable.
export function sensitiveValueRedactor(values: readonly string[]): (value: unknown) => string {
  const secrets = [...new Set(values.filter((value) => value.length > 0))].sort(
    (left, right) => right.length - left.length
  );
  return (value) => secrets.reduce((safe, secret) => safe.replaceAll(secret, "[REDACTED]"), String(value));
}
