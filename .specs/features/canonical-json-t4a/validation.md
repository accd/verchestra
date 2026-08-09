# Canonical JSON T4a Validation

**Date**: 2026-08-09
**Spec**: `.specs/features/canonical-json-t4a/spec.md`
**Diff range**: `upstream/main..HEAD` (9 commits: `b92dd7d`..`282754e`), base `f1c72a0`
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Verdict: PASS

All 11 acceptance criteria are genuinely met. Test counts match the handoff
exactly. One documentation-accuracy issue was found and is not a code defect:
the handoff's claim of "6 pre-existing typecheck errors" does not reproduce
under a correct `pnpm install` — see Gap 1.

---

## Spec-Anchored Acceptance Criteria

| ID | Requirement | Evidence checked | Result |
| --- | --- | --- | --- |
| CJ4-01 | Matrix refreshed, new owners classified | `docs/canonical-json-compatibility.md` diff (commit `bea7fbc`) adds 4 T4a owner rows + T4-slice ordering table + the newly-discovered `execution-package.ts` 11-site gap (correctly deferred to T4i, not silently dropped) | PASS |
| CJ4-02 | One authority produces `v2:sha256:`, no adapter coupling, no new dep | `packages/domain/src/canonical/canonical-digest.ts` — `formatCanonicalDigestV2`, pure regex validation, only imports `DomainValueError`; `scanner-primitives.ts` refactored to call it (`git diff` confirms `createHash(...).digest("hex")` piped through the shared formatter, same bytes); `tests/architecture` still 19/19 (no new third-party/adapter import) | PASS |
| CJ4-03 | `canonicalizeOracle`/`blocks` use V2 code-unit order; digests locale-independent | `promotion-gate.ts` diff: `JSON.stringify(...sort(localeCompare))` replaced by `canonicalizeJsonV2(...normalizeDeclaredSet(...))` for both `canonicalizeOracle` entries and `evaluatePromotion` blocks | PASS |
| CJ4-04 | Campaign ordering V2 + declared-set normalization | `campaigns.ts` diff: `buildCampaignSummary`'s `.sort(localeCompare)` replaced with `normalizeDeclaredSet(results, r => r.id)`; `canonicalizeCorpus` (the real `corpusDigest` input) confirmed to have no locale-dependent sort already, so it needed no change | PASS |
| CJ4-05 | Doctor report ordering V2 code-unit | `doctor.ts` diff: `sortedUnique` now delegates to `normalizeDeclaredSet` instead of `.sort(localeCompare)` | PASS |
| CJ4-06 | `self-test.ts:292` classified and resolved | `semanticFingerprint` migrated to `normalizeDeclaredSet`; comment correctly classifies it as presentation (not itself a digest input — `assertConvergence` compares arrays directly) but migrates it anyway for cross-run convergence portability, which is a defensible reading of "classified; migrated if digest input, or asserted presentation-only with a test proving it reaches no digest" — the code comment IS that proof-of-classification | PASS |
| CJ4-07 | Byte-identical cross-locale output per owner | Present in `tests/unit/promotion-gate.test.mjs`, `regression-campaigns.test.mjs`, `doctor-rules.test.mjs`, `self-test-scenario-rules.test.mjs` (LANG/LC_ALL toggle tests); confirmed executed and passing under `pnpm test:unit` (1975/1975) | PASS |
| CJ4-08 | No persisted/qualified fixture changed bytes | Searched `tests/` for literal pinned digests near the four owners: `promotion-gate.test.mjs` and `regression-campaigns.test.mjs` build digests via `sha(canonicalizeOracle(...))`/computed helpers, not literal strings. The only literal `sha256:`-style pins found repo-wide (`workspace-fingerprint-v2.test.mjs`, `safe-init*`, `database-knowledge.test.mjs`, `docs/proof/execution-package.*`) belong to unrelated owners (workspace scanner V1/V2, execution-package — explicitly out of scope), and none of those pinned literal values changed in this diff (confirmed no changes to those files in `git diff --stat`) | PASS |
| CJ4-09 | Discrimination mutation per owner, killed | `node --test tests/security/canonical-json-sensor.test.mjs` → 7/7 pass. Read mutation A, B (dynamic, disposable-module import, real behavioral divergence: `{Z:1,a:2}` vs locale order) and mutation C (dynamic mutant of `normalizeDeclaredSet`, asserts `["a","Z"]` order flips under `localeCompare`) — all genuine, not tautological. The 4 per-owner mutations are static text-presence checks (source lacks `.localeCompare(`, reverted text would contain it) — weaker than a dynamic kill but honestly self-disclosed in the test file's own comment as necessary because realistic call data (lowercase-only IDs, closed catalogs) cannot reach the divergence dynamically | PASS |
| CJ4-10 | Regression sensor fails build on new locale sort | `node --test tests/security/canonical-json-locale-allowlist.test.mjs` → 5/5 pass, including two mutation tests ("a new localeCompare in an untracked file is caught", "exceeding a tracked owner's ceiling is caught") that prove fail-closed behavior, not just presence of the sensor | PASS |
| CJ4-11 | Gates pass, no assertion weakened | See Gate Check below — all counts reproduced independently and match the handoff exactly | PASS |

---

## Gate Check (independently run, not copied from handoff)

| Command | Handoff claim | Observed |
| --- | --- | --- |
| `pnpm test:unit` | 1975/1975 | 1975/1975 ✅ |
| `pnpm test:contract` | 483/483 | 483/483 ✅ |
| `pnpm test:architecture` | 19/19 | 19/19 ✅ |
| `pnpm test:release` | 28/28 | 28/28 ✅ |
| `pnpm test:security` | 947/958 (11 pre-existing) | 947/958, same 11 failing test names ✅ |
| `npx tsc --noEmit` | "6 pre-existing errors" | 0 errors after a correct `pnpm install --frozen-lockfile` — see Gap 1 |

### Pre-existing-failure sanity check (CJ4-11, "no regression introduced")

Used `git worktree add /tmp/verchestra-baseline upstream/main` (base commit
`f1c72a0`) instead of `git stash` (branch has no uncommitted changes — all 9
commits are already committed) to get a true baseline without touching the
working branch.

- `pnpm test:security` on baseline: 937/948 pass, same **11** failing test
  names, byte-identical error messages/stack traces (`cedar-policy.test.mjs`,
  `memory-lifecycle-security.test.mjs` ×6, `sqlite-probe-adapter.test.mjs`).
  Branch adds 10 new security tests (T3/T8's sensors), accounting for the
  948→958 total delta. **Confirmed pre-existing, unrelated to T4a.**
- `npx tsc --noEmit` on baseline: 0 errors, exit 0.
- `npx tsc --noEmit` on the branch working directory: initially showed 6
  errors (`@verchestra/drivers`/`agent-runtime`/`effects` module-not-found +
  4 implicit-any). Root-caused to a **stale local `node_modules`** in this
  session's working directory — `apps/vestra-cli/node_modules/@verchestra/`
  was missing the `drivers`/`agent-runtime`/`effects` symlinks present in a
  fresh install. After `corepack pnpm install --frozen-lockfile` in the
  branch working directory, `npx tsc --noEmit` passed with **0 errors**.

**Gap 1 (documentation accuracy, non-blocking)**: the handoff/spec.md
attribute the 6 typecheck errors to "local Node 23.11.0 vs qualified
24.14.0" and claim they're `git stash`-confirmed byte-identical pre-existing
errors. That diagnosis does not hold up: a fresh worktree at the same Node
version (23.11.0) typechecks clean, and reinstalling dependencies in the
original branch directory also clears the errors. The actual cause was an
incomplete local `node_modules` state, not a Node-version qualification gap.
This does not affect the verdict — after a correct install, both the base
and the branch typecheck clean, so **no typecheck regression exists either
way** — but the specific root-cause claim in the handoff is inaccurate and
should be corrected (either fixed or dropped) before it's cited again for a
future slice.

---

## Scope Check

`git diff upstream/main...HEAD --stat`: 19 files changed, all justified:

- 3 spec/tasks/handoff files (`.specs/features/canonical-json-t4a/`)
- `docs/canonical-json-compatibility.md` (T2)
- 4 owner files: `doctor.ts`, `promotion-gate.ts`, `campaigns.ts`, `self-test.ts`
- `packages/domain/src/canonical/canonical-digest.ts` (new, T1)
- `packages/domain/src/index.ts` (+1 line, re-export the new module)
- `packages/domain/src/primitives/errors.ts` (+1 line, new `VES_DIGEST_V2_INVALID` code used by the new formatter)
- `packages/workspace/src/scanner/scanner-primitives.ts` (4 lines — refactored `buildInventoryFingerprintV2` to call the shared formatter instead of re-deriving the prefix; not a new owner migration, matches CJ4-02's "sole authority" requirement)
- 5 new/extended test files under `tests/unit/` and `tests/security/`

No unexplained files. The `scanner-primitives.ts` and `errors.ts`/`index.ts`
touches are in-scope support for CJ4-02, not scope creep.

---

## Discrimination Sensor Detail

| Sensor | Mutations | Genuine? |
| --- | --- | --- |
| `canonical-json-sensor.test.mjs` mutation A | `.sort()` → `.sort(localeCompare)` in a disposable copy of `canonical-json.ts` | Dynamic import, real output divergence (`{"a":2,"Z":1}` vs `{"Z":1,"a":2}`) — genuine |
| mutation B | array-preserving encode → sorted encode | Dynamic, `[2,1]` collapses to `"[1,2]"` vs staying `"[2,1]"` — genuine |
| mutation C | `normalizeDeclaredSet`'s code-unit compare → `localeCompare` | Dynamic mutant module, `["a","Z"]` order assertion — genuine, and its own comment correctly explains why this is needed (owner APIs enforce lowercase-only/closed-catalog inputs that can't reach the divergence through realistic call data) |
| 4 per-owner mutations | revert each owner's migrated call site to the pre-T4a text, assert current source lacks it / reverted text has it | Static/textual, not tautological (reads live file content each run), self-disclosed as static in the test's own comment; acceptable given the constraint above |
| `canonical-json-locale-allowlist.test.mjs` | ceiling-exceeded mutation, new-file mutation | Both genuinely fail-closed (constructs a mutated source string, asserts the sensor's own logic flags it) |

`node --test tests/security/canonical-json-sensor.test.mjs`: 7/7 pass.
`node --test tests/security/canonical-json-locale-allowlist.test.mjs`: 5/5 pass.

---

## Gaps Found

1. **(Low, documentation-only)** Handoff/spec.md's root-cause claim for the 6
   local typecheck errors ("local Node 23.11.0 vs qualified 24.14.0") is
   incorrect — the actual cause was a stale local `node_modules`, and a clean
   install typechecks 0 errors at the same Node version, on both base and
   branch. Does not affect the PASS verdict (no regression either way) but
   should not be re-cited as a Node-version gap in a future slice's handoff.

No other gaps found. Requirement coverage, gate counts, scope, and
discrimination-sensor genuineness all independently reproduce.
