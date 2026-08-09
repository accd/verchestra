# Canonical JSON T4a — unqualified chain digests

Issue: #58 (T4 slice)

## Scope

T4 is the remaining ~15 owners in `docs/canonical-json-compatibility.md`. This
slice, T4a, covers only the owners introduced **after** the T2 matrix
(2026-07-29) that were merged by T72/T73/T74 (2026-08-07) and are not yet
qualification-report bytes: `promotion-gate.ts`, `campaigns.ts`, `doctor.ts`,
and the `self-test.ts` check-summary ordering. No `docs/qualification/t72-`,
`t73-`, or `t74-validation.md` exists yet, so these digests have never been
frozen — migrating now costs zero backward-compatibility work. That window
closes once those qualification reports land, which is why this slice is
sequenced first among the ~10 remaining T4 slices.

## Inventory correction

`docs/canonical-json-compatibility.md` predates T72–T74 and does not list
these owners. T2 of this slice refreshes the matrix with their classification
before any code changes.

## Requirements

| ID | Requirement |
| --- | --- |
| CJ4-01 | The compatibility matrix is refreshed against current `main`; every structured-serialization owner introduced after 2026-07-29 has a row classified `trust` / `persistent` / `presentation`. |
| CJ4-02 | One architecture-legal authority produces the `v2:sha256:` prefix for every layer, with no adapter coupling and no new dependency. |
| CJ4-03 | `canonicalizeOracle` and the promotion `blocks` ordering use V2 code-unit ordering; `holdoutDigest` and `bodyDigest` never depend on ambient locale. |
| CJ4-04 | Campaign corpus and summary ordering use V2 with an explicitly declared set normalization. |
| CJ4-05 | Doctor report material uses V2 code-unit ordering. |
| CJ4-06 | `self-test.ts:292` is classified; migrated if digest input, or asserted presentation-only with a test proving it reaches no digest. |
| CJ4-07 | Each migrated identity produces byte-identical output and digests under two different ambient locales. |
| CJ4-08 | No qualified or persisted V1 fixture changes bytes — proven per owner, not assumed. |
| CJ4-09 | A locale-ordering discrimination mutation per migrated owner is killed by a focused test inside a declared gate. |
| CJ4-10 | A regression sensor fails the build when a new ambient-locale sort appears in a trust/persistent path. |
| CJ4-11 | `pnpm gate:security`, `pnpm gate:release`, and `tests/architecture` pass; no assertion weakened, skipped, or deleted. |

## Requirement traceability

| ID | Tasks | Verified by |
| --- | --- | --- |
| CJ4-01 | T2 | `docs/canonical-json-compatibility.md` review |
| CJ4-02 | T1 | `tests/unit/canonical-digest.test.mjs`, `tests/architecture/repository-boundaries.test.mjs` |
| CJ4-03 | T4 | `tests/unit/promotion-gate.test.mjs`, `tests/security/*` |
| CJ4-04 | T5 | `tests/unit/regression-campaigns.test.mjs`, `tests/public-regression/*` |
| CJ4-05 | T6 | `tests/unit/doctor-rules.test.mjs`, `tests/security/doctor-diagnostic.test.mjs` |
| CJ4-06 | T7 | `tests/unit/self-test*.test.mjs` |
| CJ4-07 | T4, T5, T6, T7 | per-owner cross-locale unit assertion |
| CJ4-08 | T4, T5, T6, T7 | existing pinned fixtures unchanged |
| CJ4-09 | T8 | `tests/security/canonical-json-sensor.test.mjs` |
| CJ4-10 | T3 | `tests/security/canonical-json-locale-allowlist.test.mjs` |
| CJ4-11 | T9 | `pnpm gate:security`, `pnpm gate:release` |

## Out of scope

Every other T4 owner (authority, gate-commit, cedar-policy, context-compiler,
trust-egress, handoff/validation, workspace-reconcile, effect-contract,
database-knowledge and adapters, evidence execution-package, hermetic-bundle,
transactional-activation, git-worktree-adapter, runtime-store) stays gated on
its own per-slice persisted-byte review, per the T2 matrix's migration rule.

## Success criteria

- [ ] CJ4-01 — matrix refreshed with new owner rows.
- [ ] CJ4-02 — `formatCanonicalDigestV2` is the sole prefix authority.
- [ ] CJ4-03 — promotion oracle/blocks digest locale-independent.
- [ ] CJ4-04 — campaign corpus/summary digest locale-independent.
- [ ] CJ4-05 — doctor report digest locale-independent.
- [ ] CJ4-06 — self-test ordering classified and resolved.
- [ ] CJ4-07 — cross-locale byte equality proven per migrated owner.
- [ ] CJ4-08 — no persisted/qualified fixture byte changed.
- [ ] CJ4-09 — discrimination sensor covers all migrated owners, 0 survivors.
- [ ] CJ4-10 — regression sensor proven to fail on a new locale sort.
- [ ] CJ4-11 — gates pass, no weakened assertion.
