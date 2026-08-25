# T75 executable matrices

`matrix.md` specifies the T75 case sets. This file records the point at which
each remaining dimension stopped being a declaration and became something the
gate executes, and it states what each matrix does **not** prove.

Issue #16. Measured on branch `t75-matrices`. Nothing here advances the
qualification chain; only an independently-authored report and human review can
close T75.

## Why a declaration was not enough

`matrix.json` declares 52 cases. Before this change, four dimensions —
platform, gate-profile, database and self-test — had their case sets derived
from canonical sources by `tests/agent-readiness/t75-matrix-declaration.test.mjs`.
The other six were prose, and every dimension's `evidence` field was validated
only for being a non-empty string. A case could therefore cite a test file that
no longer existed, or cite a test that no gate profile ran, and still read as
`qualified` while the whole suite passed.

Two failure modes follow from that, and both are the omission acceptance
criterion 1 forbids:

- **A case set can shrink silently.** A hand-written list loses a member without
  anything failing.
- **Evidence can rot.** A citation is a string until something resolves it.

Every matrix below is therefore built the same way: the case set is **derived
from the product**, the loop over it runs real assertions, and the evidence is
resolved rather than asserted.

## The matrices

| Dimension | Suite | Stage | Gate profiles |
| --------- | ----- | ----- | ------------- |
| Topology (decision) | `tests/unit/topology-placement-matrix.test.mjs` | `test:unit` | all five |
| Topology (scan → plan) | `tests/integration/topology-scan-to-plan-matrix.test.mjs` | `test:integration` | full, build |
| Driver | `tests/contract/driver-lifecycle-matrix.test.mjs` | `test:contract` | full, build, security |
| Database | `tests/contract/probe-engine-matrix.test.mjs` | `test:contract` | full, build, security |
| Sandbox | `tests/security/sandbox-isolation-matrix.test.mjs` | `test:security` | security, release |
| Installer | `tests/e2e/installer-lifecycle-matrix.test.mjs` | `test:e2e` | full, build, security |
| Recovery | `tests/fault-injection/recovery-boundary-matrix.test.mjs` | `test:fault` | full, security, release |
| Declaration binding | `tests/agent-readiness/t75-matrix-evidence-binding.test.mjs` | `test:agent-readiness` | quick |

### Topology

The canonical vocabulary is a product of unions, and the existing coverage
sampled it. `tests/unit/artifact-placement.test.mjs` asserts eleven hand-chosen
rows; three of the five Git relations had no explicit-colocated case, and two
placement guards existed only as strings in the error registry.

The decision matrix enumerates the **full cross product** — 4 placement modes ×
3 project placements × 5 Git relations × 3 owner states × 2 ignore × 2
authorization × 2 explicit-nested × 2 nested default × 2 project default =
**5760 configurations** — and asserts totality, guard reachability, and the
safety properties the policy exists to hold. It is pure, so it runs in every
gate profile.

The scan → plan matrix builds one real Git workspace carrying all five
relations at once and drives a real scan into a real write plan.

### Driver

Conformance to `interface Driver` (`packages/drivers/src/index.ts:366`) was a
compile-time claim only: five `implements Driver` clauses and no runtime
enumeration. The matrix derives the driver set from
`backend-serializers.ts:6` and the lifecycle method list from the interface
itself, then runs each driver through the probe contract's three shapes.

Every case is hermetic — the three CLI drivers run against the repository's own
fake executables, Pi against an injected version resolver — so nothing here can
pass because a provider happened to be installed on the runner.

### Database

AD-017's 1.0 claim is the published contract, the conformance kit, and real
SQLite. The kit parity suite already ran one case per engine, but its engine
list was hand-written, so a ninth engine would have entered with no kit case.
The matrix binds parity coverage, kit layout, and the published surface to the
closed `ENGINES` set, and proves the live/contract split by construction rather
than by reading the declaration.

### Sandbox

The seven boundary components already carry escape cases; the matrix does not
restate them. What had no executable coverage was the isolation **grade** axis:
the per-platform native control sets were evaluated only for whichever platform
the runner happened to be, and `container-isolated` was recorded as
not-qualified in prose. The matrix runs all three platforms from any runner and
pins the unimplemented grade in both directions.

### Installer

Every transition was covered individually and never as a sequence: every
uninstall case in the repository started from a fresh activate. The matrix runs
install → activate → rollback → uninstall against one install root, for each of
the six declared host targets.

It lives in `test:e2e` deliberately. The uninstall happy path previously existed
only in `test:integration`, which `gate:security` and `gate:release` do not run
(`matrix.md` section 2), so a release-gated run could see uninstall's refusals
but never its behaviour.

### Recovery

The durable-boundary matrix was already complete and structurally so: every
consumer iterates the frozen `FULL_DURABLE_BOUNDARY_IDS` export, and
`assertDurableBoundaryFacts` independently recomputes the expected cross
product. The matrix proves that mechanism is live by dropping each of the 22
cells in turn.

The activation fault points are the opposite: `ActivationFaultPoint` is a
**type-only** union with no runtime value to iterate, so
`tests/fault-injection/transactional-activation-faults.test.mjs` lists its seven
crash points by hand. The matrix reads the union from the product and checks the
suite against it in both directions.

## Recorded as `not configured` or `not qualified`

Stated here rather than omitted. None of these is counted as a pass.

| Case | Status | Reason |
| ---- | ------ | ------ |
| Live vendor CLI probes (Claude Code, Codex, OpenCode) | Not exercised by these matrices | The matrices are hermetic by design; `spikes/AGENTS.md` forbids provider requirements in mandatory gates. The live axis stays in `test:qualification`, where a missing provider fails rather than passing. |
| Pi version-drift probe | Covered in `tests/contract/pi-driver.test.mjs`, not in the driver matrix | Pi's drift case needs a manifest on disk rather than an environment variable. Recorded in the matrix's own comment; the shared absent-vs-unqualified property still covers Pi. |
| Seven non-SQLite engines | contract-qualified | No live server exists anywhere in this repository. `packages/data-probe` declares no third-party dependency, so there is no client that could reach one. Proven, not asserted. |
| `isolation-grade:native-restricted` | not-qualified | No platform can advertise it: the policy requires a 64-hex helper digest plus every required native control, and no such evidence is provisioned. |
| `isolation-grade:container-isolated` | not-qualified | Named nowhere in the isolation policy. The sandbox matrix pins that no platform can advertise it. |
| Isolation grades generally | Spike-only | No file under `packages/` references any isolation grade. The grade axis qualifies a spike, not shipped product code. |
| Activation `arch` mismatch | Not covered | The mixed-release guard is exercised on the `platform` axis only; no test mismatches `arch`. Carried forward from `matrix.md` M-3's correction. |

## Findings this work produced

1. **No scan → plan adapter exists in the product.** `createWritePlan`'s only
   product caller is `packages/memory/src/memory-lifecycle.ts:581`, and it
   receives a stored `PlacementSnapshot` (`:451`) rather than one derived from a
   scan. The two sides have already drifted in a way that proves nobody has
   crossed the seam: the scanner mints `repositoryId` as a canonical V2 digest
   (`v2:sha256:…`, `scanner-primitives.ts:139`) while the planner's owner
   validator admits only a bare `sha256:…`. A `repositoryId` handed straight to
   `gitOwnerId` is refused. Pinned by `the scanner's repository identity is not
   directly usable as a placement owner`; writing the adapter is a product
   change and was left out of scope.

2. **The driver dimension cited no test file at all.** Its evidence named
   directories (`spikes/claude-code-driver`) and prose. Corrected in
   `matrix.json`; statuses are unchanged, so the 42/52 verdict is unaffected.

3. **`evidence-index.json` and `fleet/` record different candidates.** The
   committed index is bound to `b738b047…` while all five committed fleet
   artifacts are bound to `97fa851…`, which is also the drift test's pinned
   revision. The drift test compares only summary counts and never the committed
   index bytes, which is why this has gone unnoticed. Left for the owner: the
   index is recorded evidence for a specific candidate and must not be
   regenerated against a different one as a side effect.

4. **`matrix.md` carries three stale references.** `BoundedQueue` (section 5)
   exists nowhere — the real names are `BoundedDriverEventQueue`
   (`packages/drivers/src/index.ts:281`) and `BoundedEventQueue`
   (`spikes/isolation/src/framed-protocol.mjs:149`). Section 5 cites
   `isolation-policy.mjs:17-23` for a three-grade union; those lines are
   `selectIsolationProfile` and name only `process-contained`. Section 6's
   "`packages/data-probe/package.json` has zero dependencies" is now false: it
   declares one internal workspace dependency. None of these changes a verdict.

5. **Two placement guards had never been executed.**
   `VES_PLACEMENT_OWNER_REQUIRED` and `VES_PLACEMENT_IGNORED_TARGET` appeared
   only in the error-registry listing. Both are now reached.

6. **The `nestedGitDefault` policy branch had zero coverage.** Every snapshot in
   the repository sets `requireExplicitNestedRepositoryWrites: true`, so
   `artifact-placement.ts:120` was never evaluated and
   `nestedGitDefault: "colocated"` had never been exercised.

## Discrimination

Every matrix was verified by reverting the behaviour it asserts and confirming
the failure. Each source file was restored byte-identically after each mutation
(`git diff --quiet`), and all 20 mutations were caught.

| Matrix | Mutation | Failures |
| ------ | -------- | -------- |
| Topology | remove `VES_PLACEMENT_OWNER_REQUIRED` guard | 3 |
| Topology | remove `VES_PLACEMENT_IGNORED_TARGET` guard | 3 |
| Topology | `external-control` no longer absolute | 1 |
| Topology | `isIndependent` narrowed to `nested` only | 3 |
| Scan → plan | broken repository still reports a Git owner | 1 |
| Scan → plan | worktree misclassified as nested | 2 |
| Scan → plan | canonical digest prefix `v2:` → `v3:` | 6 |
| Driver | absent Codex reports `available: true` | 2 |
| Driver | version drift collapses into `NOT_AVAILABLE` | 1 |
| Driver | Codex loses `cancel()` | 1 |
| Database | a ninth engine is added to `ENGINES` | 5 |
| Database | SAP ASE kit ignores `options.realConnection` | 1 |
| Database | a real postgres client dependency is added | 1 |
| Sandbox | native controls require ANY instead of EVERY | 14 |
| Sandbox | `container-isolated` becomes advertisable | 5 |
| Sandbox | unknown platform defaults instead of refusing | 1 |
| Sandbox | evidence digest no longer validated | 3 |
| Installer | darwin dropped from accepted targets | 4 |
| Installer | rollback skips health re-inspection | 6 |
| Installer | uninstall without purge deletes releases | 6 |
| Recovery | an eighth `ActivationFaultPoint` is declared | 3 |
| Recovery | durable-matrix completeness guard removed | 1 |

## What these matrices do not prove

- **That any live vendor CLI, database engine, or provider session works.** Every
  case here is hermetic. The live axis is `test:qualification` and the fleet.
- **That the sandbox grade axis protects product code.** It qualifies
  `spikes/isolation`, which has no product counterpart.
- **That the fleet ran them.** These suites run wherever their stage runs; a
  fleet dispatch is what binds them to a platform. `test:integration` is still
  absent from `gate:security` and `gate:release`, so the scan → plan matrix
  reaches the fleet only through `full` and `build`.
- **That the declaration is correct.** The binding proves the declaration agrees
  with the product and that its evidence resolves. Whether a case *should* be
  qualified remains a reviewed judgment.
