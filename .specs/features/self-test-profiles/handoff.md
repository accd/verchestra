---
schema: verchestra-feature-handoff/v1
feature: self-test-profiles
issue: 11
status: planned
branch: feat/t70-self-test-profiles
baseRevision: b5473f6ee37116f6c58c0489d1a54af369982595
lastCompletedTask: T6
nextTask: T7
lastGate: pnpm test:unit (1830/1830), pnpm test:contract (446/446)
updatedAt: 2026-08-02T03:30:00Z
---

# Scope

T70 (#11): give the T69 Self-Test trust domain real `smoke` and `workspace`
scenarios, ≥25 combined black-box checks, PRF-01–PRF-07 from
`.specs/features/self-test-profiles/spec.md`. Extends the three AD-010
places only; adds a `self-test` CLI command.

# Completed Evidence

T1: `ScenarioCheck`, `semanticFingerprint`, `assertProfileCoverage`,
`assertConvergence`, `requiredCheckIds` on `SelfTestProfile`,
`SMOKE_CHECK_IDS` (6 ids), `WORKSPACE_CHECK_IDS` (25 ids: five shapes ×
placement/init/bootstrap/sync/reconcile), and three new error codes
(`VES_SELFTEST_SCENARIO_MISSING`, `VES_SELFTEST_NONCONVERGENT`,
`VES_SELFTEST_NETWORK_ATTEMPT`) added to
`packages/application/src/self-test/self-test.ts`. Coverage is asserted
inside `SelfTestOrchestrator.run` after cleanup, before payload sealing.
12 new unit cases in `tests/unit/self-test-scenario-rules.test.mjs`. Updated
T69 test doubles in `tests/unit/self-test-rules.test.mjs`,
`tests/security/self-test-escape.test.mjs`, and
`tests/fault-injection/self-test-composition-faults.test.mjs` to supply the
now-required `SubjectRunFacts.checks` field (additive fixture maintenance,
no assertion weakened). `pnpm test:unit` (1830 cases), `pnpm typecheck`,
`pnpm lint`, `pnpm complexity:check`, `pnpm format:check` all PASS.

One pre-existing, unrelated failure observed and left alone:
`tests/security/self-test-escape.test.mjs:35` ("a link-like ancestor into
guarded state...") fails on this macOS environment before and after this
change (`/tmp` vs `/private/tmp` symlink-chain ordering) — confirmed via
`git stash`.

T2: `GitFixtureFactory` in `packages/self-test/src/git-fixtures.ts`.
Provisions all five shapes as real `git init` repositories under the T69
disposable root, each shape scoped to its own subdirectory so repeated
`provision()` calls from one factory never contaminate one another (a real
bug caught by sanity-checking against `scanWorkspace` directly and fixed
before commit — see Decisions). Hermetic Git env (`GIT_CONFIG_NOSYSTEM`,
isolated `HOME`, no terminal prompt/askpass). File writes route through the
existing T69 `BoundedFixtureFactory`, so the escape guard and byte budget
apply unchanged. 10 integration cases in
`tests/integration/self-test-git-fixtures.test.mjs`, including one asserting
cross-shape isolation. Verified against the real
`@verchestra/workspace` `scanWorkspace` (ad hoc script, not committed):
standalone → one root Project; colocated/centralized → root + `projects/widget`
Project, both owned by the control repo; nested → root + independently
Git-owned `projects/service`, not ignored; ignored → same but
`ignoredByControl: true` on both the repository and the Project.
`pnpm typecheck`, `lint`, `complexity:check`, `format:check` all PASS.
`test:integration` run scoped to non-SQLite suites plus the new file (80/80
pass) — this environment's Node v23.11 vs. the pinned v24.14 `node:sqlite`
binding is unrelated and pre-existing (confirmed via `git stash` before
touching T2).

T3: `offlineGuard()` in `packages/self-test/src/network-guard.ts` monkeypatches
`net.Socket.prototype.connect`, `http.request`, `https.request`, and
`globalThis.fetch` for its scope; every attempt is **blocked** (throws
immediately, never actually dials out — important so a stray call can't hang
in a sandboxed CI runner) and recorded as a `NetworkAttempt` fact.
`assertNoNetworkAttempts` (application) fails closed with
`VES_SELFTEST_NETWORK_ATTEMPT`, naming every attempted api/target, if the
list is non-empty. 6 fault-injection cases in
`tests/fault-injection/self-test-network-guard-faults.test.mjs` cover
net/http/fetch interception, restoration (including after a thrown
scenario), and the assertion's zero/non-zero paths.
`typecheck`/`lint`/`complexity:check`/`format:check` all PASS with no `any`
needed (native overload args typed as `readonly unknown[]`).
`pnpm test:unit` (1830/1830) and `pnpm test:fault` scoped to non-sqlite
suites both green; two more pre-existing sqlite-native-binding failures
found and confirmed unrelated via `git stash`
(`runtime-store-faults.test.mjs`, `effect-kernel-faults.test.mjs` — same
Node v23.11 vs. pinned v24.14 `node:sqlite` issue as T2's finding).

T4: `createSmokeScenario()` implemented directly inside
`apps/vestra-cli/src/self-test-composition.ts` (see Decisions — not a new
`self-test-scenarios.ts` file, to honor AD-010's "only place" literally).
Refactored `main.ts` to extract `createCommandBus(controlRoot)`, exported,
so the scenario drives the *exact* production controller path (`runCli` +
the real command bus) against a disposable root instead of duplicating that
logic. Produces all 6 `SMOKE_CHECK_IDS`: `--help`, `--version`,
`init --dry-run` preview, a zero-writes proof (`workingTreeSnapshot`
excluding `.git`), an invalid-argument case, and an unknown-command case.
Wrapped in `offlineGuard()` as a PRF-01 backstop. Added a fourth error code,
`VES_SELFTEST_SCENARIO_CHECK_FAILED` (a check that ran and asserted false,
distinct from `VES_SELFTEST_SCENARIO_MISSING`'s "never produced" case), and
registered all four T70 codes (`NETWORK_ATTEMPT`, `NONCONVERGENT`,
`SCENARIO_CHECK_FAILED`, `SCENARIO_MISSING`) in `SELF_TEST_FAILURE_CODES`.

Debugging note: the first `init --dry-run` invocation failed with
`VES_INIT_INPUT_INVALID` — the scenario's workspace id
(`workspace_self-test-smoke`) wasn't a canonical UUID v4/v7, which
`StableId.parse` requires. Fixed using the same literal UUID the T69/T20 e2e
fixtures already use (`workspace_018f0b6d-7b1a-7abc-8def-0123456789ab`).

3 integration cases in `tests/integration/self-test-smoke-scenario.test.mjs`:
full coverage with all-pass checks, zero network attempts, and convergence
across two independent runs. `typecheck`/`lint`/`complexity:check`/
`format:check` all PASS. `pnpm test:unit` 1830/1830. Ran the full T69+T70
self-test suite plus `cli-surface.test.mjs` and `safe-init-e2e.test.mjs`
(119/119, excluding two already-known pre-existing environment flakes: the
macOS symlink-ordering one from T2's handoff note, and a Node v23 vs.
pinned v24 stderr `ExperimentalWarning: Type Stripping` line that fails two
unrelated `cli-launchers-e2e.test.mjs` stderr-emptiness assertions —
confirmed via `git stash` before touching T4).

T5: `createWorkspaceScenario()` appended to `self-test-composition.ts`,
same pattern as T4. Per shape (5), five checks: `placement` via real
`scanWorkspace` against `EXPECTED_INVENTORY` (project count + which project,
if any, is `ignoredByControl`); `init` via the same `invokeCli`/
`createCommandBus` helper T4 built; `bootstrap` via `MachineBootstrapService`
with an empty discovery/secrets stub (no live driver or paid model call —
`roles` needs at least one entry, `validateConfig` fails closed on `[]`, so a
single `independence:"none"` role with zero discovered candidates is used —
a deterministic, always-completing outcome, not a live check); `sync` and
`reconcile` via `WorkspaceReconcileService` with an in-memory
`SelfTestSyncStore`, calling `execute()` twice (fresh state, then a bumped
`release` generation) and asserting the second call surfaces a
`localRebuildRequirements` entry. Extracted `pushCheck`/`finalizeScenario`
helpers shared with T4's smoke scenario (was duplicated inline before this
refactor).

Two real integration bugs found and fixed during this task, not left as
"future work":
1. `MachineBootstrapService.execute` throws `VES_BOOTSTRAP_INPUT_INVALID`
   ("Role requirements are invalid") on `roles: []` — `validateConfig`
   requires at least one role. Fixed by adding one minimal role.
2. (Carried from T4, reused here) workspace ids must be canonical UUID
   v4/v7 strings, not arbitrary text.

25 `WORKSPACE_CHECK_IDS` all produced and passing; combined with smoke's 6,
31 total checks (issue requires ≥25). Measured wall-clock ~800ms per full
five-shape run — three orders of magnitude under the workspace profile's
600,000ms budget. 4 integration cases in
`tests/integration/self-test-workspace-scenario.test.mjs`.
`typecheck`/`lint`/`complexity:check`/`format:check` all PASS. Ran the full
T69+T70 self-test/CLI suite (126/126), `pnpm test:unit` (1830/1830), and
`pnpm test:contract` (446/446) — no regressions from the `main.ts` extraction
or the new `@verchestra/workspace` import in the composition root.

T6: `vestra self-test --profile smoke|workspace` is live. `release-manifest.ts`
declares the command (`profile` string option, `values: ["smoke","workspace"]`,
`supportsJson: true`, `mutating: false`). `main.ts` special-cases `"self-test"`
in the command bus it builds (not inside `createCommandBus`, which stays
`init`-only and is shared with the trust domain's own `invokeCli` calls) and
delegates all TEST-ONLY construction to a new
`runSelfTestProfile(profileId, { controlRoot })` in `self-test-composition.ts`
— main.ts itself no longer imports `@verchestra/evidence` or
`@verchestra/self-test` directly, keeping AD-010's "nowhere else" literal.
Note: this makes `main.ts` and `self-test-composition.ts` mutually
importing (`main.ts` → `runSelfTestProfile`, `self-test-composition.ts` →
`createCommandBus`); both references are used only inside function bodies
called later, never at module-eval time, so the ESM cycle resolves fine —
verified by the real binary running correctly, not just by typecheck.

Exit contract: PASS → exit 0 with the sealed payload as `data`. FAIL or a
thrown `SelfTestError`/`SelfTestComposition` failure → `PublicErrorException`
wrapping `VES_CLI_COMMAND_FAILED` (exit 5, existing `cli-errors.ts`
convention) — no new public error code added; AC6 only requires the
non-PASS exit to be non-zero, not a third value distinguishing FAIL from a
run that never completed. Missing/invalid `--profile` fails via the
manifest's own enum validation → `VES_CLI_ARGUMENT_INVALID` (exit 2).

`tests/contract/cli-surface.test.mjs:71` updated to assert
`["init", "self-test"]` and the `self-test` command's `["profile"]` option
list — exact and closed, not weakened. `tests/e2e/cli-launchers-e2e.test.mjs`'s
literal `--help` output string updated to include the new command line
(verified byte-for-byte against the real binary's output before writing the
assertion, not guessed).

**Real bug found and worked around (not fixed — flagged for follow-up,
Decisions below): T69's `assertDisjointRoot`/`collectLinkChain` false-positives
an overlap** whenever the guarded root and the candidate disposable root
share `os.tmpdir()` as an ancestor on macOS. `os.tmpdir()` resolves through
the system symlink `/var` → `/private/var`; `collectLinkChain` walks every
path ancestor and records that hop as a candidate-side fact; `overlapReason`
then does a naive string-prefix `pathContains` check against the *bare*
`"/var"` entry, which trivially prefixes every guarded root also under
`/var/folders/...`. This only manifests when both roots share that tmp
ancestor — real users invoking `vestra self-test` from a normal project
directory (`/Users/...`) are unaffected, since only the self-test disposable
root sits under `/var/folders`, not the guarded root too. First discovered
when the e2e test used `os.tmpdir()`-based fixtures (same pattern as
`tests/helpers/workspace-scanner-fixture.mjs`) and every real-binary
invocation returned `VES_CLI_COMMAND_FAILED`. Worked around by placing e2e
fixtures under the repository's own scratch directory instead
(`tests/e2e/self-test-cli-e2e.test.mjs`'s `repositoryRoot()`), which the 5
new e2e cases confirm passes.

5 e2e cases confirm the exit contract, ≥25-check workspace verdict, and
byte-identical invoking repository. `typecheck`/`lint`/`complexity:check`/
`format:check` all PASS. Full self-test/CLI suite 128/128,
`pnpm test:unit` 1830/1830, `pnpm test:contract` 446/446. Manually verified
the real binary (`node apps/vestra-cli/bin/vestra.mjs self-test --profile
smoke|workspace`, human and `--output json`) before writing any assertion.

# Next Exact Action

T7 (qualification): (1) write a convergence proof — run each profile twice
against fresh disposable roots and assert `semanticFingerprint` identical
(PRF-04), probably as a new integration test rather than reusing the
existing per-run tests; (2) run the discrimination sensor per the skill's
Verifier step — inject faults into T1–T6's new logic in scratch state,
confirm the test suites kill them; (3) dispatch `pnpm gate:full` plus every
gate `scripts/gate-selection.mjs` selects for the changed paths (expect
`quick`, `full`, `build`, `security`, `release` — confirm exactly, this repo
declares `gate:full` in the issue but the path-based selector may require
more); (4) write `docs/qualification/t70-validation.md` binding the
implementation revision, gate results, and requirement-to-evidence mapping,
following the `t69-validation.md` precedent; (5) update `.specs/STATE.md`
Handoff section and `ROADMAP.md`'s derived-counter language once T70 has its
report. Run `pnpm gate:full` at minimum before writing the report.

# Blockers

None for T70. One follow-up candidate for a separate task (not blocking):
T69's `assertDisjointRoot`/`collectLinkChain` false-positives an overlap on
macOS when the guarded root and the disposable root share `os.tmpdir()` as
an ancestor (see T6 evidence above for the exact mechanism). Does not affect
real usage from a normal project directory; does affect any future test or
tooling that provisions both a guarded root and a self-test disposable root
under `os.tmpdir()`. A fix would touch T69-sealed
`packages/application/src/self-test/self-test.ts` and
`packages/self-test/src/disposable-roots.ts` and should go through
independent review rather than be folded into T70.

# Decisions

- Workspace shapes map to `@verchestra/workspace` concepts, not new
  vocabulary: standalone = control root is the only Project; colocated /
  centralized = control root + one marker-only `projects/widget` Project
  (both physically identical Git topology — the colocated/centralized
  distinction is a `PlacementSnapshot` config choice made by the T5
  scenario, not a fixture-level difference); nested = an independently
  Git-initialized, non-ignored `projects/service`; ignored = the same but
  listed in the control root's `.gitignore`.
- `GitFixtureFactory.provision()` scopes every shape to its own
  subdirectory (`<root>/<shape>/...`) rather than reusing the disposable
  root directly for each shape — the first implementation reused the root
  and silently layered shapes on top of each other, only caught by an ad
  hoc `scanWorkspace` sanity check, not by the first draft of the
  integration tests. A regression test now asserts cross-shape isolation
  directly.
- Per-check detail (`ScenarioCheck[]`) rides outside the sealed
  `SelfTestReportPayload` — a new field on `SubjectRunFacts`, not a report
  field — so PRF-06 (sealed allowlist unchanged) holds without a new report
  schema.
- T70 adds a `vestra self-test` command (design.md D1): AC5's "black-box"
  language and the issue's "production CLI" scope point to spawning the real
  binary, matching the precedent in `tests/e2e/cli-launchers-e2e.test.mjs`.
- Scenario content lives inside the existing, sealed
  `apps/vestra-cli/src/self-test-composition.ts`, not in a new
  `self-test-scenarios.ts` as design.md originally sketched. AD-010 in
  `.specs/STATE.md` says construction of TEST-ONLY sibling adapters happens
  "here, in the composition root, and nowhere else" — the design.md draft
  written before implementation started would have put scenario content
  (which imports `@verchestra/workspace` directly) in a second file,
  contradicting that sealed decision's literal wording. Appending to the
  existing file honors it without needing to reopen or amend AD-010.
  `main.ts` was refactored to extract `createCommandBus(controlRoot)` so the
  smoke scenario reuses the exact production controller path instead of
  duplicating it — `main()`'s own behavior is unchanged (still calls
  `createCommandBus(process.cwd())`).
- New spec directory `self-test-profiles`, sibling to the completed
  `self-test` (T69) directory, following the T68a–T68d one-dir-per-task
  precedent.

# Files Intentionally Left Unchanged

- `.specs/features/self-test/` (T69) stays as completed evidence; not
  reopened.
- `packages/application/src/self-test/self-test.ts`'s `PROFILES` id set,
  `SelfTestOrchestrator.run`, and the sealed report field list are extended
  additively only (`requiredCheckIds`), never restructured — T69's
  qualified control flow is unchanged.
