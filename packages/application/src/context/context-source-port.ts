import type { DataClassificationValue } from "@verchestra/domain";

export type ContextSourceKind = "repository" | "tracker" | "knowledge" | "memory";

export interface ContextClaimInput {
  readonly factKey: string;
  readonly value: string;
}

export interface ContextFragmentInput {
  readonly fragmentId: string;
  readonly content: string;
  readonly classification: DataClassificationValue;
  readonly trust: "verified-evidence" | "untrusted-data";
  readonly claims?: readonly ContextClaimInput[];
}

export interface ContextSourceObservation {
  readonly source: { readonly kind: string; readonly identity: string; readonly revision: string };
  readonly retrievedAt: string;
  readonly scope: string;
  readonly fragments: readonly ContextFragmentInput[];
}

export interface ContextSourceQuery {
  readonly workspaceId: string;
  readonly selectorId: string;
  readonly sourceKind: ContextSourceKind;
  readonly sourceId: string;
  readonly query: Readonly<Record<string, unknown>>;
  readonly expectedRevision?: string;
}

export interface ContextSourcePort {
  resolve(query: ContextSourceQuery): Promise<ContextSourceObservation | undefined>;
}
