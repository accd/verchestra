# Gate Repair Loop Tasks

## Execution Plan

| Task | Deliverable | Depends on | Verification |
| --- | --- | --- | --- |
| T1 | `onGateFailure` schema + generated types + validation (REP-01) | None | Contract tests |
| T2 | Attempt loop in executor with checkpointed counts (REP-02, REP-05) | T1 | Unit + regression tests |
| T3 | Bounded, redacted driver feedback channel (REP-03, REP-06) | T2 | Security tests |
| T4 | `escalated` state + attempt-chain evidence (REP-04) | T2 | Integration + fault-injection tests |

## Gate Commands

| Level | Command |
| --- | --- |
| Quick | `pnpm gate:quick` |
| Full | `pnpm gate:full` |

## Completion Rules

- Schema changes only through the generator.
- No gate, assertion, or threshold may be weakened to make repair pass.
- Qualification evidence recorded under `docs/qualification/` as task T68c.

## Execution Evidence

| Task | Status | Evidence |
| --- | --- | --- |
| T1 | Pending | — |
| T2 | Pending | — |
| T3 | Pending | — |
| T4 | Pending | — |
