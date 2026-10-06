# Live task pilot: tasks (#406)

Pilot tasks are named P1–P3 and scenarios S1–S3b in `spec.md`; the work items
below are T0–T9. Each item lists its done criterion. T1 onward must not start
until T0 is merged, so the pre-registration provably predates execution.

| ID | Work item | Done when | Status |
| --- | --- | --- | --- |
| T0 | Pre-register the pilot: target, revision, candidate, identity, tasks, requests, probes, scenarios, limits, recording template, reproduction, boundaries, review checklist, gate allowlist example | `spec.md`, `tasks.md`, `handoff.md`, `validation.md`, `requests/`, `probes/`, and `task-gates.example.json` are merged after human review; every request passes the Task Request v1 schema and `normalizeTaskRequest` (S3b is refused by both, as intended) | done (`aee87ac`; amended `8362138`) |
| T1 | Owner unblocks the pilot | Every item in `handoff.md` `# Blockers` is resolved and the resolution is recorded in `validation.md` (candidate published, limits approved, model access confirmed, reviewer named) | done 2026-10-03; no reviewer exists, recorded |
| T2 | Prepare the clean machine | §8 steps 1–8 done; identity recorded; baseline `tests 4, pass 4, fail 0, skipped 0` reproduced; first checkout fingerprint recorded | done: the identity, the baseline, and the first fingerprint are in `validation.md`; the credential mode is `subscription` for both providers (P1-2 plan output) |
| T3 | Run P1 (bug fix) | One record per attempted run; human review decision recorded; §4 P1 assertions checked in a verification clone | in progress: attempt 1 refused at `plan`; attempt 2 reached the verifier and stopped on the §6 stop rule (model not offered); attempt 3 waits for the candidate that carries `.specs/features/p1-pilot-remediation/` |
| T4 | Run P2 (small feature) | As T3, for P2 | pending |
| T5 | Run P3 (refactor) | As T3, for P3 | pending |
| T6 | Run S3b, S1, S3, S2 in that order | One record per attempted run; each expected outcome in §5 marked observed, not observed, or unavailable | pending |
| T7 | Write the sanitized evidence | `docs/qualification/live-task-pilot-406.md` and the per-run JSON records exist, pass `pnpm agent:check`, and contain no credential or machine-local value; the disposable clone, verification clones, pilot Workspace state, and pilot credentials are deleted | pending |
| T8 | Independent review | A reviewer who is not the operator completes the §10 checklist in `validation.md` and records failures and next actions | not performed: no independent reviewer exists (owner decision, 2026-10-03) |
| T9 | Close out | Findings that need code changes are filed as issues; `docs/quick-start.md` "Live pilot pending" limit and the status surfaces are updated to state what the pilot showed, within §9's boundaries; handoff set to `complete` | pending |
