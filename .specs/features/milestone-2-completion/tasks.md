# Feature Tasks — milestone-2-completion

Distributed execution plan for the 13 open issues of milestone 2, split into
three workstreams. Every task is delivered under root `AGENTS.md`: smallest
relevant test first, the applicable gate before review, one logical concern
per change, independent verification and human review before completion.

## Workstreams

| Workstream | Owner | Role | Issues |
| ---------- | ----- | ---- | ------ |
| WS-A | accd | Owner decisions, T75 remaining matrices, T76 prerequisites, release engineering, human review | #217, #218, #16, #35, #17, #18, #242, #243 |
| WS-B | MiguelCorre | Independent verification (T72, T74, T75 reports), install friction | #13, #15, #36 |
| WS-C | brunomjanuario | Hardening implementation, T73 report | #58, #110, #14, #207, #233 |

Author ≠ verifier (spec M2C-03): accd authored the T72–T74 implementations →
MiguelCorre authors t72/t74-validation.md and brunomjanuario authors
t73-validation.md; brunomjanuario authored F1a (#200) in T75 scope →
MiguelCorre authors t75-validation.md.

## Execution plan

| Task | Owner | Deliverable | Depends on | Verification | Commit |
| ---- | ----- | ----------- | ---------- | ------------ | ------ |
| B1 | MiguelCorre | `docs/qualification/t72-validation.md` + atomic chain advance to "T72 complete; T73 next" (#13) | None | Report contract; discrimination sensor on doctor verdicts; `pnpm gate:security`; `agent:context` derives T72 | `docs(qualification): qualify T72 and advance the chain` |
| C1 | brunomjanuario | Human review of PR #209 (canonical-json T4a) | None | Review recorded on the PR; accd merges after approval | — (review, no commit) |
| C3 | brunomjanuario | #110 closure: Site quality evidence at current main + corrected `lighthouse-performance-budget` handoff | None | `pnpm site:check` + CI Site quality PASS at 0.95; issue closed with run link | `docs(lighthouse-performance-budget): record closure evidence (#110)` |
| A1 | accd | AD in `.specs/STATE.md`: DSSE/in-toto vs proprietary (#217) | None | AD recorded before T76 starts; issue closed referencing the AD | `docs(specs): record the DSSE envelope decision (#217)` |
| A2 | accd | AD in `.specs/STATE.md`: context tokenizer strategy (#218) | None | AD recorded before T76 starts; issue closed referencing the AD | `docs(specs): record the tokenizer decision (#218)` |
| A3 | accd | T75 remaining matrices (topology, Driver, database incl. SAP ASE, sandbox, installer, recovery) + signed evidence index (#16) | None (fleet already green) | Matrix runs bound to exact revisions; `pnpm gate:security` per leg; evidence index verifies | Per-slice commits on `platform-qualification-matrix` |
| C2 | brunomjanuario | #58 completion: remaining compatibility-table rows on the canonical contract, cross-locale tests, discrimination sensor | C1 (builds on merged T4a) | Cross-locale byte-identity tests; sensor killed; `pnpm gate:security` | Per-slice commits on `canonical-json` |
| B4 | MiguelCorre | #36: `npx vestra` launcher (shape fixed by AD-016: new publishable npm bootstrap over TUF activation; single binary deferred post-1.0) running the portability demo from a clean machine | None (lands near T76) | Clean-machine demo evidence; `pnpm gate:build` | `feat(distribution): ship the npx launcher (#36)` |
| C6 | brunomjanuario | #233: publish the probe contract (7 connection ports + package `exports`) and parameterize the conformance kit (AD-017) | None; must land before B3 | All 7 kits accept a real implementation; no contract assertion reads fixture-private fields; `pnpm gate:security` | `feat(data-probe): publish the probe contract and conformance kit (#233)` |
| C5 | brunomjanuario | #207: seven presence-only doctor checks upgraded to live read-only observations | A3 (fixtures exist on provisioned machines) | Architecture guard still passes; probes report from real observations; exercised in the T75 matrix | Per-slice commits on `deep-doctor` follow-up |
| A4 | accd | #35 closure: live composed verifier session via `resolveVerifierDriver` in the T74/T75 composition roots | A3 | Evidence records the verifying driver identity; cross-driver case in the matrix | `feat(verification): compose the live independent verifier session (#35)` |
| C4 | brunomjanuario | `docs/qualification/t73-validation.md` + atomic advance (#14) | B1 | Report contract; distribution-not-single-score check; `pnpm gate:build` | `docs(qualification): qualify T73 and advance the chain` |
| B2 | MiguelCorre | `docs/qualification/t74-validation.md` + atomic advance (#15) | C4 | Report contract; isolation/contamination fault evidence; `pnpm gate:security` | `docs(qualification): qualify T74 and advance the chain` |
| B3 | MiguelCorre | `docs/qualification/t75-validation.md` + atomic advance + close #16 | B2, A3, A4, C5 | Report contract; full matrix + signed evidence index verified; macOS x64 recorded as environmental | `docs(qualification): qualify T75 and advance the chain` |
| A8 | accd | #242: migrate the signature envelope to DSSE + in-toto (AD-014 implementation, per `dsse-attestation/migration.md`) | A1 (decision, done) | `pnpm gate:security`; tamper suite covers every error code incl. `VES_ENVELOPE_UNSUPPORTED`; sensor incl. PAE domain separation | Per-step commits on `dsse-attestation` |
| A9 | accd | #243: ship the pinned context token estimator with manifest-recorded identity (AD-015 implementation) | A2 (decision, done) | `pnpm gate:security`; compile without an injected estimator uses the qualified default; one estimator across both surfaces | Per-slice commits on `context-tokenizers` |
| A5 | accd | T76 (#17): reproducible candidate release (SBOM, provenance, signatures, TUF, offline views, rollback) | B3, A8, A9, C2 | `pnpm gate:release`; independent closure verification on every platform | Per-slice commits on a T76 feature |
| A6 | accd | T77 (#18): final acceptance, signed promote-or-reject decision, milestone close | A5 + all other tasks complete | `pnpm gate:release`; independent final verifier (MiguelCorre); signed human decision | `docs(qualification): record the 1.0 acceptance decision` |
| A7 | accd | Continuous: human review + merge of every WS-B/WS-C PR; rebase merges; verify by content | Continuous | Every merge verified by content on `origin/main` | — |

## Phase map

```
Phase 1 (parallel, start now):   B1 · C1 · C3 · A1✓ · A2✓ · A3(in progress) · B4(start) · C6(start)
                                 A8(#242 DSSE) · A9(#243 estimator) — both unblocked by A1/A2
Phase 2 (after Phase 1 unblocks): C4(→B1) · C2(→C1) · C5(→A3) · A4(→A3) · B2(→C4)
Phase 3 (T75 closure):            B3(→B2,A3,A4,C5,C6)
Phase 4 (release):                A5(→B3,A8,A9,C2) → A6(→A5, backlog-zero)
Continuous:                       A7
Critical path: B1 → C4 → B2 → B3 → A5 → A6
```

A8 and A9 were filed on 2026-08-09 to close a tracking gap: AD-014 and AD-015
both require their implementation before T76 starts, but the decision issues
(#217, #218) closed with the decisions and nothing carried the work. Untracked
mandatory work breaks the milestone's own "100% equals backlog-zero" claim, so
the issues exist to restore it — this is not new scope.

## Gate commands

| Level | Command | Used by |
| ----- | ------- | ------- |
| Quick | `pnpm gate:quick` | Every doc/spec change before review |
| Full | `pnpm gate:full` | Cross-cutting code changes (C2, C5, A4) |
| Build | `pnpm gate:build` | B4, C4 (T73 verification command) |
| Security | `pnpm gate:security` | B1, B2, B3, A3, C2 (chain and trust surfaces) |
| Release | `pnpm gate:release` | A5, A6 |
| Site | `pnpm site:check` / `site:test` / `site:build` | C3 |

## Test coverage matrix

| Layer | Requirement outcomes and edge cases | Evidence |
| ----- | ----------------------------------- | -------- |
| Qualification reports (B1, C4, B2, B3) | Every AC of the task's issue mapped to exact assertions; discrimination sensor run and killed; report bound to a main-reachable revision under `docs/qualification/REPORT-CONTRACT.md` | `docs/qualification/t7N-validation.md` + externally dispatched gate runs |
| Derived status surfaces (chain advances) | All surfaces + pinned contract tests migrate in the same change; `agent:context` derives the new position | The advance commit diff + `corepack pnpm agent:context` |
| Trust/digest code (C2) | Cross-locale byte-identity; Unicode/numeric/undefined/sparse/cycle/depth edge cases identical at every call site; ambient-locale sensor killed | `tests/` suites named in #58 + `pnpm gate:security` |
| Doctor probes (C5) | Read-only observation per probe; `blocked` honesty in source mode; no mutable/paid adapter reachable | `tests/architecture/doctor-readonly-graph.test.mjs` + matrix runs |
| Verifier composition (A4) | Distinct-driver enforcement live; zero-tool grant; driver identity in evidence | Cross-driver matrix case + verification report schema v2 |
| Platform matrices (A3) | Zero skipped required case; failures fixed without weakening shared contracts | Matrix run IDs + signed evidence index |
| Release closure (A5, A6) | Fail-closed on malicious/missing/expired/rollback/mixed artifacts; offline = online closure | `pnpm gate:release` + T76/T77 evidence |
| Site (C3) | Lighthouse ≥ 0.95 preserved (never relaxed) | CI Site quality run at current main |

## Requirement traceability

| Task | Requirement IDs | Issues |
| ---- | --------------- | ------ |
| B1 | M2C-03, M2C-04, M2C-05 | #13 |
| C4 | M2C-03, M2C-04, M2C-05 | #14 |
| B2 | M2C-03, M2C-04, M2C-05 | #15 |
| B3 | M2C-03, M2C-04, M2C-05 | #16 |
| A3 | M2C-05 | #16 |
| A4 | M2C-05 | #35 |
| C2 | M2C-05 | #58 |
| C3 | M2C-05 | #110 |
| C5 | M2C-05 | #207 |
| A1 | M2C-05, M2C-08 | #217 |
| A2 | M2C-05, M2C-08 | #218 |
| B4 | M2C-05 | #36 |
| C6 | M2C-05 | #233 |
| A8 | M2C-05 | #242 |
| A9 | M2C-05 | #243 |
| A5 | M2C-05 | #17 |
| A6 | M2C-04, M2C-05 | #18 |
| A7 | M2C-06 | all |

Milestone/assignee recomposition (M2C-01, M2C-02) and AD-013 (M2C-08) were
applied on 2026-08-09 as part of landing this programme. Work packages
(M2C-07) are delivered off-repository to the two contributors.

## Completion rules

- One task, one passing gate, one atomic commit (reports: the report and its
  chain advance are one atomic change).
- Tests assert specification outcomes and are never weakened, deleted, or
  skipped to obtain a pass; thresholds (Lighthouse 0.95 included) never
  relax without a recorded human policy change.
- Chain-advance status surfaces are touched only by qualification-report
  PRs, serially; coordinate via the in-flight scope log before any push;
  never force-push; verify every merge by content on `origin/main`.
- Update `handoff.md` after every task; independent verification and human
  review are required before completion.

## Execution evidence

| Task | Status | Commit |
| ---- | ------ | ------ |
| B1 | Planned | Pending |
| C1 | Planned | Pending |
| C3 | Planned | Pending |
| A1 | **Done** (AD-014, #217 closed) | `3f97047` (PR #228) |
| A2 | **Done** (AD-015, #218 closed) | `3f97047` (PR #228) |
| A3 | In progress — matrix spec (PR #229), M-2 evidence index (PR #230), F5 fix fleet-proven (PR #231), D1/D2 decided (AD-017); remaining: M-3, M-4, green 4-profile re-dispatch, evidence index signing | `3264700`, `bb04531`, `9060f7f` |
| C6 | Planned | Pending |
| C2 | Planned | Pending |
| B4 | In review - T1 verified active-launcher bridge complete; T2-T4 blocked by T76-owned executable/trust inputs and npm/build decisions | `bfab603`, `fde66de` (PR #249) |
| C5 | Planned | Pending |
| A4 | Planned | Pending |
| C4 | Planned | Pending |
| B2 | Planned | Pending |
| B3 | Planned | Pending |
| A5 | Planned | Pending |
| A6 | Planned | Pending |
| A7 | Continuous | — |
