// Lets a domain declare that a collection is a set, ordering it by UTF-16
// code unit before encoding — the explicit replacement for V1's implicit
// array sort. `canonicalizeJsonV2` never sorts arrays on its own (design.md);
// a caller that means set semantics must normalize here first.

// invariant: the one string order the repository sorts by — UTF-16 code unit,
// exactly what `Array.prototype.sort()` does with no comparator, and never
// `localeCompare`, whose result depends on the ambient locale and collation
// (AD-015, issue #58). Passing it explicitly keeps every sort's bytes identical
// while stating the order instead of relying on the default.
export function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeDeclaredSet<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((left, right) => codeUnitCompare(key(left), key(right)));
}
