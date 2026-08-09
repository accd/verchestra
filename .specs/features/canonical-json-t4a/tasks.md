# Canonical JSON T4a Tasks

**Design**: inline (Medium-complexity slice; no new architecture — reuses the
T3 `packages/domain/src/canonical/*` primitives per `AD-009`)
**Status**: In Progress

## Test Coverage Matrix

> Generated from codebase and `docs/canonical-json-compatibility.md` §"Required proof for each migration PR".

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domain primitive | unit | All branches; prefix validation | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Application rules (promotion, campaigns, doctor, self-test) | unit | 1:1 to CJ4 ACs + cross-locale equality | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Security sensors | security | One killed mutation per migrated owner | `tests/security/*.test.mjs` | `pnpm test:security` |
| Release corpus | release | Corpus digest stability | `tests/public-regression/`, `tests/system/` | `pnpm test:release` |
| Docs / matrix | none | build gate only | — | build gate only |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Unit-only tasks | `pnpm gate:quick` |
| Security | Trust-digest or sensor tasks | `pnpm gate:security` |
| Release | Campaign-corpus tasks | `pnpm gate:release` |
| Build | Docs-only tasks | `pnpm gate:build` |

## Execution Plan

### Phase 0: Foundation
```
T1
T2 -> T3
```

### Phase 1: Slice A migrations
```
T1 -> T4
T1 -> T5
T1 -> T6
T2 -> T7
T4, T5, T6, T7 -> T8
T3, T8 -> T9
```

## Task Breakdown

### T1: Add `formatCanonicalDigestV2` to domain
**What**: Sole authority for the `v2:sha256:` digest prefix.
**Where**: `packages/domain/src/canonical/canonical-digest.ts` (new)
**Depends on**: None
**Requirement**: CJ4-02
**Tests**: unit — **Gate**: quick
**Commit**: `feat(domain): add the shared v2 canonical digest formatter`

### T2: Refresh the compatibility matrix
**What**: Add classified rows for owners introduced after T2.
**Where**: `docs/canonical-json-compatibility.md`
**Depends on**: None
**Requirement**: CJ4-01
**Tests**: none — **Gate**: build
**Commit**: `docs(canonical-json): refresh the T4 inventory against current main`

### T3: Add the ambient-locale regression sensor
**What**: Fail the build on a new `localeCompare` in a trust/persistent path.
**Where**: `tests/security/canonical-json-locale-allowlist.test.mjs` (new)
**Depends on**: T2
**Requirement**: CJ4-10
**Tests**: security — **Gate**: security
**Commit**: `test(security): fail closed on a new ambient-locale sort in a trust path`

### T4: Migrate `promotion-gate.ts` to V2
**Where**: `packages/application/src/promotion/promotion-gate.ts`
**Depends on**: T1
**Requirement**: CJ4-03, CJ4-07
**Tests**: unit + security — **Gate**: security
**Commit**: `fix(promotion): seal the holdout oracle with V2 canonical JSON`

### T5: Migrate `campaigns.ts` to V2
**Where**: `packages/application/src/regression/campaigns.ts`
**Depends on**: T1
**Requirement**: CJ4-04, CJ4-07
**Tests**: unit + release — **Gate**: release
**Commit**: `fix(campaigns): order the campaign corpus by code unit`

### T6: Migrate `doctor.ts` to V2
**Where**: `packages/application/src/doctor/doctor.ts`
**Depends on**: T1
**Requirement**: CJ4-05, CJ4-07
**Tests**: unit + security — **Gate**: security
**Commit**: `fix(doctor): order signed report material by code unit`

### T7: Classify and resolve `self-test.ts` ordering
**Where**: `packages/application/src/self-test/self-test.ts`
**Depends on**: T2
**Requirement**: CJ4-06
**Tests**: unit — **Gate**: quick
**Commit**: `fix(self-test): classify the check-summary ordering against the V2 contract`

### T8: Extend the discrimination sensor to slice A
**Where**: `tests/security/canonical-json-sensor.test.mjs`
**Depends on**: T4, T5, T6, T7
**Requirement**: CJ4-09
**Tests**: security — **Gate**: security
**Commit**: `test(security): kill locale-ordering mutations across the T4a owners`

### T9: Record T4a evidence and close the slice
**Where**: `docs/canonical-json-compatibility.md`, `.specs/features/canonical-json-t4a/spec.md`, `handoff.md`
**Depends on**: T3, T8
**Requirement**: CJ4-11
**Tests**: none — **Gate**: build (then full security+release confirm)
**Commit**: `docs(canonical-json): record the T4a slice evidence`
