import { createHash } from "node:crypto";

import { canonicalizeJsonV2 } from "@verchestra/domain";

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJsonV2(value)).digest("hex")}`;
}

// Code-unit comparison, not localeCompare: shared by every sort in this
// package with functional consequences beyond digest input order -- entity,
// source, fact, and registration ordering feed the returned shape, not just
// how a value is serialized (AD-015, issue #58).
export function codeUnitCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
