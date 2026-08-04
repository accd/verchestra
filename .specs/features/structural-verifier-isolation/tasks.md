# Structural Verifier Isolation Tasks

1. **T1 — Driver-identity conflict.** `VES_VERIFIER_DRIVER_CONFLICT`; require
   `implementerDriverId`/`verifierDriverId` on `VerificationInput`; check
   immediately after the existing actor-identity check. (SVI-01)
2. **T2 — Verifier driver resolution.** `resolveVerifierDriver`, pure,
   exported, deterministic; explicit `not-configured` result. (SVI-02, SVI-07)
3. **T3 — Read-only grant.** `VES_VERIFIER_GRANT_INVALID`;
   `assertReadOnlyGrant` requiring an empty tool array. (SVI-03)
4. **T4 — Tool-invocation rejection under zero grant.** Test against
   `DeterministicMockDriver`: a scenario emitting `tool.requested` while the
   session was started with `tools: []` is rejected and recorded. (SVI-04)
5. **T5 — Report schema bump to v2.** Add `implementerDriverId`/
   `verifierDriverId` to the sealed report; reject `schemaVersion !== 2`;
   update existing v1 fixtures in `tests/unit/independent-verification.test.mjs`
   to assert they are correctly rejected as stale. (SVI-05)
6. **T6 — Crash/tamper composition test.** Prove the existing
   `activeStateBeforeDigest`/`AfterDigest` mismatch mechanism plus the new
   driver-identity check compose: a tampered digest fails closed even when
   driver identities are valid, and vice versa. (SVI-06)
7. **T7 — Full cross-driver scenario + documentation.** End-to-end test with
   two distinct `DeterministicMockDriver` identities proving resolution
   picks the non-implementer driver and a same-id attempt is refused; update
   `.specs/STATE.md` with the decision record (AD-011).

Verification per task: `node --test tests/unit/verification-driver-isolation.test.mjs
tests/unit/independent-verification.test.mjs`, then `pnpm gate:quick` before
the final task's `pnpm gate:security`.
