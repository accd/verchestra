# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

### L-001 — When two independent checks (format pre-check and digest verification) can both reject the same bad input with the same wrapped error code, assert on the specific rejection cause/message, not just the error code, so removing either check is independently detected.
- signal: `surviving_mutant` · recurrence: 2 feature(s) · scope: `packages/workspace/src/init` · harmful: 0
- features: canonical-json, dsse-attestation
- evidence: packages/workspace/src/init/safe-init.ts:125-129 (packages/workspace/src/init) (+1 more)
- last seen: 2026-08-12T18:41:09Z

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-002 — When multiple pre-existing test assertions are updated across a slice to track a format change, enumerate every changed file in the handoff's Decisions section as each change lands, not just a running count fixed at the end — an implementer can lose track of one across multiple tasks (T7/T8/T9).
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `.specs/features` · harmful: 0
- features: canonical-json
- evidence: handoff.md Decisions section / spec.md CJ-12 evidence (.specs/features)
- last seen: 2026-08-01T11:30:50Z

### L-003 — When a requirement reads 'WHEN the candidate is given X', a test that exercises X in isolation satisfies nothing: assert that the production path actually issues it, or the requirement is vacuously true while the mechanism sits unwired.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `apps/vestra-cli/src` · harmful: 0
- features: sealed-holdout
- evidence: apps/vestra-cli/src/promotion-composition.ts (verifier mutation V10) (apps/vestra-cli/src)
- last seen: 2026-08-12T18:39:51Z

### L-004 — Forge exactly one field per negative test: a blunt forgery that breaks several things at once trips whichever guard fires first, so every other guard survives its own deletion undetected.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `tests/security` · harmful: 0
- features: dsse-attestation
- evidence: tests/security/dsse-interoperability.test.mjs (tests/security)
- last seen: 2026-08-12T18:39:51Z

### L-005 — When a sensor shows a guard is unkillable, decide which it is: subsumed by a later check (delete it) or enforced by the type checker (say so in place) -- an unkillable guard left unexplained reads as defence and is decoration.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `packages/evidence/src/integrity` · harmful: 0
- features: dsse-attestation
- evidence: packages/evidence/src/integrity/artifact-sealer.ts openEnvelope (packages/evidence/src/integrity)
- last seen: 2026-08-12T18:39:51Z

### L-006 — Prove a denied write through the same state it would have written to; a second instance built from the same inputs has its own copy and cannot see the write, so 'denied and changed nothing' passes even when the write happened.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `packages/application/src/promotion` · harmful: 0
- features: sealed-holdout
- evidence: packages/application/src/promotion/promotion-gate.ts createCandidateGrant (packages/application/src/promotion)
- last seen: 2026-08-12T18:39:52Z

### L-007 — A decision record must not assert a change it did not make: AD-018 claimed 'issue #15 is corrected' when only a comment had been added, so the tracked scope and the decision log disagreed until a verifier checked the issue body itself.
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `.specs` · harmful: 0
- features: sealed-holdout
- evidence: .specs/STATE.md AD-018 (.specs)
- last seen: 2026-08-12T18:39:52Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
