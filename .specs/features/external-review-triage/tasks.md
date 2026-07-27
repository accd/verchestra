# External Review Triage Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | Triage spec, design, tasks, handoff with verified claim table | None | `pnpm agent:check` |
| T2 | Full specifications: key-lifecycle, budget-enforcement, gate-repair-loop, policy-hardening | T1 | Handoff frontmatter parses; requirement IDs present |
| T3 | Decision specifications: dsse-attestation, context-tokenizers | T1 | Handoff frontmatter parses; pre-T76 decision recorded |
| T4 | `ROADMAP.md` insertion of T68a–T68d | T2, T3 | `pnpm agent:check`; T69–T77 numbering untouched |
| T5 | License evaluation, owner decision, AD in `.specs/STATE.md` | T1 | All license references agree; site gates if changed |
| T6 | GitHub issues for R7–R11, or recorded permission blocker | T1 | `gh issue list` or handoff backlog section |
| T7 | Final gates, STATE.md handoff update, completed handoff | T4, T5, T6 | `pnpm agent:check`, `pnpm gate:quick` |

## Gate Commands

| Level | Command |
| --- | --- |
| Agent | `pnpm agent:check` |
| Quick | `pnpm gate:quick` |
| Site (only if license changes) | `pnpm site:check && pnpm site:test` |

## Completion Rules

- Documentation only; no product code, no test edits, no dependency changes.
- Status surfaces asserting "T69 next" remain untouched in this feature.
- License change executes only after explicit owner confirmation.
- One logical concern per commit; no commit without owner request.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Complete | `spec.md` verified-claims table |
| T2 | Complete | `key-lifecycle/`, `budget-enforcement/`, `gate-repair-loop/`, `policy-hardening/` |
| T3 | Complete | `dsse-attestation/`, `context-tokenizers/` |
| T4 | Complete | `ROADMAP.md` T68a–T68d insertion |
| T5 | Complete | Apache-2.0 change + AD-007 in `.specs/STATE.md` |
| T6 | Complete | GitHub issues #33–#37 |
| T7 | Complete | `validation.md` gate table: agent:check, gate:quick, site unit/types/build/built/e2e all PASS |
