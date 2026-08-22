# Deep Doctor Live Probes Tasks

**Spec**: `.specs/features/deep-doctor-live-probes/spec.md`
**Design**: `.specs/features/deep-doctor-live-probes/design.md`
**Issue**: #207 — **Status**: Draft

## Test coverage matrix

> Guidelines found: `AGENTS.md`, `tests/AGENTS.md`, `.specs/AGENTS.md`.
> Coverage conforms to them: assertions derive from specification outcomes,
> every behavior change carries a happy path plus each specified edge or
> failure path, and mutation work runs in disposable copies.

| Code layer | Required test type | Coverage expectation | Location pattern | Run command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Domain primitive (`packages/domain`) | unit | All branches; 1:1 to spec ACs | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Application port and rules (`packages/application`) | unit | All branches; 1:1 to spec ACs; every listed edge case | `tests/unit/*.test.mjs` | `pnpm test:unit` |
| Read-only adapter surface (`packages/platform-node`, `packages/policy`) | unit + integration | Happy path + every failure path (absent, corrupt, locked) | `tests/unit/*.test.mjs`, `tests/integration/*.test.mjs` | `pnpm test:unit`, `pnpm test:integration` |
| CLI composition root (`apps/vestra-cli`) | integration | Every probe: pass, fail, and blocked outcomes | `tests/integration/*.test.mjs` | `pnpm test:integration` |
| Architecture invariants | architecture | Every declared boundary, plus a killing mutation | `tests/architecture/*.test.mjs` | `pnpm test:architecture` |
| Non-leak and read-only properties | security | Sealed payload contains no path, value, digest, or secret | `tests/security/*.test.mjs` | `pnpm test:security` |
| Qualification evidence | system | One provisioned matrix leg per platform | `tests/system/*.test.mjs` | `pnpm test:release` |

## Gate check commands

| Gate level | When to use | Command |
| ---------- | ----------- | ------- |
| Focused | While developing a single task | `node --test tests/<scope>/<file>.test.mjs` |
| Quick | After any task with unit or architecture tests | `pnpm gate:quick` |
| Full | After tasks touching component boundaries | `pnpm gate:full` |
| Security | After any task changing the read-only or non-leak surface | `pnpm gate:security` |
| Release | After the qualification evidence task | `pnpm gate:release` |

## Execution plan

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6

Phase 1 (layout):        T1 → T2 → T3 → T4 → T5
Phase 2 (async port):    T6 → T7
Phase 3 (read-only):     T8 → T9 → T10 → T11
Phase 4 (live probes):   T12 → T13 → T14 → T15
Phase 5 (availability):  T16 → T17 → T18 → T19
Phase 6 (evidence):      T20 → T21 → T22
```

Batch packing at ~7 tasks per worker, whole phases only:
**B1** = Phase 1 + Phase 2 (7) · **B2** = Phase 3 + Phase 4 (8) · **B3** = Phase 5 + Phase 6 (7).

---

## Task breakdown

### Phase 1 — Layout contract and provisioning

#### T1: Add the subsystem layout contract
**What**: A pure module exporting `WORKSPACE_ROOT_DIRNAME` and the seven subsystem relative paths.
**Where**: `packages/domain/src/workspace-layout/subsystem-layout.ts` (new)
**Depends on**: None · **Requirement**: DDL-01
**Done when**:
- [x] Seven paths and the root dirname exported as one frozen record
- [x] Zero imports (domain purity rule holds)
- [x] Unit test asserts each of the seven names and that the record is frozen
- [x] `pnpm gate:quick` passes
**Tests**: unit · **Gate**: quick
**Commit**: `feat(doctor): name subsystem observation paths in one contract (T207)`

#### T2: Derive safe-init's root from the contract
**What**: Replace `safe-init.ts`'s local `WORKSPACE_ROOT_DIRNAME` literal with the domain export.
**Where**: `packages/workspace/src/init/safe-init.ts:16`, `tests/architecture/doctor-workspace-root.test.mjs`
**Depends on**: T1 · **Requirement**: DDL-02
**Done when**:
- [x] Literal removed; value re-exported for existing consumers so no call site changes behavior
- [x] Existing safe-init suite passes unchanged (no assertion weakened)
- [x] Drift guard rewritten: it proved two source literals agreed, and T2 removes one of them
- [x] Guard discrimination proven (doctor drift, and a reintroduced competing literal, both killed)
- [x] `pnpm gate:quick` passes
**Tests**: unit + architecture · **Gate**: quick

> **Scope note (approved 2026-08-22).** `tests/architecture/doctor-workspace-root.test.mjs`
> regex-extracts a `const WORKSPACE_ROOT_DIRNAME = "..."` literal from both
> `safe-init.ts` and `doctor-composition.ts` and asserts they match. Removing
> safe-init's literal makes that extraction fail, so the guard could not stay
> untouched. The plan had placed this rewrite in T4 and missed the coupling.
> The guard now pins the doctor's literal to the domain contract and asserts
> safe-init holds no competing copy; T3 and T4 extend it further.

#### T3: Derive the doctor composition's paths from the contract
**What**: Replace the local literal at line 38 and the seven inline `join(...)` path expressions with contract lookups; add `@verchestra/domain` to `READ_ONLY_IMPORTS`.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:38,123-137`, `tests/architecture/doctor-readonly-graph.test.mjs:21-32`, `tests/architecture/doctor-workspace-root.test.mjs`
**Depends on**: T1 · **Requirement**: DDL-02
**Done when**:
- [x] No path literal remains in the composition root
- [x] Allowlist entry justified in the guard's comment (domain is import-free by architecture rule)
- [x] Drift guard rewritten again: removing the doctor's literal broke the same `constDeclaration` extraction T2 already had to work around; both files now proven to import the root rather than declare it
- [x] Guard discrimination proven (a reintroduced literal, and an import from a non-domain module, both killed)
- [x] `pnpm test:architecture` passes

> **Scope note (2026-08-22).** Same coupling as T2, on the second of the two
> files the original guard compared. Applied the identical resolution already
> approved for T2 without re-asking, per auto-mode guidance to make the
> reasonable call on a decision already established this session.
**Tests**: architecture · **Gate**: quick

#### T4: Prove path ownership statically (split from provisioning — see scope note)
**What**: Extend the drift guard so every probed path is proven owned by the contract: each `fileProbe(...)` call site must route through `subsystemPath(metadataRoot, "<key>")` with a key the contract declares, never a hand-rolled path.
**Where**: `tests/architecture/doctor-workspace-root.test.mjs`
**Depends on**: T3 · **Requirement**: DDL-03 · **AC**: 1
**Done when**:
- [x] A probed path bypassing `subsystemPath` (hand-rolled `join`) fails the gate
- [x] A probed path referencing a key the contract does not declare fails the gate
- [x] Both failure modes proven by a mutation in a disposable copy
- [x] `pnpm test:architecture` passes

> **Scope note (2026-08-22): T4 split, one half moved to T5.** The task as
> planned bundled two properties: "a probed path absent from the contract
> fails the gate" (provable now, since the doctor already imports the
> contract) and "a contract path nothing provisions fails the gate" (AC2 —
> not provable yet, because nothing provisions the seven paths until T5's
> fixture script exists; T5 as planned even listed T4 as a dependency, which
> would have made the two tasks circular). Implementing AC2's assertion in T4
> would either fail permanently or require a fake pass, neither acceptable
> under "the gate must pass before a task is done." T4 now proves ownership
> only (AC1); the provisioning assertion (AC2) is moved into T5, which is the
> task that creates the repository surface that assertion checks against. T5's
> dependency is corrected to `T1` (not `T1, T4`).
**Tests**: architecture · **Gate**: quick

#### T5: Provision the seven paths as T75 fixtures, and prove provisioning statically
**What**: A qualification-only provisioner that materializes the contract's paths on a matrix leg, plus the drift-guard assertion T4 deferred: a contract path nothing provisions fails the architecture gate.
**Where**: `scripts/provision-doctor-fixtures.mjs` (new), T75 workflow step, `tests/architecture/doctor-workspace-root.test.mjs`
**Depends on**: T1 (not T4 — see T4's scope note) · **Requirement**: DDL-03 (AD-019) · **AC**: 2
**Done when**:
- [ ] Provisions exactly the contract's paths and nothing else
- [ ] Not wired into `vestra init` or any user-facing command
- [ ] Integration test asserts the provisioned set equals the contract set
- [ ] A static architecture assertion fails the gate when a contract path has no provisioner reference (the defect this issue's original comment described, one level down), proven by a mutation in a disposable copy
- [ ] `pnpm gate:full` passes
**Tests**: integration + architecture · **Gate**: full

### Phase 2 — Async probe port

#### T6: Widen the probe port and collect sequentially
**What**: Allow a probe to return a promise; make `collectDoctorFacts` async with sequential awaits and a per-probe timeout.
**Where**: `packages/application/src/doctor/doctor-facts.ts:21,57`
**Depends on**: None · **Requirement**: DDL-04 · **AC**: 3, 4
**Done when**:
- [ ] A rejected promise degrades to present-and-unhealthy with no error text, matching the synchronous path
- [ ] A hanging probe resolves to `fail` via timeout rather than stalling the diagnostic
- [ ] Awaits are sequential; a test asserts probes do not overlap
- [ ] `pnpm gate:quick` passes
**Tests**: unit · **Gate**: quick

#### T7: Keep every observation inside the sentinel bracket
**What**: Await fact collection between the two sentinel captures.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:62-67`
**Depends on**: T6 · **Requirement**: DDL-05 · **AC**: 3
**Done when**:
- [ ] A sentinel mutated while an async probe is in flight fails the diagnostic closed
- [ ] No async work occurs before the first capture or after the second
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

### Phase 3 — Read-only surfaces and the transitive guard

#### T8: Add the platform-node read-only subpath
**What**: `@verchestra/platform-node/readonly` exporting only `inspectRuntimeDatabase` and `ProtectedPathBroker`.
**Where**: `packages/platform-node/src/readonly.ts` (new), package exports map
**Depends on**: None · **Requirement**: DDL-12
**Done when**:
- [ ] The subpath's own closure reaches no writer
- [ ] `RuntimeStore` is not reachable from it
- [ ] `pnpm test:architecture` passes
**Tests**: architecture · **Gate**: quick

#### T9: Export a pure policy-view digest and a policy read-only subpath
**What**: Extract `policyViewDigest(view)` from `CedarPolicyAdapter.#compile` as a pure export; add `@verchestra/policy/readonly` exporting it plus `verifyPolicyBundle`.
**Where**: `packages/policy/src/cedar-policy.ts`, `packages/policy/src/readonly.ts` (new)
**Depends on**: None · **Requirement**: DDL-07
**Done when**:
- [ ] The digest is computable without a `CedarEnginePort`
- [ ] The adapter's existing digest is byte-identical to the pure function's output (pinned test)
- [ ] `pnpm gate:quick` passes
**Tests**: unit · **Gate**: quick

#### T10: Add a read-only secret presence surface
**What**: A presence-only wrapper over `SecretAdapter.has`, exported at the platform-node read-only subpath.
**Where**: `packages/platform-node/src/readonly.ts`
**Depends on**: T8 · **Requirement**: DDL-09 · **AC**: 12
**Done when**:
- [ ] Returns a boolean; never returns or logs a secret value
- [ ] A test asserts `bind` is not called (spy on the broker)
- [ ] `pnpm gate:security` passes
**Tests**: unit + security · **Gate**: security

#### T11: Make the read-only guard transitive
**What**: Resolve the doctor composition's import closure and assert no module in it names a writer.
**Where**: `tests/architecture/doctor-readonly-graph.test.mjs`
**Depends on**: T8, T9, T10 · **Requirement**: DDL-12 · **AC**: 14
**Done when**:
- [ ] Closure resolved statically from source specifiers, not by executing imports
- [ ] A writer introduced anywhere in the closure fails the gate (mutation in a disposable copy)
- [ ] Existing textual assertions retained, not replaced
- [ ] `pnpm test:architecture` and `pnpm gate:security` pass
**Tests**: architecture + security · **Gate**: security

### Phase 4 — Live probes for existing surfaces

#### T12: Live sandbox probe
**What**: Construct a path broker over the control root and observe it refuses an out-of-root open.
**Where**: `apps/vestra-cli/src/doctor-composition.ts`
**Depends on**: T5, T7, T8 · **Requirement**: DDL-06 · **AC**: 5, 6
**Done when**:
- [ ] Refusal reports `pass`; a permitted out-of-root open reports `fail`
- [ ] Unprovisioned reports `blocked`
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T13: Live sqlite durable-state probe
**What**: Replace the file probe with `inspectRuntimeDatabase`.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:128`
**Depends on**: T5, T7, T8 · **Requirement**: DDL-08 · **AC**: 9, 10, 11
**Done when**:
- [ ] Integrity `ok` reports `pass`; a corrupt database reports `fail`; an absent file reports `blocked`
- [ ] A locked database reports `fail` rather than crashing (edge case 2)
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T14: Live cedar-policy probe
**What**: Read the active bundle read-only, verify it, and observe the policy-view digest.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:127`
**Depends on**: T5, T7, T9 · **Requirement**: DDL-07 · **AC**: 7, 8
**Done when**:
- [ ] Verifying bundle reports `pass`; a tampered bundle reports `fail`; absent reports `blocked`
- [ ] A truncated or zero-length bundle reports `fail` and does not throw out of `runDoctor` (edge case 3)
- [ ] The digest never reaches the sealed report
- [ ] `pnpm gate:security` passes
**Tests**: integration + security · **Gate**: security

#### T15: Live secret-presence probe
**What**: Replace the file probe with the read-only has-surface.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:131`
**Depends on**: T5, T7, T10 · **Requirement**: DDL-09 · **AC**: 12
**Done when**:
- [ ] Presence reports `pass`; absence reports `blocked`
- [ ] No secret name or value reaches the report
- [ ] `pnpm gate:security` passes
**Tests**: integration + security · **Gate**: security

### Phase 5 — Availability records

#### T16: Define the availability record contract
**What**: Schema plus a read-only reader; "available" means the record exists, parses, and declares an installed subsystem. Reachability is excluded by construction.
**Where**: `packages/contracts` schema + `packages/domain` reader
**Depends on**: T1 · **Requirement**: DDL-10 · **AC**: 13
**Done when**:
- [ ] Schema generated through its generator, never hand-edited
- [ ] No field can express a network endpoint or credential
- [ ] Contract test covers valid, absent, and unparseable records
- [ ] `pnpm gate:quick` passes
**Tests**: contract · **Gate**: quick

#### T17: Driver availability probe
**Where**: `apps/vestra-cli/src/doctor-composition.ts:133`
**Depends on**: T16 · **Requirement**: DDL-10 · **AC**: 13
**Done when**:
- [ ] Absent record reports `blocked`; unparseable reports `fail`; valid reports `pass`
- [ ] A record declaring a subsystem the build does not contain reports `fail` (edge case 4)
- [ ] `@verchestra/drivers` remains absent from the closure — guard unchanged
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T18: Connector availability probe
**Where**: `apps/vestra-cli/src/doctor-composition.ts:134`
**Depends on**: T16 · **Requirement**: DDL-10 · **AC**: 13
**Done when**: same three outcomes as T17; `@verchestra/connectors` absent from the closure; `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T19: Probe availability probe
**Where**: `apps/vestra-cli/src/doctor-composition.ts:135`
**Depends on**: T16 · **Requirement**: DDL-10 · **AC**: 13
**Done when**: same three outcomes as T17; `@verchestra/data-probe` absent from the closure; `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

### Phase 6 — Evidence and qualification

#### T20: Prove the report leaks nothing
**What**: Assert the sealed payload contains no path, value, digest, secret, or error string across all twelve checks.
**Where**: `tests/security/doctor-report-nonleak.test.mjs`
**Depends on**: T12–T19 · **Requirement**: DDL-11 · **AC**: 7, 15
**Done when**:
- [ ] Payload asserted against an allowlist of check ids, statuses, capability ids, and remediation codes
- [ ] A probe mutated to emit a path is killed by the test
- [ ] `pnpm gate:security` passes
**Tests**: security · **Gate**: security

#### T21: Prove source mode stays honest
**What**: In an unprovisioned checkout, all seven report `blocked`, never `fail`.
**Where**: `tests/integration/doctor-source-mode.test.mjs`
**Depends on**: T12–T19 · **Requirement**: DDL-13 · **AC**: 11, 15
**Done when**:
- [ ] Seven `blocked`, zero `fail`, five live checks unchanged
- [ ] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

#### T22: Record T75 matrix evidence
**What**: Run deep doctor on each provisioned matrix leg; capture the sealed report into fleet evidence.
**Where**: `.specs/features/platform-qualification-matrix/fleet/`, T75 workflow
**Depends on**: T20, T21 · **Requirement**: DDL-14
**Done when**:
- [ ] Each leg records a sealed report in which the seven checks are not `blocked`
- [ ] No machine-local path, home directory, or provider session appears in tracked evidence
- [ ] `pnpm gate:release` passes
**Tests**: system · **Gate**: release

---

## Task granularity check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1, T5, T8, T9, T16 | 1 new module each | Granular |
| T2, T3, T6, T7 | 1 file modified, single concern | Granular |
| T4, T11 | 1 guard extended | Granular |
| T10 | 1 function on an existing module | Granular |
| T12–T15, T17–T19 | 1 probe each | Granular |
| T20, T21 | 1 test file each | Granular |
| T22 | 1 evidence capture | Granular |

## Diagram-definition cross-check

| Task | Depends on (body) | Diagram | Status |
| ---- | ----------------- | ------- | ------ |
| T1 | None | phase head | Match |
| T2 | T1 | T1 → T2 | Match |
| T3 | T1 | T2 → T3 (same phase, backward) | Match |
| T4 | T3 | T3 → T4 | Match |
| T5 | T1, T4 | T4 → T5 | Match |
| T6 | None | phase head | Match |
| T7 | T6 | T6 → T7 | Match |
| T8 | None | phase head | Match |
| T9 | None | same-phase, independent | Match |
| T10 | T8 | T9 → T10 (backward) | Match |
| T11 | T8, T9, T10 | T10 → T11 | Match |
| T12 | T5, T7, T8 | prior phases | Match |
| T13 | T5, T7, T8 | prior phases | Match |
| T14 | T5, T7, T9 | prior phases | Match |
| T15 | T5, T7, T10 | prior phases | Match |
| T16 | T1 | prior phase | Match |
| T17–T19 | T16 | T16 → T17 → T18 → T19 | Match |
| T20 | T12–T19 | prior phases | Match |
| T21 | T12–T19 | prior phases | Match |
| T22 | T20, T21 | T21 → T22 | Match |

No task depends on a later phase.

## Test co-location validation

| Task | Layer modified | Matrix requires | Task says | Status |
| ---- | -------------- | --------------- | --------- | ------ |
| T1 | Domain primitive | unit | unit | OK |
| T2 | Adapter (workspace) | unit | unit | OK |
| T3 | Composition root + architecture | architecture | architecture | OK |
| T4 | Architecture invariants | architecture | architecture | OK |
| T5 | Script + composition boundary | integration | integration | OK |
| T6 | Application port | unit | unit | OK |
| T7 | Composition root | integration | integration | OK |
| T8 | Read-only adapter surface | architecture | architecture | OK |
| T9 | Read-only adapter surface | unit | unit | OK |
| T10 | Read-only adapter surface + non-leak | unit + security | unit + security | OK |
| T11 | Architecture + read-only property | architecture + security | architecture + security | OK |
| T12–T13 | Composition root | integration | integration | OK |
| T14–T15 | Composition root + non-leak | integration + security | integration + security | OK |
| T16 | Contract schema | contract | contract | OK |
| T17–T19 | Composition root | integration | integration | OK |
| T20 | Non-leak property | security | security | OK |
| T21 | Composition root | integration | integration | OK |
| T22 | Qualification evidence | system | system | OK |

## Requirement traceability

| Requirement | Tasks | Acceptance criteria |
| ----------- | ----- | ------------------- |
| DDL-01 | T1 | — |
| DDL-02 | T2, T3 | — |
| DDL-03 | T4, T5 | 1, 2 |
| DDL-04 | T6 | 3, 4 |
| DDL-05 | T7 | 3 |
| DDL-06 | T12 | 5, 6 |
| DDL-07 | T9, T14 | 7, 8 |
| DDL-08 | T13 | 9, 10, 11 |
| DDL-09 | T10, T15 | 12 |
| DDL-10 | T16, T17, T18, T19 | 13 |
| DDL-11 | T20 | 15 |
| DDL-12 | T8, T11 | 14 |
| DDL-13 | T21 | 11, 15 |
| DDL-14 | T22 | — |

**Coverage:** 14 requirements, 14 mapped to tasks, 0 unmapped. 15 acceptance criteria, 15 mapped.

## Completion rules

- One task, one passing gate, one atomic commit.
- Tests assert specification outcomes and are never weakened, deleted, or skipped.
- Update the portable handoff after every task.
- Independent verification and human review are required before completion.

## Execution evidence

| Task | Status | Commit |
| ---- | ------ | ------ |
| T1 | Done | recorded in `handoff.md` |
| T2 | Done | recorded in `handoff.md` |
| T3 | Done | recorded in `handoff.md` |
| T4 | Done | recorded in `handoff.md` |
| T5–T22 | Planned | Pending |
