# Dependency Pull Request Backlog Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification | Commit |
| --- | --- | --- | --- | --- |
| T1 | Specification, design, tasks, and portable handoff | None | `pnpm agent:check` | `docs(deps): specify pull request backlog cleanup` |
| T2 | Correct PR #3 to exact pnpm Action v6.0.8 and merge | T1 | PR CI and post-merge CI | `ci(deps): update pnpm action setup` |
| T3 | Correct PR #2 across all workflows and merge | T2 | PR CI, post-merge CI, manual agent evaluation | `ci(deps): update setup node action` |
| T4 | Refresh and merge PR #4 | T3 | Frozen install, quick gate, PR and post-merge CI | Dependabot squash commit |
| T5 | Consolidate Pi 0.82.1, qualification evidence, and Dependabot policy in PR #5 | T4 | Pi qualification, full gate, site gate, PR CI | `build(deps): qualify pi runtime 0.82.1` |
| T6 | Close PRs #6, #7, and #8 with exact reasons | T5 | GitHub state and closure comments | External GitHub state |
| T7 | Independent validation, completed handoff, zero-open and deployment proof | T6 | Verifier sensor, agent check, GitHub and HTTP checks | `docs(deps): complete pull request backlog cleanup` |

## Gate Commands

| Level | Command |
| --- | --- |
| Agent | `pnpm agent:check` |
| Quick | `pnpm gate:quick` |
| Pi | `pnpm qualify:pi && pnpm test:qualification` |
| Full | `pnpm gate:full` |
| Site | `pnpm site:test && pnpm site:build` |
| GitHub | Required PR checks followed by required `main` checks |

## Test Coverage Matrix

| Layer | Requirements | Evidence |
| --- | --- | --- |
| Workflow source | DPR-01, DPR-02 | Exact SHA/version searches across tracked workflows plus GitHub CI |
| Manifest and lockfile | DPR-03, DPR-04, DPR-05 | Frozen install, exact package assertions, single Pi version |
| Qualification behavior | DPR-04 | Twelve Pi boundary tests and full qualification gate |
| Site performance | DPR-08 | Existing Lighthouse assertion at 0.95 |
| Repository state | DPR-06, DPR-07 | GitHub PR/check/deployment queries and production HTTP probe |

## Completion Rules

- One task, one atomic commit where repository content changes.
- External-only closure state is recorded in the handoff and final evidence.
- No merge occurs before required checks pass.
- Independent verification and human authorization are mandatory.

## Execution Evidence

| Task | Status | Commit or evidence |
| --- | --- | --- |
| T1 | Complete | `69a34eb` |
| T2 | Complete | PR #3, merge `595ea2d5d0d02fc6a76aad31e2e193094f974b39` |
| T3 | Complete | PR #2, merge `5a887d1bef09381c3251c62c614aea464e6a3553` |
| T4 | Complete | PR #4, merge `b35dd6e8e1cd49b9f493e7306e35efb96a997cdf` |
| T5 | Verification | Local Pi, full, site, and Lighthouse gates pass; PR CI pending |
| T6 | Pending | — |
| T7 | Pending | — |
