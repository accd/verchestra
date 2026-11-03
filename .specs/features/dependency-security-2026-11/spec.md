# Dependency security, November 2026

## Problem

On 2026-11-01 `pnpm audit` on `main` (`6a90d021`) reported three advisories.
Dependabot kept only the `minimatch` one open (alert #72). It scoped the other two
as development and auto-dismissed them (#65, #59):

| Package                      | Severity | Advisory            | Reaches                                                                                                                                                               | Patched     |
| ---------------------------- | -------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `body-parser` 2.3.0          | high     | GHSA-27r3-jxmh-p828 | `express` 5.2.1 under `@modelcontextprotocol/sdk`, a `dependencies` entry of `@verchestra/agent-runtime`, and under the Pi SDK's `@google/genai` (root devDependency) | 2.4.0       |
| `ip-address` 10.7.2          | moderate | GHSA-rxp7-6hxx-x8q5 | `express-rate-limit` 8.7.0 under the same MCP SDK, and `socks` 2.8.9 in the site's dev tooling                                                                        | 10.7.4      |
| `minimatch` 10.2.6 and 3.1.5 | moderate | GHSA-g3hv-75wg-m249 | `@tufjs/models` 4.1.1 (production), `eslint`, `@eslint/config-array`, `@typescript-eslint/typescript-estree`, and `glob` 7 under `@lhci/cli`                          | 11.0.1 only |

The installed tree of `@verchestra/agent-runtime` contains `body-parser` 2.x and
`ip-address`, but no sealed launcher does. The esbuild metafiles of every
`SEALED_BUNDLE_ENTRIES` component at `6a90d021` contain 18 MCP SDK modules, all
on its client path: `client/*`, `shared/*`, `experimental/tasks/*`, `types.js`,
`validation/ajv-provider.js`, and three `server/` helpers (`zod-compat.js`,
`zod-json-schema-compat.js` and `auth/errors.js`). They contain no file of
`express`, `body-parser`, `express-rate-limit`, `ip-address` or `socks`. No shipped artifact runs either
package, so the fix keeps `pnpm audit` clean for the workspace, as DSB-02 of
`dependency-security-2026-09` requires.

## Requirements

- **DSN-01**: Each new override SHALL be an exact version inside every parent's
  declared range (DSB-03):
  - `body-parser@2: 2.4.0` is inside `express` 5.2.1 `^2.2.1`;
  - `ip-address: 10.7.5` is inside `express-rate-limit` 8.7.0 `^10.2.0` and
    `socks` 2.8.9 `^10.1.1`.

  Both versions are older than the three-day release age.

- **DSN-02**: `body-parser` 2.x SHALL resolve to 2.4.0 or later and `ip-address`
  to 10.7.4 or later, as asserted by
  `tests/agent-readiness/dependency-policy.test.mjs`.
- **DSN-03**: No other package SHALL change in `pnpm-lock.yaml`. Re-resolution
  also moves `legacy-javascript` 0.0.3 → 0.0.4 (Lighthouse data); that hunk is
  reverted.
- **DSN-04**: `minimatch` SHALL NOT be overridden: its fix exists only in 11.x,
  outside every parent's declared range, and its vulnerable code is unreachable
  here (next section).
- **DSN-05**: `pnpm gate:quick` SHALL pass. No assertion, threshold or workflow
  changes.

## minimatch, GHSA-g3hv-75wg-m249

The amplification lives in `firstPhasePreProcess()` and
`secondPhasePreProcess()`. `Minimatch#preprocess` calls them only when
`optimizationLevel >= 2`; the default is 1 (`minimatch` 10.2.6
`dist/commonjs/index.js`). No dependent sets that option:

| Dependent                                       | Call                                 | Options                                                                                                                  |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@tufjs/models` 4.1.1 (`isTargetInPathPattern`) | `minimatch(targetPart, patternPart)` | none; it also splits path and pattern on `/` first, so one call never sees the `**/../` sequence the amplification needs |
| `@eslint/config-array` 0.23.5                   | `new Minimatch(pattern, …)`          | `{ dot: true }`, plus `flipNegate`                                                                                       |
| `eslint` 10.11.0                                | `new Minimatch(pattern, …)`          | `{ dot: true }`                                                                                                          |
| `@typescript-eslint/typescript-estree` 8.67.0   | `minimatch(filePath, pattern, …)`    | `{ dot: true }`                                                                                                          |
| `glob` 7.2.3                                    | `minimatch` 3.1.5                    | 3.x has no `optimizationLevel` and no preprocessing phases                                                               |

The production path has a further barrier: delegation patterns come from
signed TUF metadata, and the delegation this repository publishes lists literal
paths only (`packages/distribution/src/tuf-publication.ts`, the `components`
role).

The fix cannot be forced:

- `minimatch` 11 is a rewrite. It removes `makeRe()`, `Minimatch#regexp`,
  `AST` and `matchOne()`, turns `Minimatch.set` items into `Matcher` objects,
  changes trailing-slash, extglob and Windows `..` matching, and adds the
  dependency `@isaacs/nonrecursive-glob-match`.
- Every parent declares `^10` or `^3`, including the latest
  `@tufjs/models` 5.0.1, `eslint` 10.14.0 and `typescript-estree` 8.72.1.
- `@lhci/cli` 0.15.1 still requires `chrome-launcher` `^0.13.4` → `rimraf` 3 →
  `glob` 7. `glob` 7 calls `e.match(pn)` on `Minimatch.set` items, so its copy
  cannot take 11.x.

**Revisit when:**

- a dependent moves to `minimatch` `^11` (Dependabot proposes it); or
- any dependent starts passing `optimizationLevel` 2.

## Scope

- `pnpm-workspace.yaml` overrides
- `pnpm-lock.yaml`
- `tests/agent-readiness/dependency-policy.test.mjs`

No sealed launcher's inputs change, because neither patched package is in the
closure.
