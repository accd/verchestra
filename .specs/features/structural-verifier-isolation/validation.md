# Structural Verifier Isolation Validation

Verdict: **PASS** — independent Verifier (author ≠ verifier), diff range
`a1e317f..bdc46d9`.

## Per-requirement evidence

| Req    | Verdict | Evidence                                                                                                                                   |
| ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| SVI-01 | PASS    | `assertIndependentVerifier` fails `VES_VERIFIER_DRIVER_CONFLICT` naming both ids                                                           |
| SVI-02 | PASS    | `resolveVerifierDriver` pure, excludes implementer, explicit `not-configured`, no fallback branch exists                                   |
| SVI-03 | PASS    | `assertReadOnlyGrant` fails closed on any nonempty grant                                                                                   |
| SVI-04 | PASS    | `assertNoToolRequests` proven against a real `DeterministicMockDriver` session, not a stub                                                 |
| SVI-05 | PASS    | Report gains `driverBinding`, `schemaVersion: 2`; stale v1 input rejected, never upgraded                                                  |
| SVI-06 | PASS    | Driver conflict fails before any sensor call (`sensorRuns === 0`); crash and tamper both fail closed; report still attributes both drivers |
| SVI-07 | PASS    | Two distinct real driver instances, non-implementer resolution, zero-tool session, no tool request observed                                |

## Test counts

60/60 across `verification-driver-isolation.test.mjs`,
`independent-verification.test.mjs`, `verification-sensor.test.mjs`,
`verification-human-review.test.mjs`, `cross-backend-delivery-journey.test.mjs`
(independently reproduced by the Verifier).

## Discrimination sensors (two independent runs)

1. **Author sensor** (5 mutations against the rule file): V1 driver-conflict
   bypass, V2 resolution excludes-implementer bypass, V3 read-only-grant
   bypass, V4 tool-request-detection bypass, V5 schema-version bypass — **5/5
   KILLED**, clean rerun 0 failures.
2. **Verifier sensor** (4 different mutations, chosen independently): removed
   `resolveVerifierDriver`'s `.sort()` (determinism), removed `driverBinding`
   from the sealed report, changed the read-only-grant threshold to an
   off-by-one (`> 1`), and renamed the tool-request event filter to an inert
   string — **4/4 KILLED**, each restored via `git checkout --` with a clean
   60/60 rerun confirming restoration.

## Spec-anchored outcome check

Tests assert spec-defined outcomes (exact codes, exact counts, literal
`not-configured` results, `state.calls`/`state.sensorRuns` proving no side
effect ran before a fail-closed check) rather than mirroring the
implementation. One noted, non-blocking observation: SVI-04's real-driver
test relies on the fixture's own `tools: []` literal rather than asserting
that literal was itself checked by `assertReadOnlyGrant` in the same test —
covered separately by a dedicated unit test, so no requirement gap.

## Broader blast-radius check

No other construction site for `VerificationInput` or caller of
`IndependentVerificationCoordinator.verify()` exists outside the shared
`tests/helpers/verification-fixture.mjs` fixture, which this change updated.
No `apps/` composition root references the coordinator yet — consistent with
the spec's explicit non-goal.

## Ranked gaps

None blocking. The fixture-precondition observation above is recorded for
awareness only.

## Human review

Required before merge, per repository governance. Issue #35's full
acceptance bar (a real composed verifier session in a live workflow) is
**not** closed by this PR — that is T71/T74/T75 composition-root work per
this feature's stated non-goals. This PR delivers the reusable rules and
resolution mechanism those tasks will consume.
