# Qualification line exit tasks

## Execution plan

One pull request, one concern: the record, its validator, and the
record-consistency fixes the same analysis found. Owner-only steps are not
tasks; they are the checklist in `handoff.md`.

| Task | Deliverable | Requirements | Depends on | Owner needed |
| --- | --- | --- | --- | --- |
| T1 | `docs/qualification/qualification-line-exit-record.md` | QLE-01 | none | sign afterwards |
| T2 | Validator in `scripts/agent-readiness.mjs`, warning path in `scripts/agent-check.mjs`, `tests/agent-readiness/version-line-record.test.mjs`, census signals refreshed (`pnpm census:refresh`) | QLE-02, QLE-03, QLE-04 | T1 | review |
| T3 | `VERSIONING.md`, `ROADMAP.md`, `docs/release-custody.md` section 9 | QLE-05 | T1 | review |
| T4 | Acceptance-matrix L5 update; `.specs/STATE.md` AD-033 note | QLE-06, QLE-07 | none | confirm AD-033 |
| T5 | The three handoff refreshes | QLE-08 | none | review |
| T6 | This feature's `spec.md`, `tasks.md`, `handoff.md`, `validation.md` | all | T1 to T5 | review |

## Gate commands

| Level | Command |
| --- | --- |
| Focused | `node --test tests/agent-readiness/release-decision.test.mjs tests/agent-readiness/version-line-record.test.mjs` |
| Quick | `pnpm gate:quick` |
| Agent | `pnpm agent:check`; `corepack pnpm agent:context` |
| Site | `pnpm site:check`, `pnpm site:test`, `pnpm site:build` (on a host where `astro check` cannot run: the site unit tests, `build`, and `check:built` through `corepack pnpm --filter @verchestra/site`) |

## Test coverage matrix

| Requirement | Test | Layer |
| --- | --- | --- |
| QLE-01 | `version-line-record.test.mjs`: the committed record validates, names the line and the decision in effect, and carries both condition sections | agent-readiness |
| QLE-02 | `version-line-record.test.mjs`: one refusal per condition (frontmatter, schema, line, identity, latest release against the ledger and the line, decision reference and digest, sections, rows, gap ids, evidence paths, duplicates); the ledger and the decision read from the repository; an escaping path refused | agent-readiness |
| QLE-03 | `version-line-record.test.mjs`: unsigned with a warning; verified with the committed key; invalid for the wrong key, an edited body, an edited claim, an unresolvable key, or a placeholder `decidedAt` | agent-readiness |
| QLE-04 | `version-line-record.test.mjs`: no record is `absent` with no error and no warning; `checkRepository` carries the record's errors and `repositoryWarnings` its unsigned state | agent-readiness |

## Requirement traceability

QLE-05 to QLE-08 are documentation requirements; `validation.md` cites the file
and line for each, and `agent:check` proves the links and the handoffs parse.

## Completion rules

- No existing assertion weakened, skipped, or deleted.
- `complexity:check` passes without a baseline edit.
- The signed decision, the task reports, and `README.md` are untouched.

## Execution evidence

Recorded in `validation.md`.
