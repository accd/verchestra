# Subscription Provider Authentication Tasks (ADP-A)

The coordinator's task IDs are TA1 and TA2 in
`.specs/features/architecture-deepening/tasks.md`. The steps below split them
into one commit per concern.

## Execution Plan

| Task | Step | Deliverable | Requirements | Depends on | Verification |
| --- | --- | --- | --- | --- | --- |
| T1 | TA1 | Evidence, spec, design, threat model, tasks, handoff, validation; the decision in `.specs/STATE.md` | — | None | `pnpm agent:check` |
| T2 | TA2 | `mediated-mcp-subscription` profile, the fake's own invocation check, spike and contract tests, the qualification report | SPA-01..08 | T1 | `pnpm qualify:claude`, `pnpm test:contract` |
| T3 | TA2 | Codex identity directory and login check | SPA-09..11 | T1 | integration tests, `pnpm qualify:codex` |
| T4 | TA2 | Unbilled usage in the budget meter and the Run Capsule | SPA-17..18 | T1 | unit and integration tests |
| T5 | TA2 | Mode selection, credentials, implementer and verifier wiring, doctor check, journeys and security suite | SPA-12..16, SPA-19..20 | T2, T3, T4 | `pnpm test:e2e`, `pnpm gate:security` |
| T6 | TA2 | Quick-start, README, live pilot pre-registration, handoff | SPA-21 | T5 | `pnpm agent:check`, `pnpm site:check` |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Architecture | `pnpm test:architecture` |
| Build | `pnpm gate:build` |
| Security | `pnpm gate:security` |
| Qualification | `pnpm qualify:claude`, `pnpm qualify:codex` |
| Readiness | `pnpm agent:check` |
