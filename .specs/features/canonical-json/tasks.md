# Canonical JSON — T3 slice tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/canonical-json/design.md`
**Status**: In Progress — Batch 1 (T1–T8) complete, Batch 2 (T9–T13) pending

**Batch 1 results:**

| Task | Commit | Note |
| --- | --- | --- |
| T1 | `3031d66` | |
| T2 | `58bd778` | Verified against published RFC 8785 test vectors |
| T3 | `326e8f9` | |
| T4 | `e923c68` | |
| T5 | `289d15c` | |
| T6 | `a872957` | |
| T7 | `acedfcc` | 2 pre-existing tests updated (regex `sha256:` → `v2:sha256:`) with owner approval — see `handoff.md` |
| T8 | `2ff7eca` | |

`gate:full` confirmed zero net regressions from T7/T8 (integration 450/525, e2e 116/134, fault 170/217 — identical pass/fail counts with and without the change; remainder is pre-existing native-`sqlite` baseline noise, confirmed via `git stash` on both). `gate:quick` PASS after T8.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `AGENTS.md`, `tests/AGENTS.md`, `packages/AGENTS.md`, `scripts/gate-stages.mjs`, `scripts/test-scope.mjs`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Contracts (type/version token) | contract | Every declared version parses; an unknown/absent version is rejected | `tests/contract/*.test.mjs` | `pnpm test:contract` |
| Domain (pure encoder, guard, set helper) | unit | All branches; 1:1 to spec ACs; every listed edge case has a test; published RFC 8785 vectors | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Workspace adapter (scanner primitives, scanner, placement) | unit + integration | Happy path + every listed edge + error path; V1 byte-stability assertions | `tests/unit/*.test.mjs`, `tests/integration/*.test.mjs` | `pnpm test:unit`, `pnpm test:integration` |
| Init journal recovery | integration + fault-injection | V1 verifies, V2 verifies, mixed fails closed, interrupted-recovery path | `tests/integration/*.test.mjs`, `tests/fault-injection/*.test.mjs` | `pnpm test:integration`, `pnpm test:fault` |
| Architecture boundary | architecture | Domain rejects third-party and `node:` imports | `tests/architecture/*.test.mjs` | `pnpm test:architecture` |
| Discrimination sensor | security | Both mutations killed; fixtures disposable and restored | `tests/security/*.test.mjs` | `pnpm test:security` |
| Docs / spec artifacts | none | — (gate only) | — | gate only |

> `tests/mutation/` is deliberately **not** used: no declared script executes it (`scripts/test-scope.mjs` is never invoked for it, and it appears only in `scripts/gate-selection.mjs:36`). A sensor placed there cannot fail a gate.

## Gate Check Commands

> Generated from codebase — confirm before Execute. Composition read from `scripts/gate-stages.mjs`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After tasks with unit tests only | `pnpm gate:quick` |
| Full | After tasks with contract/integration/e2e/fault tests | `pnpm gate:full` |
| Build | After tasks touching architecture boundaries or package structure | `pnpm gate:build` |
| Security | Final task, and any task adding a security-scope test | `pnpm gate:security` |

> `test:architecture` is in `gate:build` and `gate:security` only — **not** in `gate:quick` or `gate:full`. Tasks asserting boundary rules must gate on build or security.

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: V2 primitive (contracts + domain)

```
T1 → T2 → T3 → T4
```

### Phase 2: Workspace V2 identities (transient, no compat surface)

```
T5 → T6 → T7 → T8
```

### Phase 3: Journal versioning (the one backward-compat surface)

```
T9 → T10 → T11
```

### Phase 4: Evidence and canonical docs

```
T12 → T13
```

---

## Task Breakdown

### T1: Declare the V2 canonical JSON contract token

**What**: Add the version token, the version union type, and a parser that derives a version from a self-describing identity string.
**Where**: `packages/contracts/src/canonical-json.ts` (new), exported from `packages/contracts/src/index.ts`
**Depends on**: None
**Reuses**: existing contracts export barrel
**Requirement**: CJ-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `CANONICAL_JSON_V2`, `CanonicalJsonVersion`, and `parseCanonicalJsonVersion` are exported
- [ ] `parseCanonicalJsonVersion` returns `"v2"` for `v2:sha256:…`, `"v1"` for `sha256:…`, and throws for anything else
- [ ] No third-party import other than the existing `ajv` carve-out
- [ ] Gate check passes: `pnpm gate:full`
- [ ] Test count: 6 tests pass (no silent deletions)

**Tests**: contract
**Gate**: full

**Commit**: `feat(contracts): declare the V2 canonical JSON version contract`

---

### T2: Implement the RFC 8785 JCS encoder in domain

**What**: Pure encode-only JCS serializer — code-unit member ordering, array order preserved, primitives via `JSON.stringify`.
**Where**: `packages/domain/src/canonical/canonical-json.ts` (new)
**Depends on**: T1
**Reuses**: `JSON.stringify` for primitive emission; default `Array.prototype.sort()` for code-unit ordering
**Requirement**: CJ-02, CJ-03, CJ-04, CJ-07

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `canonicalizeJsonV2(value)` emits RFC 8785 bytes with zero third-party and zero `node:` imports
- [ ] Published RFC 8785 test vectors pass (object ordering, numbers, string escaping, Unicode keys)
- [ ] Object members ordered by UTF-16 code unit; no `localeCompare` anywhere in the module
- [ ] Arrays emitted in input order — a reordered array produces different bytes
- [ ] Byte-identical output under at least two ambient locales (`LANG`/`LC_ALL` sweep, restored after)
- [ ] Gate check passes: `pnpm gate:build`
- [ ] Test count: 24 tests pass (no silent deletions)

**Tests**: unit
**Gate**: build

**Commit**: `feat(domain): add an RFC 8785 canonical JSON encoder`

---

### T3: Add the canonical JSON input guard

**What**: Reject values RFC 8785 cannot faithfully represent, each with a typed error code.
**Where**: `packages/domain/src/canonical/canonical-guard.ts` (new); wired into `canonicalizeJsonV2`
**Depends on**: T2
**Reuses**: rule set ported (not imported) from `packages/evidence/src/integrity/canonical.ts:31-105`
**Requirement**: CJ-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `undefined` values, sparse arrays, accessor properties, symbol keys, cycles, non-finite numbers, non-plain prototypes, and unpaired surrogates each throw a distinct `VES_CANONICAL_*` code
- [ ] Depth > 128 and nodes > 100 000 throw `VES_CANONICAL_RESOURCE_LIMIT`
- [ ] `canonicalizeJsonV2` calls the guard before encoding
- [ ] Gate check passes: `pnpm gate:quick`
- [ ] Test count: 14 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(domain): reject non-canonicalizable values with typed codes`

---

### T4: Pin the domain import boundary for the new module

**What**: Assert the new domain canonical modules carry no third-party and no `node:` imports, so the encoder decision cannot be silently reversed.
**Where**: `tests/architecture/repository-boundaries.test.mjs` (extend)
**Depends on**: T3
**Reuses**: `inspectSource` from `scripts/architecture.mjs:56`
**Requirement**: CJ-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A test feeds each `packages/domain/src/canonical/*.ts` source through `inspectSource("domain", …)` and asserts zero findings
- [ ] A test asserts `inspectSource("domain", 'import canonicalize from "canonicalize";')` still reports `VES_ARCH_THIRD_PARTY_IMPORT` — the rule is not weakened
- [ ] No existing boundary assertion modified
- [ ] Gate check passes: `pnpm gate:build`
- [ ] Test count: 3 tests added; full architecture suite passes

**Tests**: architecture
**Gate**: build

**Commit**: `test(architecture): pin the domain canonical module import boundary`

---

### T5: Add `buildInventoryFingerprintV2` beside the untouched V1

**What**: A V2 digest function emitting `v2:sha256:`, with V1 left byte-identical.
**Where**: `packages/workspace/src/scanner/scanner-primitives.ts` (add), re-exported from `packages/workspace/src/index.ts`
**Depends on**: T4
**Reuses**: `WorkspaceScanError`; `canonicalizeJsonV2` from `@verchestra/domain` (dependency already declared)
**Requirement**: CJ-08, CJ-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `buildInventoryFingerprintV2(value)` returns `v2:sha256:<hex>`
- [ ] A pinned fixture proves `buildInventoryFingerprint` (V1) returns byte-identical output to before this change
- [ ] V1 and V2 return different strings for the same input, and neither parses as the other
- [ ] Guard rejections surface as `WorkspaceScanError`, preserving the existing error surface
- [ ] Gate check passes: `pnpm gate:quick`
- [ ] Test count: 10 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(workspace): add a V2 inventory fingerprint beside V1`

---

### T6: Add explicit declared-set normalization

**What**: A helper that orders a collection by code unit when its owner declares it a set — replacing V1's implicit array sort.
**Where**: `packages/domain/src/canonical/canonical-sets.ts` (new)
**Depends on**: T5
**Reuses**: default `sort()` for code-unit ordering
**Requirement**: CJ-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `normalizeDeclaredSet(items, key)` returns a code-unit-ordered copy and never mutates its input
- [ ] Ordering is proven code-unit, not locale, with a key pair whose `localeCompare` order differs from code-unit order
- [ ] A sequence left un-normalized keeps its input order through `canonicalizeJsonV2`
- [ ] Gate check passes: `pnpm gate:quick`
- [ ] Test count: 8 tests pass (no silent deletions)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(domain): normalize declared sets in code-unit order`

---

### T7: Migrate scanner identities to V2

**What**: Move `repositoryId`, `discoveryKey`, `remoteFingerprint`, and the inventory `fingerprint` to V2, replacing locale sorts on their input collections.
**Where**: `packages/workspace/src/scanner/workspace-scanner.ts` (lines 109, 126, 144, 251, 265, 290, 292, 293)
**Depends on**: T6
**Reuses**: `buildInventoryFingerprintV2`, `normalizeDeclaredSet`
**Requirement**: CJ-04, CJ-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] All four identities emit `v2:sha256:`
- [ ] Every `localeCompare` at lines 265, 290, 292, 293 is replaced with code-unit ordering, and each collection is documented as set or sequence
- [ ] Scanning the same tree twice under different `LANG` values yields identical identities
- [ ] Existing scanner unit, integration, and security tests pass unmodified
- [ ] Gate check passes: `pnpm gate:full`
- [ ] Test count: existing scanner suites pass + 8 new tests

**Tests**: unit + integration
**Gate**: full

**Commit**: `feat(workspace): emit V2 scanner identities in code-unit order`

---

### T8: Migrate the placement write-plan identity to V2

**What**: Move `planId` to V2 and replace the locale-ordered artifact sort feeding it.
**Where**: `packages/workspace/src/placement/artifact-placement.ts:270,275`
**Depends on**: T7
**Reuses**: `buildInventoryFingerprintV2`, `normalizeDeclaredSet`
**Requirement**: CJ-04, CJ-09

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `planId` emits `v2:sha256:`
- [ ] The `gitOwnerId`/`logicalPath` sort at line 270 uses code-unit ordering
- [ ] Two plans differing only in input artifact order produce the same `planId` (set semantics preserved deliberately, not incidentally)
- [ ] Existing `tests/unit/artifact-placement.test.mjs` passes unmodified
- [ ] Gate check passes: `pnpm gate:quick`
- [ ] Test count: existing placement suite passes + 6 new tests

**Tests**: unit
**Gate**: quick

**Commit**: `feat(workspace): emit a V2 placement write-plan identity`

---

### T9: Write recovery journals at `schemaVersion: 2`

**What**: Emit `schemaVersion: 2` with a V2 `planId` on the journal write path.
**Where**: `packages/workspace/src/init/safe-init.ts:70,256,270-273,311-318`
**Depends on**: T8
**Reuses**: `buildInventoryFingerprintV2`, `normalizeDeclaredSet`
**Requirement**: CJ-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A newly written `transaction.json` carries `schemaVersion: 2` and a `v2:sha256:` `planId`
- [ ] The locale sorts at lines 87, 188, 256 are replaced with code-unit ordering
- [ ] `InitPreview.planId` and the journal `planId` agree for the same change set
- [ ] Gate check passes: `pnpm gate:full`
- [ ] Test count: existing safe-init suites pass + 7 new tests

**Tests**: integration
**Gate**: full

**Commit**: `feat(workspace): write V2 recovery journals at schemaVersion 2`

---

### T10: Verify V1 and V2 journals by recorded version, failing closed

**What**: Dispatch the reader on `schemaVersion`, verify with the matching canonicalizer, and reject any version/prefix disagreement.
**Where**: `packages/workspace/src/init/safe-init.ts:105-150,355-368`
**Depends on**: T9
**Reuses**: `buildInventoryFingerprint` (V1, unchanged), `buildInventoryFingerprintV2`, `parseCanonicalJsonVersion`
**Requirement**: CJ-08, CJ-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] A pinned `schemaVersion: 1` journal fixture written before this slice still verifies and recovers
- [ ] A `schemaVersion: 2` journal verifies with V2
- [ ] `schemaVersion: 1` with a `v2:` `planId`, and `schemaVersion: 2` with a bare `sha256:` `planId`, are both rejected as invalid — never cross-verified
- [ ] A V2 journal whose `changes` were tampered with still fails `journal plan digest mismatch`
- [ ] Interrupted-recovery fault tests cover both versions
- [ ] Gate check passes: `pnpm gate:full`
- [ ] Test count: existing safe-init + fault suites pass + 10 new tests

**Tests**: integration + fault-injection
**Gate**: full

**Commit**: `feat(workspace): verify recovery journals by their recorded version`

---

### T11: Add the canonical JSON discrimination sensor

**What**: Two behaviour-level mutations, applied in disposable copies, each proven to be killed.
**Where**: `tests/security/canonical-json-sensor.test.mjs` (new)
**Depends on**: T10
**Reuses**: sensor pattern from `tests/mutation/verification-sensor.test.mjs`; `tests/helpers`
**Requirement**: CJ-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Mutation A replaces code-unit member ordering with `localeCompare` — killed by a named focused test
- [ ] Mutation B replaces array-order preservation with sorting — killed by a named focused test
- [ ] Both mutations operate on disposable copies; original sources are byte-identical after the run
- [ ] The test lives under `tests/security/` so `test:security` executes it inside `gate:security`
- [ ] Gate check passes: `pnpm gate:security`
- [ ] Test count: 4 tests pass (no silent deletions)

**Tests**: security
**Gate**: security

**Commit**: `test(security): kill locale-ordering and array-ordering mutations`

---

### T12: Correct the canonical compatibility matrix

**What**: Fix the incomplete T3 blocker, record the encoder decision, and mark the workspace slice migrated.
**Where**: `docs/canonical-json-compatibility.md:20-24,65,69-82`
**Depends on**: T11
**Reuses**: existing matrix structure
**Requirement**: CJ-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] The stated blocker names the architecture rule (`VES_ARCH_THIRD_PARTY_IMPORT`, `scripts/architecture.mjs:67-69`), not only the dependency approval
- [ ] The chosen encoder (internal RFC 8785 in domain, `canonicalize@3.0.0` retained in evidence) is recorded with its date
- [ ] The Workspace row records the slice as migrated, with the journal's V1 rule preserved
- [ ] The five required-proof items are marked satisfied with their test paths
- [ ] Gate check passes: `pnpm gate:quick`

**Tests**: none
**Gate**: quick

**Commit**: `docs(portability): correct the canonical JSON T3 blocker and record the encoder decision`

---

### T13: Record decision AD-009 and close the slice evidence

**What**: Append the project-level encoder decision, tick spec success criteria, and update the handoff to the exact next action.
**Where**: `.specs/STATE.md`, `.specs/features/canonical-json/spec.md`, `.specs/features/canonical-json/handoff.md`
**Depends on**: T12
**Reuses**: existing `AD-NNN` format
**Requirement**: CJ-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `AD-009` records: domain packages take no third-party dependencies; canonicalization contracts are implemented internally there
- [ ] The `external-review-triage` Handoff section in `.specs/STATE.md` is preserved byte-for-byte
- [ ] All 12 spec success criteria are ticked with evidence, or an untickable one is stated as such
- [ ] `handoff.md` names T4's next slice as the exact next action
- [ ] Gate check passes: `pnpm gate:security`
- [ ] No test skipped, weakened, or deleted anywhere in the slice

**Tests**: none
**Gate**: security

**Commit**: `docs(canonical-json): record AD-009 and close the T3 slice`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ──→ T2 ──→ T3 ──→ T4
Phase 2:  T5 ──→ T6 ──→ T7 ──→ T8
Phase 3:  T9 ──→ T10 ──→ T11
Phase 4:  T12 ──→ T13
```

Execution is strictly sequential — there is no intra-phase parallelism.

**Batch packing (13 tasks, ~7-task budget):**

| Batch | Phases | Tasks | Count |
| --- | --- | --- | --- |
| 1 | Phase 1 + Phase 2 | T1–T8 | 8 |
| 2 | Phase 3 + Phase 4 | T9–T13 | 5 |

More than one batch → the sub-agent offer applies before Execute.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: contract token | 1 module | ✅ Granular |
| T2: JCS encoder | 1 module | ✅ Granular |
| T3: input guard | 1 module | ✅ Granular |
| T4: boundary assertions | 1 test file | ✅ Granular |
| T5: V2 fingerprint | 1 function | ✅ Granular |
| T6: set normalization | 1 function | ✅ Granular |
| T7: scanner migration | 1 file, one cohesive identity group | ✅ Granular |
| T8: placement migration | 1 file, 1 identity | ✅ Granular |
| T9: journal write path | 1 file, write side only | ✅ Granular |
| T10: journal read path | 1 file, read side only | ✅ Granular |
| T11: sensor | 1 test file | ✅ Granular |
| T12: matrix correction | 1 doc | ✅ Granular |
| T13: decision + evidence | 3 spec artifacts, one cohesive concern | ⚠️ OK — cohesive closure task |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (phase head) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T4 | Phase 1 → Phase 2, T5 head | ✅ Match |
| T6 | T5 | T5 → T6 | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | Phase 2 → Phase 3, T9 head | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T11 | Phase 3 → Phase 4, T12 head | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |

No task depends on a later phase.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Contracts | contract | contract | ✅ OK |
| T2 | Domain | unit | unit | ✅ OK |
| T3 | Domain | unit | unit | ✅ OK |
| T4 | Architecture boundary | architecture | architecture | ✅ OK |
| T5 | Workspace adapter | unit + integration | unit | ✅ OK — pure function, no boundary crossed |
| T6 | Domain | unit | unit | ✅ OK |
| T7 | Workspace adapter | unit + integration | unit + integration | ✅ OK |
| T8 | Workspace adapter | unit + integration | unit | ✅ OK — no I/O boundary in this path |
| T9 | Init journal recovery | integration + fault-injection | integration | ✅ OK — write side; fault path is T10 |
| T10 | Init journal recovery | integration + fault-injection | integration + fault-injection | ✅ OK |
| T11 | Discrimination sensor | security | security | ✅ OK |
| T12 | Docs | none | none | ✅ OK |
| T13 | Spec artifacts | none | none | ✅ OK |

No task defers its own tests to a later task.
