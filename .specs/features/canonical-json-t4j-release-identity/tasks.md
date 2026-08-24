# Canonical JSON T4j Tasks

**Status: complete.** See `validation.md`. Single implementation pass
(direct swap across two tightly-coupled files in one package), no
sub-agents needed.

## T1 — Add `@verchestra/domain` dependency to `packages/distribution`

Explicitly approved (2026-08-23) before implementation. `pnpm install`,
`pnpm-lock.yaml` diff confirmed minimal (one new importer entry).

## T2 — Migrate `hermetic-bundle.ts`

Remove the private recursive `canonical()`; use `canonicalizeJsonV2` for the
release digest. Switch the `components` array sort from `.localeCompare(` to
unconditional code-unit comparison. No `schemaVersion` widening — direct
swap, per the fresh "no installed base" re-verification recorded in AD-026's
confirmation note.

## T3 — Migrate `transactional-activation.ts`

Remove the private recursive `canonical()`/`equal()` pair; `equal()` now
delegates to `canonicalizeJsonV2` directly.

## T4 — Tests, discrimination sensor, census, compatibility doc

Cross-locale determinism test with a mixed-case `componentId` fixture;
manual mutation + revert proving it actually discriminates; census
reclassification (`retained-v1-versioned` → `migrated-v2` for both files);
`canonical-json-locale-allowlist.test.mjs` ceilings tightened to 0;
"Completed vertical slice (T4j)" section appended to
`docs/canonical-json-compatibility.md`.

## Traceability

| Requirement ID | Task |
| --- | --- |
| CJ4J-01 | T2 |
| CJ4J-02 | T2, T4 |
| CJ4J-03 | T3 |
| CJ4J-04 | T4 |
| CJ4J-05 | T1 |

Coverage: 5/5 mapped.
