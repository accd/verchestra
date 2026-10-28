# json-schema-to-typescript 16.0.0 validation

**Date:** 2026-10-28
**Diff:** branch `build/563-json-schema-to-typescript-16` over `main` `b5819c6`
**Verifier:** primary agent local verification on Windows x64, Node 24.14.0;
GitHub required checks remain authoritative

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| JST-01 | `package.json:75` pins `16.0.0`, moved with `pnpm add -E -w -D`. The lockfile moves `json-schema-to-typescript`, `@types/lodash` 4.17.24 → 4.17.27, adds `js-yaml@5.5.0` and its `argparse@3.0.4`, and drops `is-glob` from the generator's dependencies (the package stays for its other consumers). pnpm also re-resolved `legacy-javascript` 0.0.3 to 0.0.4; that hunk was reverted to keep one concern, and `pnpm install --frozen-lockfile` passes | PASS |
| JST-02 | `pnpm-workspace.yaml:13` scopes `json-schema-to-typescript>js-yaml: 5.5.0`; the global `js-yaml: 4.3.2` override stays for `@apidevtools/json-schema-ref-parser`, `@astrojs/starlight` and `@lhci/utils`. `tests/agent-readiness/dependency-policy.test.mjs:133` refuses any resolved `js-yaml` below 4.3.2 on the 4.x line or 5.4.1 on the 5.x line, and any other major | PASS |
| JST-03 | Changelog read (below). `node scripts/generate-contract-types.mjs --check` prints `generated contracts are current`: `packages/contracts/src/generated.ts` is byte-identical under 16.0.0, so no regeneration is needed. `tests/contract/schema-registry.test.mjs` asserts the same in `test:contract` | PASS |
| JST-04 | `.github/dependabot.yml:49-54` keeps the semver-major ignore with the restated reason; `dependency-policy.test.mjs:166-171` still asserts it | PASS |

## Changelog review

16.0.0 collects the fixes since 15.0.4. The ones that may change emitted
types: folded `patternProperties`, `allOf` members of unsupported keywords,
`properties` combined with `oneOf`/`anyOf`/`allOf`, dotted definition names,
nested `minItems`/`maxItems` caps, `type: null`, `unreachableDefinitions`,
`const` with `inferStringEnumKeysFromValues`, array `type` with `properties`,
empty `allOf` members, and inline `items` descriptions. The generator uses
none of the options these depend on beyond the defaults, and the drift check
proves that no current schema reaches a changed path. New features (OpenAPI
`nullable`, draft-3 `required: true`, named-anchor `$ref`) are not used by the
schemas under `schemas/`. Runtime dependencies moved to `js-yaml` 5 and
prettier `^3.9`. Its prettier resolves to the repository's own 3.9.6, which
`generate-contract-types.mjs` already used to format the whole output, so the
formatting change does not reach the file.

## Lockfile sensor

Three mutants of `pnpm-lock.yaml`, each restored after the run, fail the new
test with a message naming the version: `js-yaml@5.4.0` (inside
GHSA-r3ph-w7gj-g6xm), `js-yaml@4.3.1` (inside GHSA-2883-xcg3-v3hh), and
`js-yaml@3.14.1` (what `@lhci/utils` would resolve without the global
override).

## Gates

- `test:contract`: 981 of 981, 0 skipped, including the zero-drift test.
- `gate:quick`: PASS: `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit` 3169 of 3169, `test:agent-readiness` 402 of 402 (one more: the `js-yaml` sensor), `test:census` 13 of 13; 0 skipped.
- `agent:check`: PASS.

## External verification

Quality gate, Site quality and CodeQL must pass on the exact pushed head
before merge. No production-readiness claim is made.
