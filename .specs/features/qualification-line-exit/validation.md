# Qualification line exit validation

## Verdict

PASS for QLE-01 to QLE-08 on the change itself, by the agent that authored it,
on win32-x64 under Node 24. This is not an independent verification: the
author and the verifier are the same session, and human review decides the
merge. Nothing here signs the record, confirms AD-033, or publishes; those
stay with the owner (`handoff.md`, owner checklist).

Base revision: `d2f6de855089e1496a6d9a95c01c54975da1120e` (`origin/main`).

## Requirement evidence

| Requirement | Evidence |
| --- | --- |
| QLE-01 | `docs/qualification/qualification-line-exit-record.md`: frontmatter lines 1-11 (`schema: verchestra-version-line/v1`, `line`, `latestRelease: 0.0.0-qualification.8`, `decisionInEffect`, `decisionDigest: sha256:e3b53bd4…ab11c`, `decidedBy: accd`, `decidedAt` placeholder, empty `signature`, `publicKeyRef`); sections "What the line is" (line 35), "Exit conditions for a public 0.x line" (54, X1 to X6), "Condition for a 1.0.0 round 2" (74, R1 and R2), "Dissent recorded" (84). The digest equals `sha256sum` of the decision file in Git and on disk (`.gitattributes` `eol=lf`). `tests/agent-readiness/version-line-record.test.mjs`, "the committed record validates, and is never reported as a pass while unsigned". |
| QLE-02 | `scripts/agent-readiness.mjs`: `validateVersionLineRecord`, `latestLedgerRelease`, `checkVersionLineRelease`, `checkVersionLineDecision`, `checkExitConditions`, `repositoryPathExists`; wired by `checkVersionLineRecord` in `checkRepository`. Tests: 24 refusal rows ("the record is refused for …"), "the ledger and the decision are read from the repository, not from the record" (a release appended to the ledger, a one-byte edit of the decision, an unreadable ledger), "evidence paths resolve inside the repository only", "the record's errors reach checkRepository". |
| QLE-03 | `checkVersionLineSignature` reuses `checkDecisionSignature` (the decision's Ed25519 verification over the §4.1 bytes); `readVersionLineRecord` returns the `unsigned` warning; `scripts/agent-check.mjs` prints `agent:check warning: …` and decides on errors alone. Tests: "a complete record with an empty signature is unsigned, with no error", "a signed record verifies against the resolved key, and nothing less than that is verified" (wrong key, edited body, edited claim, no resolver), "a signed record needs a real decision instant", "a signed record on disk is verified with the committed key and carries no warning". Observed: `pnpm agent:check` prints the warning for the committed record and `agent:check PASS`. |
| QLE-04 | "no record is not a failure, because nothing has been recorded" (`signature: "absent"`, no error, no warning); every refusal row asserts each error starts with the record's path. |
| QLE-05 | `VERSIONING.md:5` (the new sentence and the link); `ROADMAP.md:42` ("Release conditions"); `docs/release-custody.md:851-853` (end of section 9). `pnpm agent:check` resolves the links; the site build projects `VERSIONING.md` and `ROADMAP.md` and `check:built` reports internal links valid. |
| QLE-06 | `docs/qualification/acceptance-matrix.md:851-860`: the update paragraph under L5, "reported, not re-performed", naming PR #523, 2026-10-14, `.7`, and a J08 run on `.9` or later as the condition; L5 stays under "Qualifying". |
| QLE-07 | `.specs/STATE.md:393-399`: the dated note under AD-033; the status line (376-377) is unchanged. `docs/qualification/release-decision-1.0.0.md` is byte-identical to `origin/main` (`git diff --stat` lists no change to it; its digest is the one the record binds). |
| QLE-08 | `.specs/features/tuf-role-separation/handoff.md` (`nextTask`: `.3` to `.8` done, detached signing and people separation remain, X2; Blockers reconciled 2026-10-29), `.specs/features/release-custody/handoff.md` (Blockers and Next action: O6 is the owner's next action; merge, `.3` re-sign, and O2 step 4 recorded as done), `.specs/features/milestone-2-completion/handoff.md` (P7 row and M2C-07: #234, #235, #236 closed 2026-09-30, verified with `gh issue view`). `corepack pnpm agent:context` lists all three with the new `nextTask` and still derives "T77 complete; the declared chain is fully verified". |

## Gate results

| Gate | Result |
| --- | --- |
| `corepack pnpm gate:quick` (PATH shim for nested `pnpm`) | PASS: format, lint, complexity (115 baselined keys, nothing above 10 unaccounted; no baseline edit), typecheck, `test:unit` 3615/3615, `test:agent-readiness` 464/464, `test:census` 14/14 (0 skipped, 0 todo throughout) |
| `corepack pnpm agent:check` | PASS, with the one warning `docs/qualification/qualification-line-exit-record.md: signature is empty; the record is unsigned until the owner signs it` |
| `node --test tests/agent-readiness/release-decision.test.mjs tests/agent-readiness/version-line-record.test.mjs` | PASS: 106/106 (35 new), 0 skipped, 0 todo |
| `corepack pnpm agent:context` | `qualification: T77 complete; the declared chain is fully verified`; the four handoffs of this change parse |
| `corepack pnpm --filter @verchestra/site test:unit` | PASS: 64/64 |
| `corepack pnpm --filter @verchestra/site build` | PASS: 135 pages |
| `corepack pnpm --filter @verchestra/site check:built` | PASS: `internalLinks: valid`, `metadata: valid` |
| `pnpm site:check` (`astro check`) | Not run on this host: `astro check` crashes on Windows in `@emnapi/runtime@2.0.0-alpha.3` (on `main` too); CI runs it on Ubuntu for the pull request |
| `pnpm census:refresh` | Run once; it changed only the `digest` signal of `scripts/agent-readiness.mjs` (4 to 5) |

The first `gate:quick` attempt of this session wrote to a log file another
worktree's session also wrote to, so its output was not usable; the result
above is the second, separate run.

## Discrimination sensor

Before the census inventory was refreshed, `test:census` failed with
`signalMismatches: ['scripts/agent-readiness.mjs']`: the one added
`createHash` call was detected, which shows the census reads the validator's
real bytes. The record's own sensors are in the test file: the signed-fixture
cases prove that a wrong key, an edited body, an edited claim, and an absent
resolver each turn `verified` into `invalid`; the ledger case proves a release
appended after the record is refused; the decision case proves a one-byte edit
of the hold is refused. No existing assertion was changed.

## Gaps and follow-up

- The record is unsigned. Signing is the owner's act (`handoff.md`).
- X1 to X6 and R1, R2 are open by construction; clearing a row is a reviewed
  change citing the run that cleared it.
- The validator checks the first four columns of each condition row and that
  evidence paths resolve; it does not check that the evidence says what the
  row claims. That stays a human reading.

## Human review

Required before merge. The reviewer checks the record's wording against
`docs/qualification/release-decision-1.0.0.md` and `docs/release-custody.md`,
the L5 and AD-033 notes, and the three handoff refreshes against the issues and
runs they cite.
