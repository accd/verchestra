# Probe Value Declassification Tasks

**Status:** Approved

## Test Coverage Matrix

| Layer | Test type | Coverage | Command |
| --- | --- | --- | --- |
| Probe claim normalization | Integration | Closed output and deterministic digest | `pnpm test:integration` |
| Probe promotion security | Security | Email, secret, credential, token, connection string, forged digest | `pnpm test:security` |
| Repository qualification | Gate | No skips; architecture and security regressions | `pnpm gate:security` |

## Execution Plan

1. **T1:** Replace portable raw claim values with `valueDigest` and add focused
   integration/security coverage. Requirements: PVD-01–03. **Ready for human
   review:** focused tests pass 44/44 and `pnpm gate:security` passes on the
   corrected CodeQL-safe head.
2. **T2:** Update #34's parser/reference design after this representation is
   merged. Requirement: PVD-04.
3. **T3:** Record qualified evidence and handoff. Requirements: PVD-01–04.

## Validation

| Check | Result |
| --- | --- |
| Atomicity | Pass — T1 is one normalization change with its tests. |
| Test co-location | Pass — source and both test layers change together. |
| Dependency | T2 depends on T1; #34 remains blocked until T2. |
