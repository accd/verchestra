# Canonical JSON (T3 slice) Validation

**Date**: 2026-08-01
**Spec**: `.specs/features/canonical-json/spec.md`
**Diff range**: `b31bc19..bdf85bb` (13 commits: `3031d66`..`bdf85bb`, `661a5d6` docs-only status update skipped)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status     | Notes   |
| ---- | ---------- | ------- |
| T1   | ✅ Done    | `packages/contracts/src/canonical-json.ts`; 6 contract tests pass. |
| T2   | ✅ Done    | `packages/domain/src/canonical/canonical-json.ts`; RFC 8785 vectors pass, code-unit ordering, array-order preservation, cross-locale byte equality all proven. |
| T3   | ✅ Done    | `canonical-guard.ts`; all 9 rejection codes + resource limits tested. |
| T4   | ✅ Done    | Architecture boundary test extended; confirmed rule still fires for a canonicalize/node:crypto import. |
| T5   | ✅ Done    | `buildInventoryFingerprintV2` added; V1 byte-identical (diffed against `b94eef4`). |
| T6   | ✅ Done    | `normalizeDeclaredSet`; code-unit-vs-locale divergence proven (`"B".localeCompare("a")` vs code-unit order). |
| T7   | ✅ Done    | All 4 scanner localeCompare sites replaced with `normalizeDeclaredSet`. |
| T8   | ⚠️ Partial | Functionally complete (planId is V2, code-unit ordering proven), **but its own "Done when" criterion ("Existing `tests/unit/artifact-placement.test.mjs` passes unmodified") was violated** — the pre-existing assertion at that file's "WritePlan is deterministic and content-addressed" test was changed from `/^sha256:.../ ` to `/^v2:sha256:.../`. This change is legitimate (same category as the two changes the owner did approve) but is undisclosed in `handoff.md`'s Decisions section and in `spec.md`'s CJ-12 evidence text, which both claim only "two" pre-existing regex updates. See Gap 1 below. |
| T9   | ✅ Done    | Journal write path emits `schemaVersion: 2` / `v2:sha256:` planId; locale sorts replaced. |
| T10  | ✅ Done    | Version-dispatch verified by direct fault injection (see Discrimination Sensor, Mutation 3). |
| T11  | ✅ Done    | Sensor present in `tests/security/`, confirmed executed by `pnpm test:security`. |
| T12  | ✅ Done    | `docs/canonical-json-compatibility.md` corrected; names the actual architecture-rule blocker. |
| T13  | ✅ Done    | AD-009 added to `.specs/STATE.md`; pre-existing `## Handoff` section for `external-review-triage` confirmed byte-for-byte unchanged (`git diff b31bc19..HEAD -- .specs/STATE.md` shows only an AD-009 insertion). |

---

## Spec-Anchored Acceptance Criteria

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| CJ-01: one versioned V2 contract in `packages/contracts` | `CANONICAL_JSON_V2 === "v2"`, `CanonicalJsonVersion` union, `parseCanonicalJsonVersion` | `packages/contracts/src/canonical-json.ts:1-12`; `tests/contract/canonical-json-contract.test.mjs:7-24` — `assert.equal(CANONICAL_JSON_V2, "v2")`, throws for unknown prefix | ✅ PASS |
| CJ-02: V2 encoder has zero third-party / zero `node:` imports | `inspectSource("domain", …)` returns `[]` for every `canonical/*.ts` file | `tests/architecture/repository-boundaries.test.mjs:85-94` — `assert.deepEqual(inspectSource("domain", source), [])` for every file in `packages/domain/src/canonical/`; independently confirmed by reading `canonical-json.ts`, `canonical-guard.ts`, `canonical-sets.ts` — only relative imports present | ✅ PASS |
| CJ-03: matches published RFC 8785 vectors | byte-exact output for the 5 official vectors (arrays, french, structures, values, weird) | `tests/unit/canonical-json-v2.test.mjs:8-11`; vectors confirmed identical to the official `json-canonicalization` testdata in `tests/helpers/rfc8785-vectors.mjs:4-41` | ✅ PASS |
| CJ-04: code-unit member order, never locale | `{Z:2,a:1}` (code-unit) not `{a:1,Z:2}` (locale) | `tests/unit/canonical-json-v2.test.mjs:14-18` — `assert.equal(canonicalizeJsonV2({a:1,Z:2}), '{"Z":2,"a":1}')`; `tests/unit/canonical-json-v2.test.mjs:20-26` scans the source for `localeCompare` | ✅ PASS |
| CJ-05: array order preserved; declared sets normalized explicitly | `[3,1,2]` stays `[3,1,2]`; `normalizeDeclaredSet` sorts by code unit | `tests/unit/canonical-json-v2.test.mjs:28-34`; `tests/unit/canonical-json-sets.test.mjs:29-37` (`"B".localeCompare("a") === 1` but `normalizeDeclaredSet(["a","B"]) === ["B","a"]`) | ✅ PASS |
| CJ-06: typed rejection for each listed invalid input | 9 distinct `VES_CANONICAL_*` codes + resource limit | `tests/unit/canonical-json-guard.test.mjs:13-74` — one test per code (`undefined`, sparse array, accessor, symbol key, cycle, NaN/Infinity, non-plain prototype, unpaired surrogates ×2, depth>128, nodes>100k) | ✅ PASS |
| CJ-07: byte-identical output under ≥2 locales | Same digest under `en_US.UTF-8` and `fr_FR.UTF-8` | `tests/unit/canonical-json-v2.test.mjs:86-104` — sets `LANG`/`LC_ALL`, asserts equality, restores env | ✅ PASS |
| CJ-08: V1 `buildInventoryFingerprint` byte-identical for unmigrated callers | Same function body, same output | `git diff b94eef4..HEAD -- packages/workspace/src/scanner/scanner-primitives.ts` shows the V1 function untouched (pure addition of V2 alongside it); `tests/unit/workspace-fingerprint-v2.test.mjs:22-27` pins a hardcoded pre-computed hex digest (not self-generated); `tests/integration/safe-init.test.mjs:268-299` uses a hardcoded `PINNED_V1_PLAN_ID`/`PINNED_V1_CONTENT_DIGEST` (not computed by calling the current V1 function at test time) | ✅ PASS |
| CJ-09: workspace identities self-describing with a V2 prefix | `v2:sha256:` distinguishable from `sha256:` | `tests/unit/workspace-fingerprint-v2.test.mjs:9-11,29-31`; `tests/unit/artifact-placement.test.mjs:308-312` (`"WritePlan planId is self-describing V2 and differs from a V1-format value"`) | ✅ PASS. Note: spec.md's traceability table also cites `tests/integration/workspace-scanner.test.mjs` for CJ-09, but that file is untouched by this diff and asserts only value-equality, not format — this specific citation is imprecise (⚠️ minor), though CJ-09 remains adequately proven by the other two files. |
| CJ-10: V1 verifies, V2 verifies, mismatch fails closed | both cross-version directions rejected; genuine digest tampering rejected | `packages/workspace/src/init/safe-init.ts:119-131` (dispatch + fail-closed check); `tests/integration/safe-init.test.mjs:320-344` (both mismatch directions, `VES_INIT_RECOVERY_CONFLICT`); `tests/integration/safe-init.test.mjs:346-375` (tampered V2 digest); confirmed genuinely discriminating by my own mutation (Mutation 3 below) | ✅ PASS |
| CJ-11: discrimination sensor for both mutations, killed inside a declared gate | `tests/security/canonical-json-sensor.test.mjs` executes under `pnpm test:security` | `tests/security/canonical-json-sensor.test.mjs:35-68`; confirmed present in `pnpm test:security` run (see Gate Check) | ✅ PASS |
| CJ-12: `gate:security` passes, no assertion weakened | format/lint/typecheck/build/unit/architecture clean; security/fault carry only pre-existing failures | See Gate Check below | ⚠️ PASS with a documentation gap — see Gap 1 (an undisclosed third pre-existing-test regex update, not a weakening, but the "two owner-approved updates" claim in `spec.md`/`handoff.md` is inaccurate as written) |

**Status**: ✅ 11/12 ACs fully covered; 1 (CJ-12) carries a documentation-accuracy gap that does not affect actual test rigor.

---

## Discrimination Sensor

### T11's own sensor (independently reviewed, not just trusted)

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| A (T11) | `tests/security/canonical-json-sensor.test.mjs:35-52` | Replaces `.sort()` with `.sort((l,r)=>l.localeCompare(r))` in a disposable copy of `canonical-json.ts` | ✅ Killed — the disposable mutant demonstrably produces `{"a":2,"Z":1}` instead of the correct `{"Z":1,"a":2}`; independently confirmed the real production module's own test (`tests/unit/canonical-json-v2.test.mjs:14-18`) asserts exactly the correct value for this input, so this mutation would fail the real suite too. Not a no-op: verified `assert.notEqual(mutated, original)`. |
| B (T11) | `tests/security/canonical-json-sensor.test.mjs:54-68` | Replaces array-order-preserving encode with a sorted encode in a disposable copy | ✅ Killed — mutant collapses `[2,1]` to `"[1,2]"`; the real module's own test (`tests/unit/canonical-json-v2.test.mjs:32-34`) asserts `canonicalizeJsonV2([1,2]) !== canonicalizeJsonV2([2,1])`, which this mutation would violate. Not a no-op. |

Both T11 mutations are genuine (verified via `assert.notEqual(mutated, original)` inline) and each corresponds to an assertion in the real, non-disposable `tests/unit/canonical-json-v2.test.mjs` that the mutation would break if applied to production code.

### My own additional mutations (scratch state, journal version-dispatch logic — not covered by T11)

| Mutation | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 (mine) | `packages/workspace/src/init/safe-init.ts:125-129` | Removed the explicit per-version prefix cross-check in `parseRecoveryJournal`, leaving only `if (!planIdIsV1 && !planIdIsV2) throw` | ❌ **Survived** — all `tests/integration/safe-init.test.mjs` tests, including "schemaVersion 1 with a v2: planId is rejected as invalid" and "schemaVersion 2 with a bare sha256: planId is rejected as invalid", still pass. Root cause: those tests only assert `{ code: "VES_INIT_RECOVERY_CONFLICT" }`, and the downstream digest-mismatch check (line 164) coincidentally throws the *same* wrapped error code even when the explicit fail-closed pre-check is gone (a V1 hash of `changes` will never equal a `v2:`-prefixed value, so the digest comparison also fails). Observable behavior (rejection) is preserved, so this is a low-severity gap: the tests prove the *outcome* but not that the fail-closed pre-check specifically is what produces it. See Gap 2. |
| 2 (mine) | `packages/workspace/src/init/safe-init.ts:162-163` | Collapsed the version dispatch to always call `buildInventoryFingerprintV2({ changes })`, regardless of `schemaVersion` | ✅ **Killed** — `tests/integration/safe-init.test.mjs`: "a pinned schemaVersion 1 journal written before this slice still verifies and recovers" fails with `journal plan digest mismatch`, because the pinned V1 fixture's hardcoded `sha256:` planId no longer matches a V2-computed digest. This directly and cleanly proves CJ-08/CJ-10's version-dispatch requirement is load-bearing, not vacuous. |

Both of my mutations were applied to the real (non-disposable) `packages/workspace/src/init/safe-init.ts` via `git checkout -- <file>` restoration immediately after each run; `git status --short` confirmed a clean tree after each restoration and at the end of the session.

**Sensor depth**: lightweight (4 total mutations: 2 from T11, 2 independent)
**Result**: 3/4 killed — 1 survived (Mutation 1, low severity — see Gap 2)

---

## Code Quality

| Principle        | Status |
| ---------------- | ------ |
| Minimum code     | ✅ — encoder/guard/set-helper are each small, single-purpose modules; no speculative abstraction. |
| Surgical changes | ✅ — touched files are exactly those the design/tasks named; V1 left untouched (confirmed byte-identical). |
| No scope creep   | ✅ — no changes to `packages/evidence`, no other T4 matrix owners touched. |
| Matches patterns | ✅ — `node:test`/`node:assert/strict`, `WorkspaceScanError` reuse, existing contracts barrel pattern all followed. |
| Spec-anchored outcome check (asserted values match spec) | ✅ — see table above; every precise spec claim (ordering, prefix format, rejection codes) has a matching precise assertion. |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ — domain guard covers all 9 listed rejection categories + 2 resource limits; journal covers V1-verify/V2-verify/both-mismatch-directions/tamper. |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — spot-checked; every new test file traces to a CJ-ID in spec.md's traceability table. |
| Documented guidelines followed | `AGENTS.md`, `tests/AGENTS.md` (implied — `node:test` convention followed) |

---

## Edge Cases

- [x] Cross-locale byte equality (CJ-07) — handled and tested.
- [x] Set-vs-sequence array semantics (CJ-05) — handled with `normalizeDeclaredSet`, applied at every V1-array-sort call site identified in design.md (scanner ×4, placement ×1, safe-init ×3).
- [x] Journal schemaVersion/prefix mismatch, both directions (CJ-10) — handled and tested; independently confirmed load-bearing via Mutation 2.
- [x] V1 fixture predating this slice (CJ-08) — handled with a genuinely hardcoded (not self-generated) pinned fixture in two test files.
- [ ] Pre-check-vs-outcome distinction in journal rejection (see Gap 2) — not a functional edge case gap (behavior is correct), but a test-precision gap.

---

## Gate Check

- **Gate command**: `pnpm gate:security` (composed of `format:check`, `lint`, `typecheck`, `build`, `test:unit`, `test:architecture`, `test:qualification`, `test:security`, `test:fault` per `scripts/gate-stages.mjs`)
- **Result**: `gate:security` as a single invocation halts at `test:qualification`, which fails on pre-existing native-sqlite (`fts5`)/probe-related failures entirely unrelated to this slice (spikes/cedar, claude/codex driver probes, sqlite spikes). Each stage was run independently to completion:
  - `format:check`: ✅ exit 0
  - `lint`: ✅ exit 0
  - `typecheck`: ✅ exit 0
  - `build`: ✅ exit 0
  - `test:unit`: ✅ **1743/1743** pass (matches spec.md's claim exactly)
  - `test:contract`: ✅ **446/446** pass
  - `test:architecture`: ✅ **18/18** pass (matches spec.md's claim exactly)
  - `test:qualification`: ❌ 208 pass / 31 unique fail — all failures are `fts5`/native-module/external-tool-probe related (spikes/sqlite, spikes/cedar, spikes/claude-code-driver, spikes/codex-driver), none touch canonical-json/workspace/domain/contracts code. Pre-existing environment noise, out of this feature's diff surface.
  - `test:security`: ⚠️ **870/882** pass, **12 unique pre-existing failures** (memory-lifecycle-security ancestry checks, cedar-policy.test.mjs, sqlite-probe-adapter setAuthorizer). Matches spec.md's claimed 870/882 exactly. None of the 12 failing test names relate to canonical-json, journal, planId, or fingerprint.
  - `test:fault`: ⚠️ **171/218** pass, **47 unique pre-existing failures** (sqlite/vector/backup/quarantine fault paths). Matches spec.md's claimed 171/218 exactly. The new test "interrupted recovery of a pinned schemaVersion 1 journal restores the prior backup" (T10) passes.
  - `test:integration`: 461/536 pass, 75 unique pre-existing failures (sqlite probes, git-adapter, process-runner) — none overlap with journal/safe-init/scanner/placement tests, all of which pass. This is higher than the Batch-1-only baseline (450/525) because T9/T10 added ~11 more passing integration tests since that batch note was written; the *failure* count (75) is unchanged, confirming no regression.
- **Test count before feature** (base `b94eef4`, reported baseline in task brief, not independently re-derived via worktree since branch counts already matched claimed deltas exactly): `test:security` 868/880, `test:fault` 170/217.
- **Test count after feature**: `test:security` 870/882 (**+2** net: 2 new passing security-scope tests — the T11 sensor's 2 tests, since its other assertions are per-mutation not separately counted as pass/fail beyond node:test's own reporting), `test:fault` 171/218 (**+1**: the new pinned-V1 interrupted-recovery fault test).
- **Delta**: consistent with the claimed net-new test additions; no test count decreased anywhere.
- **Skipped tests**: none observed.
- **Failures**: all failures across every stage are the pre-existing native-`sqlite`/external-probe baseline; none are new, none touch this slice's code.

---

## Gap 1: undisclosed third pre-existing-test assertion change

**Root cause**: `tests/unit/artifact-placement.test.mjs`'s pre-existing test "WritePlan is deterministic and content-addressed" had its `planId` regex changed from `/^sha256:[a-f0-9]{64}$/u` to `/^v2:sha256:[a-f0-9]{64}$/u` in T8 (`git diff b31bc19..HEAD -- tests/unit/artifact-placement.test.mjs` shows this at the line following `assert.deepEqual(second, first)`). `handoff.md`'s Decisions section and `spec.md`'s CJ-12 evidence text both explicitly claim only two locations were changed (`tests/security/workspace-scanner-security.test.mjs:35` and `tests/integration/safe-init.test.mjs:124`, T7) plus one more (`tests/integration/safe-init.test.mjs:31`, T9) — three locations across two files, described inconsistently as "two...regex updates." The `artifact-placement.test.mjs` change is not mentioned anywhere in `handoff.md`.
**Fix task**: Update `handoff.md`'s Decisions section and `spec.md`'s CJ-12 success-criterion evidence text to also name `tests/unit/artifact-placement.test.mjs`'s regex update (T8), so the "no existing assertion changed except the owner-approved regex updates" claim is complete and accurate. Also update T8's own "Done when — Existing `tests/unit/artifact-placement.test.mjs` passes unmodified" checkbox language, since it did not pass unmodified (it needed and received a legitimate update, same category as T7/T9's).
**Priority**: Minor — this is a documentation-completeness/accuracy gap, not a functional regression or a genuinely undisclosed/unjustified test weakening. The change itself is correct and necessary (the assertion had to track the new `v2:sha256:` format).

## Gap 2: journal fail-closed pre-check is not independently proven load-bearing

**Root cause**: `tests/integration/safe-init.test.mjs`'s two mismatch-direction tests ("schemaVersion 1 with a v2: planId is rejected...", "schemaVersion 2 with a bare sha256: planId is rejected...") assert only `{ code: "VES_INIT_RECOVERY_CONFLICT" }`. Removing the explicit fail-closed prefix-cross-check in `parseRecoveryJournal` (my Mutation 1) does not fail either test, because the downstream digest-mismatch check happens to also throw the same wrapped error code for these inputs. The tests prove the *outcome* (rejection) but not that the *explicit format pre-check* is what causes it.
**Fix task**: Strengthen the two mismatch-direction tests in `tests/integration/safe-init.test.mjs` to assert on the underlying rejection reason (e.g., match `error.cause.message` against `"invalid journal envelope"` rather than `"journal plan digest mismatch"`), or add a case where the digest coincidentally can't discriminate (not practically constructible with SHA-256, so asserting on the cause message is the practical fix).
**Priority**: Minor — CJ-10's actual requirement ("fails closed rather than being reinterpreted") is behaviorally satisfied either way; this only means the test suite is agnostic to *which* of two defense-in-depth checks catches a malformed journal, not that the fail-closed guarantee itself is missing.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| CJ-01 | Implementing | ✅ Verified |
| CJ-02 | Implementing | ✅ Verified |
| CJ-03 | Implementing | ✅ Verified |
| CJ-04 | Implementing | ✅ Verified |
| CJ-05 | Implementing | ✅ Verified |
| CJ-06 | Implementing | ✅ Verified |
| CJ-07 | Implementing | ✅ Verified |
| CJ-08 | Implementing | ✅ Verified |
| CJ-09 | Implementing | ✅ Verified (minor citation-precision note) |
| CJ-10 | Implementing | ✅ Verified (Gap 2 noted — not blocking) |
| CJ-11 | Implementing | ✅ Verified |
| CJ-12 | Implementing | ⚠️ Verified with documentation gap (Gap 1) |

---

## Summary

**Overall**: ✅ Ready (with two minor, non-blocking documentation/test-precision gaps recommended for a follow-up, not required before merge)

**Spec-anchored check**: 12/12 ACs behaviorally matched their spec-defined outcome; 1 (CJ-12) has an inaccurate "two updates" claim in its evidence text that should read "three."
**Sensor**: 3/4 mutations killed (T11's 2 + my Mutation 2); 1 of my own additional mutations survived but represents a test-precision gap, not a missing behavioral guarantee (behavior is still correct via a different code path).
**Gate**: `test:unit` 1743/1743, `test:contract` 446/446, `test:architecture` 18/18, `format:check`/`lint`/`typecheck`/`build` all clean. `test:security` 870/882 and `test:fault` 171/218 carry exactly the pre-existing native-sqlite/external-probe failure baseline (12 and 47 respectively) with zero new regressions and the new T10/T11 tests passing.

**What works**: The V2 RFC 8785 encoder is a genuine, independently-implemented, zero-import primitive that passes the official published test vectors. Code-unit-vs-locale ordering and array-order-vs-set-normalization are both correctly implemented and proven with test cases specifically chosen to diverge under locale collation. V1 (`buildInventoryFingerprint`) is confirmed byte-identical to pre-slice by diffing against `b94eef4`, and CJ-08 backward compatibility is proven with genuinely hardcoded (non-circular) pinned fixtures. The journal version-dispatch fail-closed logic is real and load-bearing, confirmed via my own scratch-state mutation (Mutation 2) that cleanly broke V1 journal recovery when the dispatch was corrupted. AD-009 was correctly recorded and the pre-existing `external-review-triage` Handoff section in `.specs/STATE.md` is untouched.

**Issues found**:
1. Gap 1 (documentation accuracy) — `handoff.md`/`spec.md` undercount pre-existing test assertion changes by one (missing `artifact-placement.test.mjs`); fix by updating those two documents' text.
2. Gap 2 (test precision) — the two journal-mismatch-direction tests don't distinguish the fail-closed pre-check from the coincidental digest-mismatch catch; fix by asserting on the specific rejection cause.

**Next steps**: Both gaps are documentation/test-precision refinements, not functional defects — they do not block merge on their own, but should be addressed in a small follow-up commit before or shortly after human review, since `spec.md`'s CJ-12 evidence text currently makes a factually inaccurate claim ("two" instead of "three" pre-existing assertion updates). Human review and merge into `main` may proceed; recommend the follow-up be tracked alongside T4 scoping.
