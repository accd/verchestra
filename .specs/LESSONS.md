# LESSONS — auto-maintained by scripts/lessons.py

> Machine-owned. Do NOT hand-edit. Changes are overwritten on the next `lessons.py` write.
> Canonical state lives in `.specs/lessons.json`. Edit lessons only via the script.
> promote_threshold=2 distinct features · window_days=45 · quarantine_threshold=2

## Confirmed (load these at Specify/Design)

Corroborated across multiple features. Safe to apply as guidance.

_none_

## Candidates (under observation — do NOT load as guidance yet)

Seen once or not yet corroborated. Tracked, not trusted.

### L-001 — When two independent checks (format pre-check and digest verification) can both reject the same bad input with the same wrapped error code, assert on the specific rejection cause/message, not just the error code, so removing either check is independently detected.
- signal: `surviving_mutant` · recurrence: 1 feature(s) · scope: `packages/workspace/src/init` · harmful: 0
- features: canonical-json
- evidence: packages/workspace/src/init/safe-init.ts:125-129 (packages/workspace/src/init)
- last seen: 2026-08-01T11:30:39Z

### L-002 — When multiple pre-existing test assertions are updated across a slice to track a format change, enumerate every changed file in the handoff's Decisions section as each change lands, not just a running count fixed at the end — an implementer can lose track of one across multiple tasks (T7/T8/T9).
- signal: `spec_precision_gap` · recurrence: 1 feature(s) · scope: `.specs/features` · harmful: 0
- features: canonical-json
- evidence: handoff.md Decisions section / spec.md CJ-12 evidence (.specs/features)
- last seen: 2026-08-01T11:30:50Z

## Quarantined (failed when applied — ignore)

A confirmed lesson that recurred alongside failure. Kept for the maintainer to review.

_none_
