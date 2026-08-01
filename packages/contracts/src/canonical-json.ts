export const CANONICAL_JSON_V2 = "v2" as const;

export type CanonicalJsonVersion = "v1" | "v2";

const V2_PREFIX = "v2:sha256:";
const V1_PREFIX = "sha256:";

export function parseCanonicalJsonVersion(identity: string): CanonicalJsonVersion {
  if (identity.startsWith(V2_PREFIX)) return "v2";
  if (identity.startsWith(V1_PREFIX)) return "v1";
  throw new Error(`Unrecognized canonical JSON identity: ${identity}`);
}
