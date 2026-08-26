// Build input for the T76 candidate builder: the module esbuild substitutes
// for `node:sqlite` (via its alias option) when bundling the sealed launchers.
// Never imported by any repository source at development time.
//
// Why it exists: esbuild hoists every external import of an ESM bundle to the
// output's top level, so the product's `import ... from "node:sqlite"`
// statements - all of them inside modules the CLI only ever reaches through
// dynamic import (packages/platform-node/src/readonly.ts documents that
// discipline) - would load SQLite eagerly on every sealed invocation and print
// Node's experimental-feature warning to stderr. The activation health gate
// (packages/platform-node/src/activation-launcher-adapters.ts) folds stderr
// into the same buffer it JSON-parses, so that warning alone would fail every
// sealed activation. This shim restores the repository's own laziness: it is
// bundled as an ordinary internal module, its body only executes when a module
// that genuinely uses SQLite first executes, and it resolves nothing but the
// built-in - so SQLite loads at exactly the moment it loads in development.
import { createRequire } from "node:module";

interface NodeSqliteModule {
  readonly DatabaseSync: unknown;
  readonly backup: unknown;
  readonly constants: unknown;
}

const sqlite = createRequire(import.meta.url)("node:sqlite") as NodeSqliteModule;

export const DatabaseSync = sqlite.DatabaseSync;
export const backup = sqlite.backup;
export const constants = sqlite.constants;
