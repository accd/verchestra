# Canonical JSON T4j — Release Identity Specification

## Problem Statement

`packages/distribution/src/hermetic-bundle.ts` and
`packages/distribution/src/transactional-activation.ts` each implement their
own private recursive `canonical(value)` serializer that sorts object keys
with `String.prototype.localeCompare`, instead of using the qualified V2
primitive (`canonicalizeJsonV2`, `packages/domain`). `hermetic-bundle.ts`
additionally sorts its `components` array by `componentId.localeCompare(...)`
before folding it into the release manifest that `canonical()` then digests.
Both are locale-dependent — the same defect class already migrated for
`authority.ts`/`work-claims.ts` (T4b) and `database-knowledge.ts` (T4h).

## Direct swap, not a versioned facade — verified fresh, not assumed

`docs/canonical-json-compatibility.md` currently classifies T4j as needing
the full versioned-facade treatment ("T4i and T4j do not clear that bar").
Re-verified directly rather than taken on faith, following the same
discipline T4i's implementation required:

- `resolveReleaseIdentity().releaseDigest` is still `null`
  (`apps/vestra-cli/src/release-manifest.ts`) — no release has ever shipped;
  T76 has not landed a candidate.
- No test or fixture anywhere pins a literal `releaseDigest` byte string;
  every assertion is `assert.match(bundle.releaseDigest, /^sha256:[a-f0-9]{64}$/u)`
  or an equivalent computed comparison (confirmed by search across
  `tests/build/hermetic-bundle.test.mjs`, `tests/security/hermetic-bundle-security.test.mjs`,
  `tests/integration/transactional-activation.test.mjs`,
  `tests/security/transactional-activation-security.test.mjs`,
  `tests/fault-injection/transactional-activation-faults.test.mjs`,
  `tests/e2e/tuf-update-client.test.mjs`, `tests/helpers/*.mjs`).
- `transactional-activation.ts`'s own `canonical()`/`equal()` is a same-tick
  in-memory equality check ("canonical launchers are not equivalent"), never
  compared against a value persisted from a previous run.

This is exactly the bar T4b already used for a direct swap ("pre-1.0 local
developer state with no installed base"), not the bar T4i actually needed
(T4i's own array-persisted, re-derived-and-compared `pendingTasks` field —
no equivalent exists here). No `schemaVersion` widening or dual-path
comparator is needed; `canonical()` is replaced outright with
`canonicalizeJsonV2`, and the `componentId` sort switches to code-unit
ordering unconditionally, matching T4b/T4h's own migrated shape.

## Goals

- [x] `hermetic-bundle.ts` and `transactional-activation.ts` use
      `canonicalizeJsonV2` instead of a local recursive serializer.
- [x] `hermetic-bundle.ts`'s `components` array sorts by code-unit order,
      never `localeCompare`.
- [x] Cross-locale output equality proven for a release manifest containing
      a mixed-case `componentId`.
- [x] `packages/distribution`'s new `@verchestra/domain` dependency is
      explicitly approved (2026-08-23) and reflected in `pnpm-lock.yaml`.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Versioned V1/V2 facade | Not needed — no installed base, verified fresh (see above). |
| `tuf-update-client.ts` | Classified separately in the census (no structured digest at write); not a T4 slice. |
| Any change to bundle/activation validation semantics beyond ordering | This is an ordering-determinism fix, not a schema or behavior change. |

## Requirement Traceability

| Requirement ID | Description | Status |
| --- | --- | --- |
| CJ4J-01 | `hermetic-bundle.ts` uses `canonicalizeJsonV2` | Verified |
| CJ4J-02 | `hermetic-bundle.ts`'s `components` sort is code-unit | Verified |
| CJ4J-03 | `transactional-activation.ts` uses `canonicalizeJsonV2` | Verified |
| CJ4J-04 | Cross-locale digest/output equality, mixed-case fixture | Verified |
| CJ4J-05 | Dependency addition explicitly approved, lockfile updated | Verified |

## Success Criteria

- [x] `pnpm gate:security` passes; no assertion weakened.
- [x] `docs/canonical-json-census.json` reclassifies both files to `migrated-v2`.
- [x] A discrimination sensor (manual mutation + revert) proves the
      cross-locale test actually fails when reverted.
