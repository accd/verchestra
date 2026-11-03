---
schema: verchestra-feature-handoff/v1
feature: tuf-refresh-cadence
issue: 382
status: in_progress
branch: claude/clever-lamport-7h2in4
baseRevision: 99d430a8b456f073f2bee5f157c669986353fa38
lastCompletedTask: T1
nextTask: "Independent verification of C1-C5 by a fresh sub-agent, then gate:quick and gate:security; after merge the owner dispatches t76-refresh-timestamp.yml from main with timestamp_expires at most 90 days out, approves it in tuf-release-signing and appends the role-refresh ledger entry."
lastGate: "node --test tests/build/t76-timestamp-refresh.test.mjs tests/agent-readiness/t76-refresh-workflow.test.mjs: 28 pass, 0 fail; two sensor mutations of the guard killed by the C1 test"
updatedAt: 2026-11-03T18:00:00Z
---

# Scope

F2 of #18 and the cadence half of #382. The refresh routine already accepts any
`timestamp_expires` up to the offline targets, so the live online metadata still
expires with the publication horizon. This feature sets the policy and enforces
it: the online expiry is at most 90 days after the refresh, renewed quarterly.
`checks.md` holds the five checks and the intent.

# Completed

- `scripts/t76-refresh-timestamp.mjs`: `assertWithinWindow` refuses an expiry later
  than the clock plus 90 days with `VES_T76_REFRESH_EXPIRY_WINDOW`. It runs after the
  signing step has checked the role expiry order, so the existing refusals keep their
  codes, and before any output exists. The `now` option is for tests only.
- `.github/workflows/t76-refresh-timestamp.yml`: the input description names the
  window and the validation step refuses a later instant before any key is read.
- Tests: `tests/build/t76-timestamp-refresh.test.mjs` (90 days and 1 ms refused,
  exactly 90 days accepted and signed into timestamp and snapshot) and
  `tests/agent-readiness/t76-refresh-workflow.test.mjs`.
- `docs/release-custody.md` and the runbook state the policy; the runbook's
  "Monthly online refresh" is now "Online refresh cadence".

# Open

- A 90-day ceiling with a refresh every 90 days leaves no margin. The runbook says
  to dispatch no later than 15 days before the current expiry. The owner may prefer a
  shorter window; the constant is `REFRESH_MAX_WINDOW_DAYS` in the script.
- The window is measured from the instant of the refresh (assumption `n` in
  `checks.md`).

# Intentionally unchanged

- `docs/qualification/qualification-line-exit-record.md`: it is signed, so only the
  owner re-signs it. F2 stays "not an operating control" until a real refresh runs.
- No key, ledger entry or live metadata was touched.
