---
schema: verchestra-feature-handoff/v1
feature: tuf-refresh-cadence
issue: 382
status: verification
branch: claude/clever-lamport-7h2in4
baseRevision: 99d430a8b456f073f2bee5f157c669986353fa38
lastCompletedTask: T1
nextTask: "Human review and merge. Then the owner dispatches t76-refresh-timestamp.yml from main with timestamp_expires at most 90 days out, approves it in tuf-release-signing and appends the role-refresh ledger entry; until then F2 is not an operating control."
lastGate: "independent verification PASS 7/7 (verification.md, six findings closed); check_proofs 10 pass 0 fail at d631fed; format, lint, complexity, typecheck PASS; the refresh and workflow suites 30/30. Not green in this Node 22 root container and unrelated: three unit tests (root cleanup, setAuthorizer) and four single-binary build tests and context.test.mjs; CI on Node 24.14.0 is the authoritative run."
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

# Verification

A fresh sub-agent found six findings in two rounds, all closed: the workflow test
matched text a broken guard still contains (C4), the document proof was looser than its
claim (C5), a non-finite clock switched the window off (C6), the exported constant, the
shell guard's stricter edge by seconds, and a text-only proof that the command line
cannot set the clock (C7). Sensors: limit 91 days, guard removed, `!` removed from the
shell guard, finite check removed, and `now: optionalArgument(args, "--now")` are each
killed by a test.

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
