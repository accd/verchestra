---
schema: verchestra-feature-handoff/v1
feature: self-test-full-driver-profiles
issue: 12
status: verification
branch: codex/issue-12-t71-self-test
baseRevision: 4b984c7e541863fe056a31a9e72749f9bcf46f7f
lastCompletedTask: T8
nextTask: Independent verification and contributor review before any push
lastGate: gate:quick PASS; test:security 937/937 PASS; test:fault 283/283 PASS on Node 24.18.0
updatedAt: 2026-08-03T18:25:57Z
---

# Scope

Implement T71 `full`, hard-crash, and explicitly approved read-only `drivers`
Self-Test behavior for issue #12. Preserve the four sealed profile IDs, the
T69 trust boundary, the T70 report/CLI contract, and offline deterministic
execution.

# Authority and external effects

Antonio explicitly confirmed that work may start and `MiguelCorre` is assigned
to #12. The issue's stale `status: blocked` label is not changed here. Local
atomic commits are authorized. Push, PR creation, merge, release, and issue
metadata changes are not authorized yet.

# Completed evidence

- Read root and scoped repository instructions, architecture, repository map,
  roadmap, current state, T69 spec/design, and T70 spec/design/tasks/handoff.
- Confirmed issue #12 is open, assigned to `MiguelCorre`, and has no comments.
- Confirmed AD-010's three-region boundary and sealed four-profile registry.
- Restored existing frozen workspace links with
  `pnpm install --frozen-lockfile`; no dependency or lockfile update occurred.
- Baseline `pnpm gate:quick` passes. The repository pins Node 24.14.0; the
  local run used Node 24.18.0 and pnpm 10.34.5.
- Created local branch `codex/issue-12-t71-self-test`; nothing was pushed.
- T0 planning committed as `f568642`.
- T1 adds closed `FULL_CHECK_IDS`, `DRIVER_CHECK_IDS`, the eleven
  `FULL_DURABLE_BOUNDARY_IDS`, and the before/after crash phases. Full and
  Driver profiles now require their T71 checks rather than accepting an empty
  scenario.
- T1 application verdicts reject incomplete, duplicated, malformed,
  non-exactly-once, non-resumed, or divergent durable facts. Driver verdicts
  bind every displayed review field, require an explicit read-only Tool list,
  prove denied authority reached zero provider boundaries, and require exactly
  one provider boundary for an approved invocation.
- T1 focused evidence: 33/33 unit cases pass; lint, typecheck, formatting, and
  the complexity ratchet pass with no new baseline exemption.
- T1 contracts committed as `ba7969b`.
- T2 adds `DurableCrashRunner` under the Node-bound Self-Test adapter. It runs
  a repository-owned absolute child entrypoint first in hard-crash mode and
  then in resume mode against the same disposable root, uses no shell, passes
  only the explicit `VERCHESTRA_SELF_TEST` environment marker, bounds runtime
  and output, and returns persisted facts plus exit codes without deciding a
  verdict.
- The application rule now requires the expected hard-crash exit code 86 and a
  successful resume exit in addition to exact-once and fingerprint convergence.
- T2 focused evidence: all 22 before/after boundary cases plus complete-matrix,
  missing-facts, unavailable-executable, and relative-entrypoint cases pass.
  Combined T71 unit/fault run is 49/49; lint, typecheck, format, and complexity
  pass.
- T2 crash-runner work committed as `ad8141b`.
- The contributor explicitly approved the CLI's use of existing internal
  workspace packages after confirming that no new external dependency or
  version is introduced. T3 uses `@verchestra/agent-runtime` and
  `@verchestra/effects`; the Driver dependency remains deferred until T5/T6.
- T3 composes the production Execution Package builder/store/verifier,
  Approval Service with signed approval artifacts, Context resolver/compiler,
  capability router, idempotent Effect Broker, Independent Verification
  Coordinator, Portable Handoff Coordinator, and Run Capsule
  builder/store/verifier against a disposable root.
- T3 focused evidence: 4/4 integration cases pass, including one-call effect
  idempotency, full Handoff continuation, portable Package/Capsule evidence,
  and semantic convergence across independent roots. Typecheck, lint, format,
  and complexity also pass.
- T3 successful full-path work committed as `1b047ad`.
- T4 adds the repository-owned full-scenario crash child and injects before and
  after hooks at all eleven application-owned durable boundaries. Package,
  approval, and Capsule signing keys live only inside the disposable root so a
  clean process can verify and reconcile the same artifact identities.
- Approval and Effect facts use the production SQLite runtime adapters. Task
  execution and gate commit use their production coordinators with
  deterministic local ports; package and Capsule use their production file
  stores. The boundary journal records observations and never decides the
  application verdict.
- T4 focused evidence: all 22 before/after production workflow cases converge
  after hard exit 86 with one logical boundary identity, and the complete
  matrix passes `assertDurableBoundaryFacts`. The combined T3/T4 run is 27/27;
  typecheck, lint, format, and complexity pass.
- T4 production crash convergence committed as `9345cb1`.
- T5 adds a composition-root Driver authority gate that compares the exact
  approved and displayed review surface before invoking a supplied provider
  boundary. Approval, capability, destination, cost, and egress mismatches all
  leave the callback untouched and report zero provider calls.
- A writer-shaped Tool is rejected by the application rule before the callback
  can run. T5 focused evidence is 6/6 security cases; typecheck, lint, format,
  and complexity pass.
- T5 Driver authority work committed as `9d72bca`.
- T6 adds the previously approved internal `@verchestra/drivers` workspace
  link and its missing package export; no external dependency or version was
  added. The composition root runs the qualified Claude Code, Codex, and
  OpenCode/Qwen adapters against repository-owned deterministic local
  substitutes.
- All three approved boundaries enter exactly once, emit normalized lifecycle
  events, expose only `vestra_read`, and run beneath the existing offline
  guard. The scenario also contains a denied path with zero calls and binds the
  displayed review byte-for-byte to the approved facts.
- T6 focused evidence: 5/5 integration cases and the 6 T5 security cases pass;
  typecheck, lint, format, and complexity pass.
- T6 qualified Driver scenario committed as `3518665`.
- T7 extends the installed manifest and command dispatch to the already sealed
  four-profile registry. `full` composes the successful workflow plus the
  complete child-process crash matrix before adding `full.crash-recovery`;
  `drivers` composes the approved Driver scenario.
- The real binary returns PASS with exactly 10 full checks and 7 Driver checks,
  while an unknown profile still fails before dispatch. T7 focused evidence is
  51/51 CLI contract/e2e cases; typecheck, lint, format, and complexity pass.
- T7 CLI behavior committed as `0d04112`.
- T8's complete fault suite initially killed the stale Driver isolation fixture:
  it still returned the pre-T71 empty check list. The fixture now returns the
  closed `DRIVER_CHECK_IDS` catalog while retaining its original test-only
  material assertion. The focused 10/10 file passes and the fix is committed as
  `f7a8354`.
- `pnpm gate:quick` passes: 1,862 unit cases and 112 readiness/architecture
  cases, with no skipped or todo cases.
- Direct substantive suites pass: `pnpm test:security` is 937/937 and
  `pnpm test:fault` is 283/283, both with zero skipped or todo cases.
- `pnpm test:release` declares zero cases until T73 (#14) and explicitly states
  that it is not release evidence.
- `pnpm gate:security` reaches the existing qualification sensors but cannot
  pass on this workstation: the installed Claude CLI is unavailable, Codex is
  not the pinned 0.115.0, Node is 24.18.0 instead of 24.14.0, and SQLite is
  3.53.1 instead of 3.51.2. No sensor was changed or weakened.
- `pnpm gate:full` reaches existing Windows-only integration failures in T69/T70
  fixture cleanup and quoted `git check-ignore` path expectations. These are
  outside the T71 patch; the substantive T71 security and fault suites pass.
- `pnpm gate:release` was not rerun because it shares the same qualification
  prerequisites already reported by `gate:security`; this work does not claim
  release evidence or release readiness.

# Decisions

- Use one new feature directory because T71 is a distinct roadmap task.
- Keep crash recovery as a `full` mode.
- Use a closed durable-boundary catalog and before/after child-process matrix.
- Exercise existing production stores/coordinators; an observational journal
  may record facts but must not become a parallel workflow implementation.
- Driver denial must occur before adapter construction/resolution and prove an
  exact zero provider-boundary count.
- Approved Driver paths use the real qualified adapter code with injected local
  deterministic process/SDK substitutes.
- Do not create a T71 qualification report from the authoring worktree;
  independent verification remains external.

# Next action

Run independent verification from a clean clone with the pinned Node, SQLite,
Claude CLI, and Codex versions. Then perform contributor review of the local
atomic commits. Do not push until the contributor explicitly authorizes it.

# Blockers

Local implementation and substantive tests are complete. The complete
qualification/release gates require the pinned external toolchain described
above. External push and PR creation intentionally wait for contributor review
and explicit authorization.
