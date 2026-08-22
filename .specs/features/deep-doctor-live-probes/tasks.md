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
- [x] Provisions exactly the contract's paths and nothing else
- [x] Not wired into `vestra init` or any user-facing command
- [x] Integration test asserts the provisioned set equals the contract set
- [x] A static architecture assertion fails the gate when a contract path has no provisioner reference (the defect this issue's original comment described, one level down), proven by a mutation in a disposable copy
- [x] `pnpm gate:full` passes
**Tests**: integration + architecture · **Gate**: full

### Phase 2 — Async probe port

#### T6: Widen the probe port and collect sequentially
**What**: Allow a probe to return a promise; make `collectDoctorFacts` async with sequential awaits and a per-probe timeout.
**Where**: `packages/application/src/doctor/doctor-facts.ts:21,57`
**Depends on**: None · **Requirement**: DDL-04 · **AC**: 3, 4
**Done when**:
- [x] A rejected promise degrades to present-and-unhealthy with no error text, matching the synchronous path
- [x] A hanging probe resolves to `fail` via timeout rather than stalling the diagnostic
- [x] Awaits are sequential; a test asserts probes do not overlap
- [x] `pnpm gate:quick` passes
**Tests**: unit · **Gate**: quick

> **Scope note (2026-08-22): ripple beyond T6's stated "Where".** Widening
> `collectDoctorFacts`'s return type to `Promise<...>` broke every existing
> synchronous caller — not only the eight pre-existing tests in
> `tests/unit/doctor-facts.test.mjs`, but three more consumers the plan never
> named: `apps/vestra-cli/src/doctor-composition.ts:67` (a bare `await` was
> the minimal compile-fix; the full sentinel-bracket proof stays T7's job),
> and `tests/public-regression/corpus.mjs`'s T73-frozen `doctor-facts-complete`
> campaign plus its `runCampaign` runner, which two more test files depend on
> (`tests/public-regression/campaigns.test.mjs`,
> `tests/system/regression-summary.test.mjs`). Verified the corpus digest is
> unaffected: `canonicalizeCorpus` serializes only campaign `def` metadata,
> never `check` function bodies, and "the corpus digest is stable and
> change-sensitive" still passes unchanged. `runCampaign` becoming `async` is
> behavior-preserving for every other (synchronous) campaign check, since
> `await` on an already-resolved value is a same-tick no-op.
>
> A second, unplanned obstacle: Node's built-in `mock.timers` in this
> repository's pinned Node 24.14.0 has no `tickAsync`, and a naive single
> `tick()` call raced against the async collection loop's own microtask
> chain (documented in the test file). Fixed two ways: `withTimeout` now
> skips timer creation entirely for a non-Promise observation — a real
> simplification, since a synchronous value cannot hang, not only a test
> accommodation — and the timeout test polls microtasks until the probe
> under test has actually run before advancing the mock clock.
**Verified**: `pnpm gate:quick` PASS; `pnpm gate:full` PASS; `pnpm gate:release`
run separately to exercise `test:release` (not included in `gate:full`) —
public-regression and regression-summary suites pass; the release gate's two
failures are pre-existing spike tests pinning a specific locally-installed
Claude Code/Codex CLI version, confirmed identical on a clean tree via
`git stash`, unrelated to this task.

#### T7: Keep every observation inside the sentinel bracket
**What**: Await fact collection between the two sentinel captures.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:62-67`
**Depends on**: T6 · **Requirement**: DDL-05 · **AC**: 3
**Done when**:
- [x] A sentinel mutated while an async probe is in flight fails the diagnostic closed
- [x] No async work occurs before the first capture or after the second
- [x] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

### Phase 3 — Read-only surfaces and the transitive guard

#### T8: Add the platform-node read-only subpath
**What**: `@verchestra/platform-node/readonly` exporting only `inspectRuntimeDatabase` and `ProtectedPathBroker`.
**Where**: `packages/platform-node/src/readonly.ts` (new), package exports map
**Depends on**: None · **Requirement**: DDL-12
**Done when**:
- [x] The subpath's own closure reaches no writer
- [x] `RuntimeStore` is not reachable from it
- [x] `pnpm test:architecture` passes
**Tests**: architecture · **Gate**: quick

> **Note (2026-08-22):** two false-positive guard trips fixed by rewording
> `readonly.ts`'s own header comment, mirroring
> `doctor-readonly-graph.test.mjs`'s own stated convention ("Symbol names, not
> English words ... so the file's own prose cannot trip the guard"): the
> comment originally spelled out the forbidden class names and the literal
> text `` `export *` `` in prose, tripping its own guard. Reworded around both.

#### T9: Export a pure policy-view digest and a policy read-only subpath
**What**: Extract `policyViewDigest(view)` from `CedarPolicyAdapter.#compile` as a pure export; add `@verchestra/policy/readonly` exporting it plus `verifyPolicyBundle`.
**Where**: `packages/policy/src/cedar-policy.ts`, `packages/policy/src/readonly.ts` (new)
**Depends on**: None · **Requirement**: DDL-07
**Done when**:
- [x] The digest is computable without a `CedarEnginePort`
- [x] The adapter's existing digest is byte-identical to the pure function's output (pinned test)
- [x] `pnpm gate:quick` passes
**Tests**: unit · **Gate**: quick

> **Note (2026-08-22):** `#compile`'s local variable was already named
> `policyViewDigest`, colliding with the required export name. The pure
> function is defined internally as `computePolicyViewDigest` and exported
> under the alias `export { computePolicyViewDigest as policyViewDigest }`,
> so `#compile`'s body needed only two lines changed (its fallback-then-
> reassign dance collapses to one upfront call) rather than a rename across
> every reference. `apps/vestra-cli` does not yet depend on
> `@verchestra/policy` — adding that dependency is deferred to whichever task
> first imports it from the composition root (T14), not done speculatively
> here.

#### T10: Add a read-only secret presence surface
**What**: A presence-only wrapper over `SecretAdapter.has`, exported at the platform-node read-only subpath.
**Where**: `packages/platform-node/src/readonly.ts`
**Depends on**: T8 · **Requirement**: DDL-09 · **AC**: 12
**Done when**:
- [x] Returns a boolean; never returns or logs a secret value
- [x] A test asserts `bind` is not called (spy on the broker)
- [x] `pnpm gate:security` passes
**Tests**: unit + security · **Gate**: security

> **Note (2026-08-22): a spy-target bug found by its own discrimination
> sensor.** The first version of the "never binds" test spied on
> `broker.bind` for one fixture-owned broker instance. A mutation making
> `secretPresence` construct and bind through its own internal broker
> instance was caught by the architecture guard (a new class name became
> reachable) but NOT by the security test itself — the spy only intercepts
> calls through the specific instance it wraps, not the class generally.
> Fixed by spying on `SecretBroker.prototype.bind`, which intercepts any
> instance. Re-ran the same mutation: both the architecture guard and the
> security test now fail it. `gate:security` cannot complete on this machine
> — it stops at a pre-existing, unrelated `test:qualification` failure (two
> spike tests pinned to a locally-installed Claude Code/Codex CLI version,
> confirmed identical on a clean tree via `git stash`, same as noted in T6).
> Ran `pnpm test:security` directly instead: 1049/1049.

#### T11: Make the read-only guard transitive
**What**: Resolve the doctor composition's import closure and assert no module in it names a writer.
**Where**: `tests/architecture/doctor-readonly-graph.test.mjs`
**Depends on**: T8, T9, T10 · **Requirement**: DDL-12 · **AC**: 14
**Done when**:
- [x] Closure resolved statically from source specifiers, not by executing imports
- [x] A writer introduced anywhere in the closure fails the gate (mutation in a disposable copy)
- [x] Existing textual assertions retained, not replaced
- [x] `pnpm test:architecture` and `pnpm test:security` pass (`gate:security` blocked by the same pre-existing environment issue as T10)
**Tests**: architecture + security · **Gate**: security

> **Note (2026-08-22):** the closure resolves 67 files from
> `doctor-composition.ts` (relative imports plus `@verchestra/*`
> package-exports-mapped paths), never executed — pure text read and regex
> extraction. The check operates on import EDGES (specifier strings), not raw
> file text, deliberately: a text scan for forbidden class names across ~67
> files risks the same false-positive-in-prose class that
> `platform-node-readonly-subpath.test.mjs` and `policy-readonly-subpath.test.mjs`
> hit on their own single files (T8, T9) — at 67 files the odds of an
> incidental match go up, not down. Discrimination proven with a mutation two
> hops from the entry file (`doctor-facts.ts` importing `@verchestra/drivers`)
> that the four pre-existing tests cannot see, since none of them inspect
> anything past `doctor-composition.ts`'s own text — only the new test
> fails. Also confirmed the allowed/forbidden boundary is drawn correctly: an
> entry-file import of `@verchestra/platform-node/readonly` passes, the bare
> `@verchestra/platform-node` root fails both the new test and the existing
> allowlist test.

### Phase 4 — Live probes for existing surfaces

#### T12: Live sandbox probe
**What**: Construct a path broker over the control root and observe it refuses an out-of-root open.
**Where**: `apps/vestra-cli/src/doctor-composition.ts`
**Depends on**: T5, T7, T8 · **Requirement**: DDL-06 · **AC**: 5, 6
**Done when**:
- [x] Refusal reports `pass`; a permitted out-of-root open reports `fail`
- [x] Unprovisioned reports `blocked`
- [x] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

> **Two findings during T12, recorded here (2026-08-22):**
>
> **1. Scope reach-back into T5 (approved by the user before implementing).**
> `LogicalPath.parse` already rejects any naive `../` logical path, so the
> broker's out-of-root refusal is reachable only through a symlink/junction
> escape — and T5's provisioner (already committed) only created a bare
> empty `sandbox/` directory, nothing to escape through. Without a real
> escape artifact, the check could only ever report `blocked` on a real T75
> leg, never a genuine `pass` — defeating DDL-06's purpose for this one
> check. Extended `scripts/provision-doctor-fixtures.mjs` to also plant a
> directory symlink/junction (`sandbox/escape`, pointing at its own parent
> `.verchestra/`, which the same run already populated with `runtime.db`) —
> self-contained, no dependency on anything outside what the run itself
> provisions. Cross-platform via the same convention
> `tests/security/protected-path.test.mjs` already uses (a junction on
> Windows, a directory symlink elsewhere). Added a dedicated test proving the
> escape resolves genuinely outside the sandbox root, and confirmed the real
> `ProtectedPathBroker` refuses it with `VES_PATH_OUTSIDE_ROOT` before wiring
> the doctor probe. T5's own 5 tests still pass unchanged, including
> idempotency.
>
> **2. A real regression, caught by `gate:full`, not pre-existing.** Wiring
> `@verchestra/platform-node/readonly` into `doctor-composition.ts` broke
> 12 e2e tests — `apps/vestra-cli/src/main.ts` imports `doctor-composition.ts`
> unconditionally on every CLI invocation, and `readonly.ts`'s eager
> `export {...} from "./runtime-store/runtime-store.ts"` transitively loads
> `node:sqlite`, which prints a PID-bearing experimental-feature warning to
> stderr the moment it is imported — not merely when used. This broke
> `tests/e2e/cli-launchers-e2e.test.mjs`'s byte-equal stderr comparison
> between two separate process launches, for commands (`--version`, `--help`,
> `sync`) with nothing to do with SQLite or the doctor at all. Confirmed via
> `git stash` that 165/165 e2e tests passed before this task's changes.
> Fixed at the source: `inspectRuntimeDatabase` in `readonly.ts` became an
> async wrapper that dynamically imports `runtime-store.ts` only when
> actually called, deferring both the module evaluation and the warning to
> the moment a live probe (T13) genuinely uses it. This introduced a dynamic
> `import(...)` edge invisible to T11's static closure walker (which only
> recognized `from "..."` syntax) — extended that walker's regex to
> recognize dynamic imports too, so the property T11 proves does not
> quietly weaken because of this fix. Full e2e suite confirmed restored to
> 165/165.

#### T13: Live sqlite durable-state probe
**What**: Replace the file probe with `inspectRuntimeDatabase`.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:128`
**Depends on**: T5, T7, T8 · **Requirement**: DDL-08 · **AC**: 9, 10, 11
**Done when**:
- [x] Integrity `ok` reports `pass`; a corrupt database reports `fail`; an absent file reports `blocked`
- [x] A locked database reports `fail` rather than crashing (edge case 2)
- [x] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

> **Note (2026-08-22): the fixture problem flagged after T12 hit exactly as
> predicted, plus one more finding.**
>
> **Fixture**: `scripts/provision-doctor-fixtures.mjs`'s `runtime.db` was an
> empty placeholder; `inspectRuntimeDatabase` can never report `ok` against
> one. Fixed by opening and closing a real `RuntimeStore` there — the
> product's own migration path, not hand-rolled schema SQL — so the fixture
> carries the actual schema (confirmed: `{integrity:"ok", runs:0,
> migrations:10}`). The main provisioning loop now special-cases
> `sqlite-durable-state` to skip the generic empty-file write, matching the
> precedent T12 already set for `sandbox`'s post-loop treatment; T4's
> "generic iteration, never hand-listed" guard still passes since the
> `Object.entries(SUBSYSTEM_OBSERVATION_PATHS)` loop itself is untouched.
>
> **Edge case 2 ("locked database") could not be tested as literally
> written, and that itself needed a decision.** Empirically verified (a real
> `DatabaseSync(...).exec("BEGIN EXCLUSIVE")` from a second connection) that
> a WAL-mode read-only open is **not** blocked by another connection's
> exclusive writer lock — SQLite's own concurrency model, not a gap in this
> code. A literal "locked database" scenario cannot be reproduced to fail at
> all, so the check `sqliteDurableStateProbe` performs was split into
> `evaluateRuntimeDatabase(inspect)`, an independently testable pure mapping
> accepting the inspect call as a parameter — mirroring T12's
> `evaluateSandboxEscape` pattern. The edge case is honestly tested as "any
> injected error, lock-shaped included, degrades to `fail`, never a crash or
> a silent pass" rather than a literal lock reproduction that would not
> actually fail. Recorded here rather than silently narrowing the Done-when
> bullet's literal wording.
>
> A second false-positive guard trip, same class as T8/T9/T12: the
> function's own doc comment originally read `distinguish "corrupt" from
> "locked"`, accidentally matching the `from "..."` import-statement regex
> the closure walker uses. Reworded around it.

#### T14: Live cedar-policy probe
**What**: Read the active bundle read-only, verify it, and observe the policy-view digest.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:127`
**Depends on**: T5, T7, T9 · **Requirement**: DDL-07 · **AC**: 7, 8
**Done when**:
- [x] Verifying bundle reports `pass`; a tampered bundle reports `fail`; absent reports `blocked`
- [x] A truncated or zero-length bundle reports `fail` and does not throw out of `runDoctor` (edge case 3)
- [x] The digest never reaches the sealed report
- [x] `pnpm gate:full` passes (`test:security` 1049/1049 directly — `gate:security` blocked by the pre-existing environment issue noted at T10)
**Tests**: integration + security · **Gate**: security

> **The largest decision point in this feature, recorded here (2026-08-22).**
> `PolicyBundleCrypto` (sha256 + Ed25519 verify) has **no production
> implementation anywhere in the repository** — `buildPolicyBundle`/
> `verifyPolicyBundle` had only ever been exercised by unit tests using a toy
> HMAC-style crypto; nothing signs a real policy bundle in production today.
> Stopped and asked before implementing rather than inventing a security
> scheme unilaterally. Decided: real Ed25519 via `node:crypto`, applying the
> product's already-established convention
> (`packages/evidence/src/integrity/artifact-sealer.ts`: spki-der public key,
> base64url signature) rather than a new one — `cedarPolicyReadOnlyCrypto()`
> in `doctor-composition.ts` implements `sha256` and `verify` for real;
> `sign` throws unconditionally, since `PolicyBundleCrypto` requires the
> method structurally even though `verifyPolicyBundle` never calls it, and a
> throwing stub proves the capability is genuinely absent rather than merely
> unused today. `apps/vestra-cli/package.json` gained
> `@verchestra/policy: workspace:0.0.0` (deferred from T9); `pnpm install`
> (not `--frozen-lockfile`) updated `pnpm-lock.yaml` by exactly 3 lines —
> confirmed a pure workspace-symlink addition, no external resolution.
>
> **Fixture, following the T12/T13 precedent**: `scripts/provision-doctor-fixtures.mjs`
> mints a fresh Ed25519 keypair each run and builds a real signed bundle via
> `buildPolicyBundle` — not hand-assembled JSON — purely for fixture
> purposes; it is not a trust root anything else relies on.
>
> **Scope resolved from the spec, not guessed.** Design.md's prose ("observe
> a stable policy-view digest") suggested calling T9's separately-extracted
> `policyViewDigest(view)` on some Bundle-derived `PolicyView` — but
> `PolicyBundle` (`{policies: [{id, cedar}]}`) and `PolicyView`
> (`{schema, layers}`) are structurally different, unrelated shapes with no
> natural mapping, and inventing one would encode an unreviewed assumption
> about how bundles and views relate. Spec.md's actual acceptance criteria
> (AC7/AC8) only require the bundle's own verification outcome; that
> requirement is already satisfied by `verifyPolicyBundle`'s own internal
> digest-reproduction check. Implemented against the spec's literal
> criteria, not the looser design prose.
>
> **A real test-coverage gap, found by its own discrimination sensor.** The
> first "tampered bundle" test changed policy content without re-signing —
> caught by `verifyPolicyBundle`'s own digest-reproduction check, before the
> signature step is ever reached. A mutation replacing doctor's Ed25519
> `verify` with `() => true` survived all 5 original tests. Added a test
> that corrupts only the `signature` field while leaving the digest
> internally consistent, isolating the cryptographic check specifically —
> the mutation is now caught.
>
> **A discovery that killed a test I'd written, not a bug in the code.** A
> test asserting "a bundle signed with a different key is rejected" failed —
> not because of a defect, but because `verifyPolicyBundle` has no
> trust-root/expected-key pinning at all: it proves internal
> self-consistency (signature matches its own embedded `publicKeyRef`), not
> that the signer is a trusted party. Pinning an expected key is out of
> DDL-07's scope (no trust root exists anywhere yet). Removed the test
> rather than leave one whose name claimed a property the mechanism doesn't
> provide.

#### T15: Live secret-presence probe — DEFERRED (2026-08-22)
**What**: Replace the file probe with the read-only has-surface.
**Where**: `apps/vestra-cli/src/doctor-composition.ts:131`
**Depends on**: T5, T7, T10 · **Requirement**: DDL-09 · **AC**: 12
**Status**: Deferred, not implemented. `doctor.secret-presence` remains the
original `fileProbe` check from before this feature.

> **Why deferred.** `secretPresence` (T10) needs a real `SecretAdapter` to
> call `.has()` on. `QualifiedOsSecretAdapter` requires a real
> `OsSecretBackend` — Windows CNG, Apple Keychain, or Linux Secret Service —
> and **zero implementation of any of the three exists anywhere in this
> repository**, not even partially; confirmed by searching
> `packages`/`apps` for any construction of `QualifiedOsSecretAdapter` or
> any concrete `OsSecretBackend` outside `secret-broker.ts`'s own interface
> declaration. Nothing in `apps/vestra-cli` constructs a real secret adapter
> at all today, for any purpose. This is native per-platform credential-store
> integration — three separate subprocess- or binding-based backends, each
> with its own qualification burden — not a self-contained primitive like
> T14's Ed25519 verifier. Building it here would mean inventing a new
> product capability unilaterally inside a task whose stated scope was one
> probe wire-up.
>
> Stopped and asked before implementing, given the size of the gap. Decided:
> defer T15, leave `doctor.secret-presence` on its current (correct, if
> non-live) file-presence check, and continue the feature's remaining tasks.
> `MockSecretAdapter` was considered and rejected — it starts empty on every
> real machine, so it would satisfy DDL-09's letter (a real `.has()` call)
> while defeating its purpose (a genuine live observation): the check could
> never report `pass` on a real machine, exactly the failure mode the
> T12/T13/T14 fixture-content work existed to avoid.
>
> **Follow-up**: T15 can resume once a real `OsSecretBackend` exists for at
> least one platform — most naturally as part of whatever future work
> actually needs live OS-secret access for a non-diagnostic purpose (secret
> binding at run time), since that is where the backend's real requirements
> would first be established. Building it inside deep-doctor speculatively,
> with no other consumer to validate the design against, risks the same
> problem T14's policy-crypto question raised: encoding an unreviewed
> assumption with no prior art to anchor it.

### Phase 5 — Availability records

#### T16: Define the availability record contract
**What**: Schema plus a read-only reader; "available" means the record exists, parses, and declares an installed subsystem. Reachability is excluded by construction.
**Where**: `packages/contracts` schema + `packages/domain` reader
**Depends on**: T1 · **Requirement**: DDL-10 · **AC**: 13
**Done when**:
- [x] Schema generated through its generator, never hand-edited
- [x] No field can express a network endpoint or credential
- [x] Contract test covers valid, absent, and unparseable records
- [x] `pnpm gate:quick` passes
**Tests**: contract · **Gate**: quick

> **Note (2026-08-22):** the schema (`schemas/subsystem-availability/1.schema.json`)
> is deliberately minimal — `{schemaVersion, subsystem, available}`, no
> free-text or URI-shaped field at all — so "no field can express a network
> endpoint or credential" holds by construction, not by convention.
> `packages/contracts/src/generated.ts` regenerated via
> `node scripts/generate-contract-types.mjs`; diff confirmed additive only
> (6 lines, one new interface, nothing else changed). `packages/domain/src/workspace-layout/subsystem-availability.ts`
> is the hand-written structural reader (domain takes no third-party import,
> so it cannot use the ajv-backed `SchemaRegistry`); `tests/contract/schema-registry.test.mjs`
> exercises the schema itself, `tests/unit/subsystem-availability.test.mjs`
> exercises the reader — 8 cases: valid per subsystem, `available: false`
> distinct from absence, non-object/undefined (absent), unknown field,
> unsupported version, undeclared subsystem, non-boolean `available`,
> frozen output. Discrimination proven on the reader's field-whitelist
> check; restored by rewriting the correct content (file is new/untracked,
> `git checkout --` would have wiped it, same lesson as T8/T10).

#### T17: Driver availability probe
**Where**: `apps/vestra-cli/src/doctor-composition.ts:133`
**Depends on**: T16 · **Requirement**: DDL-10 · **AC**: 13
**Done when**:
- [x] Absent record reports `blocked`; unparseable reports `fail`; valid reports `pass`
- [x] A record declaring a subsystem the build does not contain reports `fail` (edge case 4)
- [x] `@verchestra/drivers` remains absent from the closure — guard unchanged
- [x] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

> **Note (2026-08-22): a fifth outcome AC13's text didn't literally pin down,
> resolved by extending an existing convention.** AC13 covers absent
> (blocked), unparseable (fail), and (implicitly) valid+matching+available
> (pass) — it does not address a *well-formed* record whose `available`
> field is `false`. Resolved by extension of `observeToFact`'s own existing
> distinction (absent = "cannot run until provisioned", present-but-wrong =
> "there and wrong"): a record correctly declaring "not installed here" is
> semantically closer to not-yet-provisioned than to broken, so it maps to
> `blocked`, not `fail`. Documented inline in the probe's own comment rather
> than silently picked. Proven distinct from "unparseable" and from
> "wrong subsystem declared" (edge case 4) by two separate discrimination
> mutations, both caught by the correct, distinct tests.
>
> `availabilityProbe(metadataRoot, subsystem)` is the shared implementation
> T18/T19 reuse unmodified — this task builds it once. `scripts/provision-doctor-fixtures.mjs`
> gained a generic loop writing `availability.json` for all three
> availability subsystems (driver, connector, probe) in one pass, matching
> T4's "generic iteration, never hand-listed" discipline; T18/T19 need no
> further provisioner work.
>
> A fourth false-positive guard trip, same class as T8/T9/T12/T13: the
> probe's own comment named the three forbidden package specifiers literally
> in prose. Reworded around it.

#### T18: Connector availability probe
**Where**: `apps/vestra-cli/src/doctor-composition.ts:134`
**Depends on**: T16 · **Requirement**: DDL-10 · **AC**: 13
**Done when**: same three outcomes as T17; `@verchestra/connectors` absent from the closure; `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

> **Note (2026-08-22): a test-isolation gap found before it mattered.** The
> first mutation sensor (wiring `doctor.connector` to read driver's fixture
> instead of its own) was only caught by the "wrong subsystem declared" test
> — coincidentally, because THAT test's tampering happened to target
> connector's own path. The "valid record reports pass" test didn't
> discriminate the mutation at all: driver's real fixture is also
> valid+matching+available for its own subsystem, so reading it under
> connector's identity still reported `pass`. Added a test that deletes only
> driver's fixture and confirms connector's check is unaffected, isolating
> the wiring itself rather than relying on incidental coverage from a
> differently-purposed test. Re-ran the mutation: now caught directly by the
> isolating test, not just the coincidentally-adjacent one.
>
> One-line wiring change (`buildRealProbes`'s `"doctor.connector"` entry now
> calls the shared `availabilityProbe(metadataRoot, "connector")` T17
> built); no new probe logic, no provisioner change (T17's generic loop
> already covers connector's fixture).

#### T19: Probe availability probe
**Where**: `apps/vestra-cli/src/doctor-composition.ts:135`
**Depends on**: T16 · **Requirement**: DDL-10 · **AC**: 13
**Done when**: same three outcomes as T17; `@verchestra/data-probe` absent from the closure; `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

> **Note (2026-08-22):** wrote the wiring-isolation test first this time,
> applying T18's lesson immediately rather than rediscovering the same gap.
> Confirmed by mutation: wiring `doctor.probe` to read connector's fixture
> is now caught directly by the isolation test, not by incidental overlap
> with a differently-purposed test. One-line wiring change; no new probe
> logic; no provisioner change.
>
> **Phase 5 (availability records) is complete — T16 through T19.**

### Phase 6 — Evidence and qualification

#### T20: Prove the report leaks nothing
**What**: Assert the sealed payload contains no path, value, digest, secret, or error string across all twelve checks.
**Where**: `tests/security/doctor-report-nonleak.test.mjs`
**Depends on**: T12–T19 · **Requirement**: DDL-11 · **AC**: 7, 15
**Done when**:
- [x] Payload asserted against an allowlist of check ids, statuses, capability ids, and remediation codes
- [x] A probe mutated to emit a path is killed by the test
- [x] `pnpm gate:security` passes (`test:security` 1052/1052 directly — `gate:security` blocked by the pre-existing environment issue from T10)
**Tests**: security · **Gate**: security

> **Note (2026-08-22): three rounds of discrimination, not one — because the
> first two "mutations" correctly did NOT fail, and that itself needed
> proving rather than assuming.**
>
> Round 1: a real T12-T19 probe (`sandboxProbe`) mutated, via an
> `as unknown as DoctorObservation` cast bypassing TypeScript's own
> excess-property check, to return `{present, healthy, leakedPath: "..."}`.
> Both the new end-to-end tests and the unit-level test still passed
> unchanged — correctly: `observeToFact` reads only `.present`/`.healthy`,
> so nothing else on the object is ever copied anywhere. This is the
> structural guarantee holding, not a gap.
>
> Round 2: the same probe mutated to genuinely `throw` an error containing
> real path and "SQLite format 3" text. Still no leak — `collectDoctorFacts`
> (already qualified since T72) discards a thrown error's message
> entirely. Confirms the guarantee against a real T12-T19 probe, not only
> the synthetic ones `tests/security/doctor-diagnostic.test.mjs` already
> covered.
>
> Round 3 (the actual discrimination proof — a positive control): since
> rounds 1 and 2 both passed, I needed to confirm the ASSERTIONS themselves
> can catch a real leak, not merely that none occurred. Injected a known-bad
> value directly into a real sealed payload (bypassing the probe layer
> entirely) and confirmed the SAME assertion style — allowlist membership,
> the `NO_PATH` pattern — correctly flags it. Without this round, "no
> mutation failed" would have been indistinguishable from "the test can't
> fail."
>
> Both source mutations were applied and reverted in place (tracked file,
> `git status` confirmed clean before and after); no committed code changed
> beyond the new test file.

#### T21: Prove source mode stays honest
**What**: In an unprovisioned checkout, all seven report `blocked`, never `fail`.
**Where**: `tests/integration/doctor-source-mode.test.mjs`
**Depends on**: T12–T19 · **Requirement**: DDL-13 · **AC**: 11, 15
**Done when**:
- [x] Seven `blocked`, zero `fail`, five live checks unchanged
- [x] `pnpm gate:full` passes
**Tests**: integration · **Gate**: full

> **Note (2026-08-22):** "all seven checks" still reads correctly with T15
> deferred — `secret-presence`'s unchanged file-presence check also degrades
> to `blocked` (not `fail`) on a bare checkout, since that was already its
> behavior before this feature touched anything else; confirmed directly
> rather than assumed. Discrimination proven with a mutation making
> `sandboxProbe`'s outer catch report `fail` instead of `blocked` when the
> broker can't be constructed (unprovisioned root) — caught by the exact
> intended test, the other two unaffected.

#### T22: Record T75 matrix evidence — PENDING HUMAN TRIGGER (2026-08-22)
**What**: Run deep doctor on each provisioned matrix leg; capture the sealed report into fleet evidence.
**Where**: `.specs/features/platform-qualification-matrix/fleet/`, `.github/workflows/platform-matrix.yml`
**Depends on**: T20, T21 · **Requirement**: DDL-14
**Done when**:
- [ ] Each leg records a sealed report in which the seven checks are not `blocked`
- [ ] No machine-local path, home directory, or provider session appears in tracked evidence
- [ ] `pnpm gate:release` passes
**Tests**: system · **Gate**: release

> **Why this is the one task a local session cannot complete.**
> `platform-matrix.yml` is `workflow_dispatch` only — deliberately never
> `push`/`pull_request` — and runs the real multi-platform fleet on GitHub
> Actions runners, landing reviewed evidence files under
> `.specs/features/platform-qualification-matrix/fleet/`. Every prior task
> in this feature ran real code against real local fixtures; T22 needs real
> CI infrastructure across multiple operating systems, which this session
> has no access to trigger or execute.
>
> **To run it:** `gh workflow run platform-matrix.yml --ref
> feat/deep-doctor-live-probes` (or the same dispatch via the Actions UI),
> selecting this branch's exact revision. Once the fleet completes, its
> evidence needs review before recording — a fresh Claude Code session (or
> this one, resumed) can then verify each leg's sealed report shows the
> seven upgraded checks as `pass`/`fail` rather than `blocked` (proving the
> T75 fixtures were genuinely provisioned and the live probes observed them
> for real), confirm no machine-local path leaked into the committed
> evidence, and run `pnpm gate:release`.
>
> **T1 through T21 are complete and merge-ready independent of T22** — the
> feature's own code, tests, and gates all pass now. T22 is qualification
> evidence *about* that code on real hardware, not a prerequisite for the
> code itself being correct.

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
| DDL-09 | T10, T15 (T15 deferred — see its note) | 12 (partial: presence surface exists, not wired) |
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
| T5 | Done | recorded in `handoff.md` |
| T6 | Done | recorded in `handoff.md` |
| T7 | Done | recorded in `handoff.md` |
| T8 | Done | recorded in `handoff.md` |
| T9 | Done | recorded in `handoff.md` |
| T10 | Done | recorded in `handoff.md` |
| T11 | Done | recorded in `handoff.md` |
| T12 | Done | recorded in `handoff.md` |
| T13 | Done | recorded in `handoff.md` |
| T14 | Done | recorded in `handoff.md` |
| T15 | Deferred | AD-023 |
| T16 | Done | recorded in `handoff.md` |
| T17 | Done | recorded in `handoff.md` |
| T18 | Done | recorded in `handoff.md` |
| T19 | Done | recorded in `handoff.md` |
| T20 | Done | recorded in `handoff.md` |
| T21 | Done | recorded in `handoff.md` |
| T22 | Planned | Pending |
