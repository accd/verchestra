# Canonical JSON T4 Completion Tasks

**Spec**: `.specs/features/canonical-json-t4-completion/spec.md`
**Design**: `.specs/features/canonical-json-t4-completion/design.md`
**Issue**: #58 — **Status**: Draft

## Test coverage matrix

> Guidelines found: `AGENTS.md`, `tests/AGENTS.md`, `.specs/AGENTS.md`,
> `docs/canonical-json-compatibility.md` ("Required proof for each migration
> PR", five items). Every migration task below carries all five.

| Code layer | Required test type | Coverage expectation | Location pattern | Run command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Digest-producing domain logic | unit | All branches; cross-locale byte-identity; guard rejection cases | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Release/distribution identity | build + security | Happy path + tamper + cross-locale + pinned fixture | `tests/build/*.test.mjs`, `tests/security/*.test.mjs` | `pnpm test:release`, `pnpm test:security` |
| Signed evidence (execution package) | unit + integration + security | V1 verifies unchanged; V2 carries a version; mixed comparison fails closed | `tests/unit/*.test.mjs`, `tests/integration/*.test.mjs`, `tests/security/*.test.mjs` | `pnpm test:unit`, `pnpm test:integration`, `pnpm test:security` |
| Ratchet and discrimination sensors | security | Each new call site has a killing locale mutation | `tests/security/*.test.mjs` | `pnpm test:security` |
| Matrix documentation | none | Gate only — but every classification cites `file:line` | `docs/canonical-json-compatibility.md` | `pnpm gate:security` |

## Gate check commands

| Gate level | When to use | Command |
| ---------- | ----------- | ------- |
| Focused | While developing a single task | `node --test tests/<scope>/<file>.test.mjs` |
| Quick | After any task with unit tests | `pnpm gate:quick` |
| Security | After every migration task and every ceiling change | `pnpm gate:security` |
| Release | After the release-identity phase | `pnpm gate:release` |
| Full | Before handoff | `pnpm gate:full` |

## Execution plan

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1 (T4j, before T76):  T1 → T2 → T3 → T4 → T5 → T6
Phase 2 (T4k, census):      T7 → T8 → T9 → T10 → T11 → T12
Phase 3 (T4i, evidence):    T13 → T14 → T15 → T16 → T17 → T18 → T19 → T20
Phase 4 (close-out):        T21 → T22 → T23
```

Batch packing, whole phases only: **B1** = Phase 1 (6) · **B2** = Phase 2 (6) ·
**B3** = Phase 3 (8) · **B4** = Phase 4 (3). Phase 3 sits above the ~7 budget
and is left intact: it is one tight dependency chain around a single signed
artifact and has no honest split seam.

Each phase is independently mergeable, satisfying the matrix's requirement
that every slice be a separately reviewable unit.

---

## Task breakdown

### Phase 1 — T4j, release identity (must precede T76)

#### T1: Prove the no-installed-base claim
**What**: Assert `releaseDigest` is null and no tracked fixture pins a V1 release manifest digest. This is the gate on the whole direct-swap route.
**Where**: `tests/build/release-identity-census.test.mjs` (new)
**Depends on**: None · **Requirement**: CJ5-01 · **AC**: 1
**Done when**:
- [ ] Asserts `resolveReleaseIdentity().releaseDigest === null`
- [ ] Asserts no tracked fixture or evidence file pins a V1 release-manifest digest
- [ ] If either assertion fails, STOP — re-plan Phase 1 as a versioned facade and record the decision
- [ ] `pnpm gate:quick` passes
**Tests**: build · **Gate**: quick
**Commit**: `test(distribution): prove release identity has no installed base (T58)`

#### T2: Migrate the hermetic bundle to V2
**What**: Replace the private recursive `canonical()` and the `componentId` sort with `canonicalizeJsonV2` and `codeUnitCompare`; re-pin the fixtures.
**Where**: `packages/distribution/src/hermetic-bundle.ts:119-125,266`, `tests/helpers/hermetic-bundle-fixture.mjs`
**Depends on**: T1 · **Requirement**: CJ5-02 · **AC**: 2
**Done when**:
- [ ] No `localeCompare` remains in the file
- [ ] Guard rejection cases (undefined, non-finite, cycles, depth) behave identically at the call boundary
- [ ] Existing bundle suites pass with re-pinned digests; no assertion weakened
- [ ] `pnpm test:release` and `pnpm gate:security` pass
**Tests**: build + security · **Gate**: security

#### T3: Cross-locale proof for release identity
**What**: The same release manifest yields byte-identical output and digest under two ambient locales.
**Where**: `tests/security/hermetic-bundle-security.test.mjs`
**Depends on**: T2 · **Requirement**: CJ5-09 · **AC**: 3
**Done when**:
- [ ] Two locales asserted byte-identical, including a Unicode member name (edge case 2)
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T4: Discrimination sensor for release identity
**What**: A mutation replacing code-unit ordering with ambient `localeCompare` in the release path is killed.
**Where**: `tests/security/canonical-json-sensor.test.mjs`
**Depends on**: T2 · **Requirement**: CJ5-10 · **AC**: 4
**Done when**:
- [ ] Mutation applied in a disposable copy and fully restored
- [ ] The mutant is killed by a named assertion
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T5: Migrate transactional activation
**What**: The single remaining site, after the bundle per the matrix ordering.
**Where**: `packages/distribution/src/transactional-activation.ts`
**Depends on**: T2 · **Requirement**: CJ5-03
**Done when**:
- [ ] Site migrated; durable activation records still read back
- [ ] `pnpm test:release` and `pnpm gate:security` pass
**Tests**: build + security · **Gate**: security

#### T6: Tighten the distribution ceilings and update the matrix
**What**: Ceilings 2 → 0 and 1 → 0; matrix rows record the reclassification and its evidence.
**Where**: `tests/security/canonical-json-locale-allowlist.test.mjs`, `docs/canonical-json-compatibility.md:79-80,116-119`
**Depends on**: T3, T4, T5 · **Requirement**: CJ5-02, CJ5-03
**Done when**:
- [ ] Both ceilings at 0 and the sensor passes
- [ ] Matrix rows cite T1's assertion as the justification for the direct swap
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

### Phase 2 — T4k, close the census

Each task audits one cohesive group against the four compatibility rules,
records the classification in the matrix with `file:line` evidence, and moves
that group's ceilings to their true floor. An inconclusive audit keeps its
ceiling and records the open question.

#### T7: Audit the evidence group
**Where**: `recovery-bundle.ts` (5), `run-capsule.ts` (3), `support-bundle.ts` (2)
**Depends on**: None · **Requirement**: CJ5-04 · **AC**: 5
**Done when**:
- [ ] Each site classified: trust-relevant (migrate) or presentation-only (justify)
- [ ] Matrix rows added with evidence; ceilings set to post-audit counts
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T8: Audit the policy and bootstrap group
**Where**: `policy-bundle.ts` (2), `machine-bootstrap.ts` (6)
**Depends on**: None · **Requirement**: CJ5-04 · **AC**: 5
**Done when**: as T7 · **Tests**: security · **Gate**: security

#### T9: Audit the agent-runtime group
**Where**: `discovery-router.ts` (1), `model-router.ts` (4), `passport-registry.ts` (2), `governed-skill-registry.ts` (1)
**Depends on**: None · **Requirement**: CJ5-04 · **AC**: 5
**Done when**: as T7 · **Tests**: security · **Gate**: security

#### T10: Audit the memory group
**Where**: `memory-store.ts` (5), `memory-vector-index.ts` (3), `memory-retriever.ts` (2), `memory-lifecycle.ts` (2)
**Depends on**: None · **Requirement**: CJ5-04 · **AC**: 5
**Done when**: as T7 · **Tests**: security · **Gate**: security

#### T11: Audit the adapter and host group
**Where**: `connectors` ×3, `drivers` ×2, `effect-kernel.ts` (2), `extension-host` (1)
**Depends on**: None · **Requirement**: CJ5-04 · **AC**: 5
**Done when**: as T7 · **Tests**: security · **Gate**: security

#### T12: Close the census
**What**: Fold the audited entries into `MATRIX_CEILINGS`, empty `UNCLASSIFIED_CEILINGS`, and assert a new unclassified occurrence anywhere fails.
**Where**: `tests/security/canonical-json-locale-allowlist.test.mjs`
**Depends on**: T7–T11 · **Requirement**: CJ5-04 · **AC**: 6
**Done when**:
- [ ] `UNCLASSIFIED_CEILINGS` is empty
- [ ] A new occurrence in an untracked file still fails (existing mutation test retained)
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

### Phase 3 — T4i, signed evidence

#### T13: Add the V2 facade in evidence
**What**: A `canonicalizeJsonV2`-backed facade alongside the qualified V1 `canonicalizeJson`, which stays exported and untouched.
**Where**: `packages/evidence/src/integrity/` (new module)
**Depends on**: None · **Requirement**: CJ5-05
**Done when**:
- [ ] V1 implementation unchanged and still exported
- [ ] Guard rejection parity asserted at the call boundary
- [ ] `pnpm gate:quick` passes
**Tests**: unit · **Gate**: quick

#### T14: Select the verifier from the recorded envelope version
**What**: Dispatch on the DSSE envelope's declared version; never infer.
**Where**: `packages/evidence/src/execution-package/execution-package.ts:978-981`
**Depends on**: T13 · **Requirement**: CJ5-05 · **AC**: edge case 3
**Done when**:
- [ ] An artifact with no version field selects V1 and does not guess V2
- [ ] An unknown version fails closed
- [ ] `pnpm gate:full` passes
**Tests**: unit + integration · **Gate**: full

#### T15: Move the eleven pre-sorts onto the V2 path only
**What**: `codeUnitCompare` on the V2 path; the V1 path keeps its `localeCompare` sort byte-for-byte.
**Where**: `packages/evidence/src/execution-package/execution-package.ts` (11 sites)
**Depends on**: T14 · **Requirement**: CJ5-05
**Done when**:
- [ ] A mixed-case identifier list is asserted to order differently under V1 and V2 (edge case 1)
- [ ] The V1 sort is untouched
- [ ] `pnpm gate:full` passes
**Tests**: unit · **Gate**: full

#### T16: Pinned V1 fixture still verifies
**Where**: `tests/integration/execution-package.test.mjs`
**Depends on**: T15 · **Requirement**: CJ5-06 · **AC**: 7
**Done when**:
- [ ] A signed V1 package captured before this slice verifies byte-for-byte
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T17: V2 artifacts record an explicit version
**Depends on**: T15 · **Requirement**: CJ5-07 · **AC**: 8
**Done when**:
- [ ] A newly produced package carries an explicit canonicalization version
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T18: Mixed V1/V2 comparison fails closed
**Where**: `tests/security/execution-package-versioning.test.mjs` (new)
**Depends on**: T16, T17 · **Requirement**: CJ5-08 · **AC**: 9
**Done when**:
- [ ] A V1 and a V2 digest for the same logical material are never reported equal
- [ ] The failure is explicit, not an absence of comparison
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T19: Discrimination sensor for the V2 sort sites
**Where**: `tests/security/canonical-json-sensor.test.mjs`
**Depends on**: T15 · **Requirement**: CJ5-10 · **AC**: 4
**Done when**:
- [ ] A locale-ordering mutation at a V2 site is killed
- [ ] Mutation runs in a disposable copy and restores state
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T20: Document the residual V1 ceiling
**What**: Set `execution-package.ts`'s ceiling to its true V1-path count and record why it is intentional, as `scanner-primitives.ts` already is.
**Where**: `tests/security/canonical-json-locale-allowlist.test.mjs`, `docs/canonical-json-compatibility.md:91`
**Depends on**: T15–T19 · **Requirement**: CJ5-12 · **AC**: 11
**Done when**:
- [ ] Ceiling equals the retained V1 sort count, not zero-by-wishful-thinking
- [ ] The matrix names each residual and its V1-compatibility reason
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

### Phase 4 — Close-out

#### T21: Repair the ratchet
**What**: De-duplicate the seven duplicate keys in `MATRIX_CEILINGS` and add a test that a duplicate key fails.
**Where**: `tests/security/canonical-json-locale-allowlist.test.mjs`
**Depends on**: T6, T12, T20 · **Requirement**: CJ5-11 · **AC**: 10
**Done when**:
- [ ] `gate-commit.ts` and `cedar-policy.ts` carry their intended tighter ceilings, not the later loose duplicates
- [ ] A duplicate key introduced anywhere fails the test
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T22: Record acceptance evidence
**What**: Tick #58's eight acceptance boxes with `file:line` evidence; state which residual sites are intentional V1 compatibility.
**Where**: `docs/canonical-json-compatibility.md`, issue #58
**Depends on**: T21 · **Requirement**: CJ5-13 · **AC**: 11
**Done when**:
- [ ] Every box cites an assertion, not a description
- [ ] The "no `localeCompare`" box is qualified as "no unintentional ordering", with residuals named
- [ ] `pnpm gate:security` passes
**Tests**: none (documentation) · **Gate**: security

#### T23: Final gates and handoff
**Depends on**: T22 · **Requirement**: CJ5-13
**Done when**:
- [ ] `pnpm gate:security` and `pnpm gate:full` pass with zero failed, skipped, or todo
- [ ] Handoff records exact evidence and the next action
- [ ] Submitted for independent verification and human review
**Tests**: none (gate) · **Gate**: full

---

## Task granularity check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1, T3, T4, T18, T19 | 1 test file each | Granular |
| T2, T5, T13, T14, T15 | 1 source file, single concern | Granular |
| T6, T12, T20, T21 | 1 sensor/matrix change | Granular |
| T7–T11 | 1 package group audit each (2–4 cohesive files) | Granular (cohesive) |
| T16, T17 | 1 fixture assertion each | Granular |
| T22, T23 | 1 evidence action each | Granular |

## Diagram-definition cross-check

| Task | Depends on (body) | Diagram | Status |
| ---- | ----------------- | ------- | ------ |
| T1 | None | phase head | Match |
| T2 | T1 | T1 → T2 | Match |
| T3 | T2 | T2 → T3 | Match |
| T4 | T2 | same phase, backward | Match |
| T5 | T2 | same phase, backward | Match |
| T6 | T3, T4, T5 | T5 → T6 | Match |
| T7–T11 | None | phase head, independent | Match |
| T12 | T7–T11 | T11 → T12 | Match |
| T13 | None | phase head | Match |
| T14 | T13 | T13 → T14 | Match |
| T15 | T14 | T14 → T15 | Match |
| T16 | T15 | T15 → T16 | Match |
| T17 | T15 | same phase, backward | Match |
| T18 | T16, T17 | T17 → T18 | Match |
| T19 | T15 | same phase, backward | Match |
| T20 | T15–T19 | T19 → T20 | Match |
| T21 | T6, T12, T20 | prior phases | Match |
| T22 | T21 | T21 → T22 | Match |
| T23 | T22 | T22 → T23 | Match |

No task depends on a later phase.

## Test co-location validation

| Task | Layer modified | Matrix requires | Task says | Status |
| ---- | -------------- | --------------- | --------- | ------ |
| T1 | Release identity | build + security | build | OK (census assertion only; no byte change) |
| T2, T5 | Release identity | build + security | build + security | OK |
| T3, T4, T19 | Sensors | security | security | OK |
| T6, T12, T20, T21 | Ratchet | security | security | OK |
| T7–T11 | Ratchet + matrix | security | security | OK |
| T13 | Digest-producing logic | unit | unit | OK |
| T14 | Signed evidence | unit + integration | unit + integration | OK |
| T15 | Signed evidence | unit | unit | OK |
| T16, T17 | Signed evidence | integration | integration | OK |
| T18 | Signed evidence | security | security | OK |
| T22, T23 | Documentation / gate | none | none | OK (matrix says none for documentation) |

## Requirement traceability

| Requirement | Tasks | Acceptance criteria |
| ----------- | ----- | ------------------- |
| CJ5-01 | T1 | 1 |
| CJ5-02 | T2, T6 | 2 |
| CJ5-03 | T5, T6 | — |
| CJ5-04 | T7, T8, T9, T10, T11, T12 | 5, 6 |
| CJ5-05 | T13, T14, T15 | — |
| CJ5-06 | T16 | 7 |
| CJ5-07 | T17 | 8 |
| CJ5-08 | T18 | 9 |
| CJ5-09 | T3 | 3 |
| CJ5-10 | T4, T19 | 4 |
| CJ5-11 | T21 | 10 |
| CJ5-12 | T20 | 11 |
| CJ5-13 | T22, T23 | — |

**Coverage:** 13 requirements, 13 mapped to tasks, 0 unmapped. 11 acceptance criteria, 11 mapped.

## Completion rules

- One task, one passing gate, one atomic commit.
- Tests assert specification outcomes and are never weakened, deleted, or skipped.
- A ceiling moves only alongside a real count reduction.
- Update the portable handoff after every task.
- Independent verification and human review are required before completion.

## Execution evidence

| Task | Status | Commit |
| ---- | ------ | ------ |
| T1–T23 | Planned | Pending |
