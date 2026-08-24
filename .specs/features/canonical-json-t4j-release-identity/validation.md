# Canonical JSON T4j Validation

**Verdict: PASS**

Standalone verification pass (no sub-agent split; ≤8-task inline-execution
threshold). Author and verifier are the same session — flagged explicitly,
same as T4i's validation.

## Spec-anchored outcome check

| Requirement | Test | Asserted outcome matches spec-defined AC? |
| --- | --- | --- |
| CJ4J-01 | Typecheck + `tests/build/hermetic-bundle.test.mjs` (23/23 pass) | Yes — `canonicalizeJsonV2` import used directly in `buildHermeticDistributionBundle`. |
| CJ4J-02 | "release digest is byte-identical across two divergent locale collations, for a mixed-case componentId set" asserts `driverIds` equals `["driver:Claude"]` specifically (code-unit order, not merely "a" deterministic order) | Yes. |
| CJ4J-03 | Typecheck + `tests/integration/transactional-activation.test.mjs`, `tests/security/transactional-activation-security.test.mjs`, `tests/fault-injection/transactional-activation-faults.test.mjs` (all pass unchanged) | Yes — `equal()` now delegates to `canonicalizeJsonV2`; no test needed rewriting, confirming the swap is behavior-preserving for same-tick comparisons. |
| CJ4J-04 | Same cross-locale test as CJ4J-02 | Yes. |
| CJ4J-05 | `pnpm-lock.yaml` diff shows exactly one new entry (`packages/distribution` → `@verchestra/domain`, `workspace:0.0.0`), explicitly approved via AskUserQuestion before implementation | Yes. |

## Discrimination sensor

Manual mutation: reverted `hermetic-bundle.ts`'s `components` sort comparator
to `.localeCompare(`, confirmed "release digest is byte-identical across two
divergent locale collations..." fails (digest mismatch:
`1dc481de...` vs `e699b4c6...`), reverted, confirmed 23/23 pass again.
`tests/security/canonical-json-locale-allowlist.test.mjs`'s own mutation
tests independently prove a new `.localeCompare(` anywhere in `packages/*/src`
is caught; both T4j files' ceilings tightened to 0 there.

Ran full `pnpm gate:full` (all ten stages PASS), `pnpm test:security`
(1074/1074), `pnpm test:architecture` (39/39, including the dependency
boundary tests confirming `@verchestra/domain` is a valid inward import for
the `distribution` adapter). `tests/security/canonical-json-census.test.mjs`
10/10 PASS after reclassifying both files to `migrated-v2`.

## Deviations from the original spec

1. **Corrected the compatibility doc's own classification**, not merely
   implemented against it: the doc (as landed by an independent contributor
   after AD-026 was first written) classified T4j as needing the full
   versioned-facade treatment. Re-verified fresh rather than trusting either
   the old AD-026 or the newer doc classification — found AD-026's original
   premise (`releaseDigest: null`, no installed base) still holds, and
   implemented the simpler direct swap. Recorded as a confirmation
   appended to AD-026, not a silent rewrite.
2. No `schemaVersion` widening, unlike T4i — this vertical's verification
   fully recomputes from content every time (no persisted-and-re-derived
   field like T4i's `pendingTasks`), so there is nothing for a version field
   to gate.

## Lessons

None distilled — no surviving mutant, no failed AC, no spec-precision gap.
The classification correction (deviation 1) was caught and resolved within
this same implementation pass, before any test was reported green against a
wrong assumption.
