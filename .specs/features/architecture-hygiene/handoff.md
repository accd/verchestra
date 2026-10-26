---
schema: verchestra-feature-handoff/v1
feature: architecture-hygiene
issue: 597
status: verification
branch: refactor/597-architecture-hygiene
baseRevision: d5c7c6227a7932371bc6dbf4acb6534f5e3e3201
lastCompletedTask: T5
nextTask: "Review and maintainer merge once every required check is green on the exact head; after merge, move this handoff to complete and record in #597 that ARQ-004 stays an audit note."
lastGate: "gate:quick PASS at 46c9f00; tests/architecture 143 of 143; see validation.md"
updatedAt: 2026-10-26T12:00:00Z
---

# Evidence

T1 to T5 are recorded in `validation.md`, one commit per audit item: the payload
store limits proven and documented (ARQ-008), one budget ledger rule and one
list of terminal states (ARQ-007), a bound and a named timeout code for every
child process outside a provider session (ARQ-003), the three barrel cycles
broken behind a cycle detector (ARQ-005), and the three test doubles out of the
production entry points (ARQ-006). Each new architecture test was shown to fail
on a mutant or on the base revision.

# Next exact action

Read the required checks on the pull request head, mark T6 in `tasks.md`, and
move this handoff to `complete` after review and merge. ARQ-004 is not in this
change: #597 records it as an audit note to act on only when those files are
touched for another reason.
