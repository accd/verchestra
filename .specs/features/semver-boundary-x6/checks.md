# Semver boundary (X6) checks

Build: `corepack pnpm exec tsc --noEmit`; `corepack pnpm exec eslint packages/domain/src/primitives/semver.ts packages/application/src/sync/workspace-reconcile.ts apps/vestra-cli/src/cli.ts tests/unit/semantic-version.test.mjs tests/contract/cli-surface.test.mjs tests/integration/workspace-reconcile.test.mjs`; `corepack pnpm exec prettier --check packages/domain/src apps/vestra-cli/src/cli.ts packages/application/src/sync/workspace-reconcile.ts tests/unit/semantic-version.test.mjs tests/contract/cli-surface.test.mjs tests/integration/workspace-reconcile.test.mjs`
Run semver: `node --test --test-reporter=spec tests/unit/semantic-version.test.mjs tests/contract/cli-surface.test.mjs tests/integration/workspace-reconcile.test.mjs`

## Intent

Exit condition X6 asks for a live update from a `0.0.0-qualification.N` release to a `0.x`
candidate and back, across the semver boundary, on five targets. Before a candidate is published
for it, the version comparisons the product makes against such a release do not order them. The
CLI's `compareVersions` keeps only the numeric core, so `0.0.0-qualification.1`, `.9` and `0.0.0`
compare equal. The one in `workspace-reconcile.ts` splits on `.`, so `0.0.0-qualification.9` becomes
the part `0-qualification`, which is `NaN`, and every compatibility check against it passes. A
release that says it needs at least `0.0.0-qualification.10` therefore accepts an older CLI.

When this ships, one semver 2.0.0 comparator in `packages/domain` orders those versions, both
callers use it, and an invalid version fails closed instead of passing. It does not close X6: that
needs the live run on five targets, which only the owner can publish a candidate for and dispatch.

13 checks in 1 slice · 0 one-way doors · 1 open, 0 block

## Checks

### S1 - the comparators order pre-release versions

**C1** - The numeric core orders by value, not by text: `0.0.0 < 0.1.0 < 1.0.0` and `0.9.0 < 0.10.0`
Proof: run semver | ✔ orders the numeric core by value

**C2** - A pre-release is older than its release: `0.0.0-qualification.9 < 0.0.0`
Proof: run semver | ✔ a pre-release is older than its release

**C3** - Pre-release identifiers follow semver 2.0.0 precedence along the specification's own chain
Proof: run semver | ✔ orders the semver 2.0.0 precedence chain

**C4** - `0.0.0-qualification.9 < 0.0.0-qualification.10` (numeric identifiers by value) and `0.0.0-qualification.10 < 0.1.0-rc.1`
Proof: run semver | ✔ orders the qualification line against the 0.x boundary

**C5** - Equal versions compare 0, and the order is antisymmetric over every pair of the chain
Proof: run semver | ✔ is reflexive and antisymmetric over the chain

**C6** - A version that is not `major.minor.patch` with optional dot-separated pre-release identifiers, or that carries a leading-zero or empty identifier or build metadata, is refused with `VES_SEMVER_INVALID`
Proof: run semver | ✔ refuses a version outside the grammar

**C7** - The CLI refuses an installed release older than a pre-release minimum with `VES_CLI_RELEASE_INCOMPATIBLE`, and accepts an equal or newer one
Proof: run semver | ✔ the CLI orders a pre-release minimum against the installed release

**C8** - The CLI fails closed with `VES_CLI_RELEASE_INCOMPATIBLE` when a version cannot be parsed
Proof: run semver | ✔ the CLI fails closed on an unparseable minimum

**C9** - Workspace reconcile refuses an installed CLI older than a pre-release minimum, and accepts an equal or newer one, with `VES_SYNC_CONFIG_INCOMPATIBLE` and before any state is loaded
Proof: run semver | ✔ a pre-release minimum newer than the installed CLI fails before state load or mutation

**C10** - Workspace reconcile fails closed with `VES_SYNC_CONFIG_INCOMPATIBLE` when the installed or minimum version cannot be parsed
Proof: run semver | ✔ an unparseable CLI version fails closed before state load or mutation

**C11** - A value that is not a string is refused with `VES_SEMVER_INVALID`, never with another error
Proof: run semver | ✔ refuses a value that is not a string

**C12** - Alphanumeric identifiers order by code unit, so `Alpha` is older than `alpha`
Proof: run semver | ✔ orders alphanumeric identifiers by code unit, not by locale

**C13** - Numeric identifiers and core parts beyond 2^53 order by value
Proof: run semver | ✔ orders numeric identifiers beyond 2^53 by value

## Coverage

| Set (size)                    | Member -> proof                                                                                                                                         | Unproven |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| comparison rules (5)          | numeric core C1 · pre-release before release C2 · identifier precedence C3 · numeric identifiers by value C4 · equality and antisymmetry C5             | -        |
| semver 2.0.0 chain (8)        | `1.0.0-alpha` C3 · `1.0.0-alpha.1` C3 · `1.0.0-alpha.beta` C3 · `1.0.0-beta` C3 · `1.0.0-beta.2` C3 · `1.0.0-beta.11` C3 · `1.0.0-rc.1` C3 · `1.0.0` C3 | -        |
| invalid inputs (6)            | empty string C6 · `1.0` C6 · `v1.0.0` C6 · `01.0.0` C6 · `1.0.0-` C6 · `1.0.0-a..b` C6                                                                  | -        |
| callers of a comparison (2)   | `apps/vestra-cli/src/cli.ts` C7 · `packages/application/src/sync/workspace-reconcile.ts` C9                                                             | -        |
| fail-closed callers (2)       | CLI C8 · reconcile C10                                                                                                                                  | -        |
| directions at each caller (3) | installed older C7 · installed equal C7 · installed newer C7                                                                                            | -        |
| directions at reconcile (3)   | installed older C9 · installed equal C9 · installed newer C9                                                                                            | -        |

## Swept

- validation: C6, C8, C10, C11
- failure modes: C8, C10 (an unparseable version fails closed, where it used to pass)
- idempotency: n/a - a pure comparison
- authorization: n/a - no caller, no data
- concurrency: n/a - a pure function
- data lifecycle: n/a - nothing stored
- dependency failure: n/a - no external call
- state transitions: n/a - no entity moves through states
- observability: existing - the public errors already name the code and the minimum release

## Assumptions

| Assumption                                                                                                  | Default                  | Rationale                                                                       | Confirmed? |
| ----------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------- | ---------- |
| Correct the comparator and prove the boundary with tests; the live run stays with the owner                 | fix in code, no live run | user: "Sim, corrigir com testes (Recomendada)"                                  | y          |
| Precedence is semver 2.0.0, not an order private to the qualification line                                  | semver 2.0.0             | a `0.x` candidate and a `.N` release must order by a rule any client reproduces | n          |
| The domain grammar matches the repository's own `SEMVER` core and pre-release shape, without build metadata | no `+`                   | `hermetic-bundle.ts`, `supply-chain-evidence.ts` and `cli.ts` already refuse it | n          |
| An unparseable version fails closed as incompatible, in both callers                                        | fail closed              | a check that passes on `NaN` is not a check                                     | n          |

## Out of scope

- Publishing a `0.x` candidate and dispatching `live-activation-matrix.yml`: owner, outside a session. This feature leaves the exact steps in its handoff.
- `docs/qualification/qualification-line-exit-record.md`: signed, so only the owner re-signs it. X6 stays open there.
- `machine-bootstrap.ts`: see the coverage row.

## Handoff

- **Settled mid-build:** correct the comparator and prove the boundary in code (user, 2026-11-03)
- **Dispatched:** Verifier, round 1, at the HEAD of the commit that carries this line; not yet returned
- **Boundary:** C1-C10 closed at ccc6306
- **Abandoned:** none
- **Walked:** n/a - no screen
