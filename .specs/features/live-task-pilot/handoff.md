---
schema: verchestra-feature-handoff/v1
feature: live-task-pilot
issue: 406
status: in_progress
branch: main
baseRevision: 35b23b3b122be7f0d7a6831f3261a9163373cfd7
lastCompletedTask: T1
nextTask: "T2 remainder: the owner binds the three credentials (spec.md section 8 step 5). Then T3: P1 with VES = npx --yes verchestra@0.0.0-qualification.6. The configuration identity, the baseline and the first fingerprint are recorded in validation.md."
lastGate: "agent:check PASS; no provider called"
updatedAt: 2026-10-03T20:40:00Z
---

# Scope

Pre-registration for the supervised live pilot of the installed `vestra task`
path (#406). This change fixes, before any execution, the target repository
and revision, the candidate, the configuration identity, three tasks with exact
Task Request v1 files and acceptance probes, three scenarios plus a free
plan-time refusal, the limits and stop rules, the success definition, the
recording template, the clean-machine steps, the boundaries, and the review
checklist. Nothing was executed against a provider.

# Completed Evidence

T0: `spec.md` (PLT-01..PLT-10), `tasks.md`, this handoff, `validation.md` with
the empty results table, `requests/` (P1–P3, S1–S3, S3b),
`probes/` (P1–P3), and `task-gates.example.json`. Every request was validated
against `schemas/task-request/1.schema.json` and `normalizeTaskRequest`; the
target baseline and every probe and revert check were exercised in throwaway
clones of the pinned revision (see `validation.md`).

# Blockers

None. The owner resolved every blocker on 2026-10-03, before any run
(`validation.md`, Blocker resolution): candidate `.5`, ceilings as proposed,
the owner's own account on the owner's Mac, accountable human `accd`, no
independent reviewer (T8 not performed), G1–G3 accepted. The three deviations
from the pre-registration are recorded in `validation.md` before the first run.

# Next Action

T2, following `spec.md` §8 steps 1–8 with `VES` as defined in §2. Record the
configuration identity and the first fingerprint in `validation.md` before
the first run.

# Files Intentionally Left Unchanged

Everything outside `.specs/features/live-task-pilot/`. The quick-start keeps
its "Live pilot pending" limit until T9; no qualification report or status
surface changes, because the qualification state did not change.

# Known Risks Declared in Advance

- P3 verification depends on the verifier naming `lib/cli-input.js` as the file
  to revert (`spec.md` §4, P3).
- S1 has a timing window; one repeat is allowed (`spec.md` §5, S1).
- S3's denied-call count may not be visible through a public command; it would
  be recorded as `unavailable` (`spec.md` §5, S3).
- Claude Code reports usage at session end, so a run can overshoot its token
  ceiling before it is stopped (`spec.md` §6).
- The subscription profile has never run against Claude Code itself. If the
  live session advertises a tool or an MCP server the profile does not expect,
  or a hook runs, the first run fails closed with a `VES_CLAUDE_*` code and the
  pilot stops (`spec.md` §6).
