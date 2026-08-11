# T73 Validation — regression-campaigns

**Verdict: PASS.** Independent verification (author ≠ verifier). The complete,
externally routable report is `docs/qualification/t73-validation.md`; this
file is the feature-local summary.

- **Revision:** `23e78dc6c01541919719ec2074342a60484d2bef`, reachable from
  `main`. The T73 surface itself last changed at `3e9afc1` (the T4a
  canonical-JSON migration of `buildCampaignSummary`'s ordering); `23e78dc`
  is a later, byte-identical point for that surface, chosen because
  `gate:quick` genuinely fails at `3e9afc1` on an unrelated defect (a
  handoff-status typo fixed two commits later in the same PR). See the
  report's "Revision correction" section.
- **Gates:** `gate:quick` PASS locally at the exact bound revision;
  externally dispatched `gate:build` PASS in run 31525323571 (3,498 cases,
  0 skipped, 0 todo).
- **Acceptance criteria:** CAM-01–06 and all four issue #14 acceptance
  outcomes plus its three completion-checklist items are mapped to exact
  assertions in the qualification report.
- **Evidence volume:** 62 T73-focused cases (21 unit, 13 contract, 28
  release); the 22-campaign corpus exceeds the declared minimum of 20.
- **Discrimination sensor:** six mutations killed, zero survived — two of
  them (M3, M4) targeting CAM-03's "distribution, not a cherry-picked score"
  property from two different code paths (the verdict branch and the
  underlying Wilson-bound arithmetic), proving both are load-bearing.
- **Implementation range:** T0–T5 (`4ebd211` through the release-scope
  activation), plus the T4a canonical-JSON migration; the report author did
  not author any T73 or T4a implementation commit.

No T73 blocker survived verification. The qualification chain advances to
T74 (#15, sealed-holdout evaluator and promotion gate).
