// Issue #58: a cross-locale test must show that a digest, identity, or
// decision ordering is a property of the values themselves, not of the
// machine's collation. Replacing String.prototype.localeCompare with a
// comparator that inverts UTF-16 code-unit order simulates a hostile or merely
// divergent locale without depending on any specific installed ICU locale
// actually disagreeing today (the same technique as
// tests/build/hermetic-bundle.test.mjs).
//
// Any surface that still consults ambient collation reorders under it; a
// migrated surface produces byte-identical output. The original is always
// restored, including when the callback throws.
export async function withHostileLocaleCompare(fn) {
  const original = String.prototype.localeCompare;
  String.prototype.localeCompare = function hostileLocaleCompare(other) {
    const left = String(this);
    return left < other ? 1 : left > other ? -1 : 0;
  };
  try {
    return await fn();
  } finally {
    String.prototype.localeCompare = original;
  }
}
