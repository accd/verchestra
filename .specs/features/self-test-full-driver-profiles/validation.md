# T71 Validation — self-test-full-driver-profiles

**Verdict: PASS.** Independent verification (author ≠ verifier). The full,
externally routable report is `docs/qualification/t71-validation.md`; this file
is the feature-local summary.

- **Revision:** bound to `9e663bd` — the merged T71 tip `ec258a2` plus the
  documentation-only AD-012 commit. `git diff ec258a2 9e663bd` touches only
  `.specs/STATE.md` (+17, −0), so the qualified behavior equals `ec258a2`.
- **Gates:** `gate:quick`, `gate:full` (3,330 cases: 1,894 unit, 446 contract,
  565 integration, 142 e2e, 283 fault), and `gate:security` all PASS locally on
  Windows with 0 skipped and 0 todo; CI Quality gate and CodeQL PASS at the pure
  T71 tip `ec258a2`.
- **Acceptance criteria:** 10 of 10 proven — FULL-01–04, DRV-01–04, CLI-01,
  TST-01 — each mapped to file-and-assertion evidence in the qualification
  report's adequacy matrix.
- **Evidence volume:** 137 new T71 cases across seven suites (34 unit rules, 2
  file-record-store, 6 full-scenario, 5 driver-scenario, 23 full crash-matrix,
  26 durable-crash-runner, 41 driver-authority) against a declared minimum of 30.
- **Discrimination sensor:** five behavior mutations in
  `packages/application/src/self-test/self-test.ts`, each disabling one
  enforcement point — exact-once multiplicity, hard-crash exit, denied-authority
  zero-calls, writer-Tool reachability, and effect idempotency — all KILLED, 0
  survived; the source file was verified unmodified after the campaign.
- **Diff range:** `0793779..ec258a2` (the T71 implementation merged via PR #182).

Gaps: none survived verification. The qualification chain advances to T72 (#13).
