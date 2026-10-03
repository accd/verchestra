---
schema: verchestra-feature-handoff/v1
feature: release-decision-rounds
issue: 18
status: verification
branch: feat/18-release-decision-rounds
baseRevision: 534236829e7f55e81cf953dfacd730430a6d1719
lastCompletedTask: T4
nextTask: "Independent review of the three commits and the proposed AD in .specs/STATE.md, then maintainer merge, which numbers the AD. No round-2 decision file is created by this feature; a promote round is separate, owner-led work."
lastGate: "release-decision focused 71, test:agent-readiness 354, test:architecture 122, test:census 13, complexity:check, agent:check PASS; gate:quick PASS (unit 2666, agent-readiness 354, census 13)"
updatedAt: 2026-10-03T00:00:00Z
---

# Scope

A version may have later release-decision rounds that supersede an earlier
reject without editing or deleting it (#18). See `spec.md`; evidence in
`validation.md`.

# Completed

- T1 `0537e67`: round-aware validator and tests, census refreshed.
- T2 `2f4287b`: `RELEASE-DECISION-CONTRACT.md` states rounds.
- T3 and T4: this feature's artifacts, the proposed AD, the discrimination
  sensor (14 killed, 0 survived), and the gates in `validation.md`.

# Next Exact Action

Review and merge. No code task remains on this branch.

# Open decisions

- No surface lists decisions today. If `agent:context` or the site should show
  the effective decision and its history, that is a schema change to the
  context snapshot (schemaVersion 3) and is left to the owner.
- A later round's `reviewedIn` is not required to differ from the previous
  round's pull request. Requiring it is possible but was not asked for.
- The prose status surfaces (`AGENTS.md`, `llms.txt`, the site status page)
  name `release-decision-1.0.0.md`; `agent:check` does not check that they
  name the effective decision. That matters only once a round 2 lands.
- Two instants in the same millisecond are treated as not later (fail closed).

# Intentionally unchanged

`docs/qualification/release-decision-1.0.0.md`, `docs/release-custody.md`,
`docs/merge-governance.md`, `docs/qualification/acceptance-matrix.md`, every
qualification report, `apps/site`, and
`.specs/features/release-decision/spec.md`.
