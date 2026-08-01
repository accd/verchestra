// Lets a domain declare that a collection is a set, ordering it by UTF-16
// code unit before encoding — the explicit replacement for V1's implicit
// array sort. `canonicalizeJsonV2` never sorts arrays on its own (design.md);
// a caller that means set semantics must normalize here first.

export function normalizeDeclaredSet<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
}
