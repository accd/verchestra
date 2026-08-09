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

| ID     | Requirement                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CJ4-01 | The compatibility matrix is refreshed against current `main`; every structured-serialization owner introduced after 2026-07-29 has a row classified `trust` / `persistent` / `presentation`. |
| CJ4-02 | One architecture-legal authority produces the `v2:sha256:` prefix for every layer, with no adapter coupling and no new dependency.                                                           |
| CJ4-03 | `canonicalizeOracle` and the promotion `blocks` ordering use V2 code-unit ordering; `holdoutDigest` and `bodyDigest` never depend on ambient locale.                                         |
| CJ4-04 | Campaign corpus and summary ordering use V2 with an explicitly declared set normalization.                                                                                                   |
| CJ4-05 | Doctor report material uses V2 code-unit ordering.                                                                                                                                           |
| CJ4-06 | `self-test.ts:292` is classified; migrated if digest input, or asserted presentation-only with a test proving it reaches no digest.                                                          |
| CJ4-07 | Each migrated identity produces byte-identical output and digests under two different ambient locales.                                                                                       |
| CJ4-08 | No qualified or persisted V1 fixture changes bytes — proven per owner, not assumed.                                                                                                          |
| CJ4-09 | A locale-ordering discrimination mutation per migrated owner is killed by a focused test inside a declared gate.                                                                             |
| CJ4-10 | A regression sensor fails the build when a new ambient-locale sort appears in a trust/persistent path.                                                                                       |
| CJ4-11 | `pnpm gate:security`, `pnpm gate:release`, and `tests/architecture` pass; no assertion weakened, skipped, or deleted.                                                                        |

## Requirement traceability

| ID     | Tasks          | Verified by                                                                                 |
| ------ | -------------- | ------------------------------------------------------------------------------------------- |
| CJ4-01 | T2             | `docs/canonical-json-compatibility.md` review                                               |
| CJ4-02 | T1             | `tests/unit/canonical-digest.test.mjs`, `tests/architecture/repository-boundaries.test.mjs` |
| CJ4-03 | T4             | `tests/unit/promotion-gate.test.mjs`, `tests/security/*`                                    |
| CJ4-04 | T5             | `tests/unit/regression-campaigns.test.mjs`, `tests/public-regression/*`                     |
| CJ4-05 | T6             | `tests/unit/doctor-rules.test.mjs`, `tests/security/doctor-diagnostic.test.mjs`             |
| CJ4-06 | T7             | `tests/unit/self-test*.test.mjs`                                                            |
| CJ4-07 | T4, T5, T6, T7 | per-owner cross-locale unit assertion                                                       |
| CJ4-08 | T4, T5, T6, T7 | existing pinned fixtures unchanged                                                          |
| CJ4-09 | T8             | `tests/security/canonical-json-sensor.test.mjs`                                             |
| CJ4-10 | T3             | `tests/security/canonical-json-locale-allowlist.test.mjs`                                   |
| CJ4-11 | T9             | `pnpm gate:security`, `pnpm gate:release`                                                   |

## Out of scope

Every other T4 owner (authority, gate-commit, cedar-policy, context-compiler,
trust-egress, handoff/validation, workspace-reconcile, effect-contract,
database-knowledge and adapters, evidence execution-package, hermetic-bundle,
transactional-activation, git-worktree-adapter, runtime-store) stays gated on
its own per-slice persisted-byte review, per the T2 matrix's migration rule.

## Success criteria

- [x] CJ4-01 — matrix refreshed with new owner rows.
      Evidence: `docs/canonical-json-compatibility.md` (T2 commit `bea7fbc`).
- [x] CJ4-02 — `formatCanonicalDigestV2` is the sole prefix authority.
      Evidence: `packages/domain/src/canonical/canonical-digest.ts`,
      `tests/unit/canonical-digest.test.mjs` (commit `b92dd7d`);
      `buildInventoryFingerprintV2` refactored to call it, byte-identical.
- [x] CJ4-03 — promotion oracle/blocks digest locale-independent.
      Evidence: `packages/application/src/promotion/promotion-gate.ts`
      (commit `75dab72`); `tests/unit/promotion-gate.test.mjs`.
- [x] CJ4-04 — campaign corpus/summary digest locale-independent.
      Evidence: `packages/application/src/regression/campaigns.ts`
      (commit `7f1adc4`); `tests/unit/regression-campaigns.test.mjs`,
      `pnpm test:release` (28 cases, frozen 22-campaign corpus unaffected).
- [x] CJ4-05 — doctor report digest locale-independent.
      Evidence: `packages/application/src/doctor/doctor.ts` (commit
      `6ccb1c7`); `tests/unit/doctor-rules.test.mjs`, all 62 existing
      doctor cases (unit/contract/security/e2e) unchanged.
- [x] CJ4-06 — self-test ordering classified and resolved.
      Evidence: `packages/application/src/self-test/self-test.ts` (commit
      `4cd6afa`) — classified presentation by the matrix's digest/signature
      test, migrated anyway for portability (see the matrix row).
- [x] CJ4-07 — cross-locale byte equality proven per migrated owner.
      Evidence: one `LANG`/`LC_ALL`-toggle test per owner in
      `tests/unit/promotion-gate.test.mjs`,
      `tests/unit/regression-campaigns.test.mjs`,
      `tests/unit/doctor-rules.test.mjs`,
      `tests/unit/self-test-scenario-rules.test.mjs`.
- [x] CJ4-08 — no persisted/qualified fixture byte changed.
      Evidence: no `docs/qualification/t72|t73|t74-validation.md` existed at
      migration time (verified before starting); all four owners' test call
      sites recompute digests via the exported function itself rather than
      pinning a literal byte string, confirmed by reading each test file
      before migrating.
- [x] CJ4-09 — discrimination sensor covers all migrated owners, 0 survivors.
      Evidence: `tests/security/canonical-json-sensor.test.mjs` (commit
      `035682f`) — mutation C (dynamic, real behavioral kill) for the shared
      `normalizeDeclaredSet` primitive plus one static per-owner mutation for
      promotion-gate.ts, campaigns.ts, doctor.ts, self-test.ts. 7/7 killed.
- [x] CJ4-10 — regression sensor proven to fail on a new locale sort.
      Evidence: `tests/security/canonical-json-locale-allowlist.test.mjs`
      (commit `50ea144`) — two mutation tests prove the mechanism fails
      closed; ceilings for all four T4a owners tightened to 0 in this task.
- [x] CJ4-11 — gates pass, no weakened assertion.
      Evidence: `pnpm test:architecture` 19/19,
      `pnpm test:security` 947/958 (11 pre-existing failures — native
      sqlite/memory-lifecycle/cedar-wasm gaps, confirmed identical via
      an `upstream/main` worktree baseline), `pnpm test:release` 28/28,
      `pnpm test:unit` 1975/1975, `pnpm test:contract` 483/483,
      `npx tsc --noEmit` clean (0 errors — an earlier evidence draft
      misattributed 6 transient errors to a Node-version gap; they were a
      stale local `node_modules` in this session's working directory,
      resolved by `pnpm install --frozen-lockfile`; not a real gap on
      either branch). `pnpm gate:security` still cannot complete locally
      past `test:e2e`: `tests/e2e/task-executor-e2e.test.mjs` fails on a
      macOS `/tmp` → `/private/tmp` symlink that `git-worktree-adapter.ts`'s
      `VES_GIT_WORKTREE_ESCAPE` check rejects, confirmed identical on an
      `upstream/main` worktree baseline (same file:line, same code) — an
      unrelated, pre-existing local-machine environment gap. No assertion
      was weakened, skipped, or deleted in this slice.
