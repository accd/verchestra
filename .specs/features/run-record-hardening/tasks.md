# Run record hardening tasks

Three tasks, one commit range and one pull request each, in this order. Each
is independently verifiable; T2 and T3 build on the task before them.

## Execution Plan

| Task | Deliverable | Requirements | Depends on | Verification |
| --- | --- | --- | --- | --- |
| T1 | `task review` reads the Execution Package through `RunRecord#approvedPackage`, before the surface is read or anything is recorded; the specification of all three tasks | RRH-01..03 | None | `tests/integration/task-review-package.test.mjs`, the locality scan, the review journey in `tests/e2e/task-cli-e2e.test.mjs` |
| T2 | No directory below a per-Run root is reached through a link; a write refuses what is not a regular file; verification's scratch root is covered | RRH-04..10 | T1 | `tests/integration/task-run-containment.test.mjs`, the locality scan, the link journeys in `tests/e2e/task-cli-e2e.test.mjs` |
| T3 | The five markers are sealed for a run planned from now on; a legacy Run keeps its plain markers; an active or cancel marker that does not verify fails closed and never blocks a cancel | RRH-11..19 | T2 | `tests/unit/task-run-markers.test.mjs`, `tests/integration/task-marker-commands.test.mjs`, the legacy and sealed journeys in `tests/e2e/task-cli-e2e.test.mjs` |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Architecture | `pnpm test:architecture` |
| Build | `pnpm gate:build` |
| Security | `pnpm gate:security` |
| Task journeys | `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` |
| Task composition and security | `node --test tests/unit/task-cli-composition.test.mjs tests/security/task-cli-security.test.mjs` |
| Readiness | `pnpm agent:check` |
| Site projection | `pnpm site:check` |

## Status

| Task | Commit | Status |
| --- | --- | --- |
| T1 | `f6a6e8b` | Done |
| T2 | the commit that carries this table | Done |
| T3 | — | Planned |

Evidence for every requirement is in `validation.md`. The next action is in
`handoff.md`.
