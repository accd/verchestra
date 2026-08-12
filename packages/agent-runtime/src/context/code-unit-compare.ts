// Code-unit comparison, not localeCompare: shared by every sort in this
// package that has functional consequences beyond digest input order --
// selector, fragment, and rank ordering feed downstream consumers and the
// greedy budget-inclusion loop directly, not just how a value is serialized
// (AD-015, issue #58).
export function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
