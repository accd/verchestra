export const packageName = "@verchestra/contracts" as const;
export { SchemaRegistry } from "./schema-registry.ts";
export { CANONICAL_JSON_V2, parseCanonicalJsonVersion, type CanonicalJsonVersion } from "./canonical-json.ts";
export type * from "./generated.ts";
