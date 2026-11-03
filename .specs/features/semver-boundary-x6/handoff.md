---
schema: verchestra-feature-handoff/v1
feature: semver-boundary-x6
issue: 393
status: verification
branch: claude/clever-lamport-7h2in4
baseRevision: 7c9c64a2c4f9742f7527d86bc6b8eff8600bea23
lastCompletedTask: T1
nextTask: "Human review and merge. After a release carries this change, the owner publishes a 0.x candidate, dispatches live-activation-matrix.yml with base_version 0.0.0-qualification.N and update_version the candidate, and records the five legs in a validation.md; X6 stays open until then."
lastGate: "independent verification PASS 13/13 (verification.md, three findings closed); check_proofs 16 pass 0 fail at db71df5; tsc, eslint, prettier and complexity PASS; test:architecture 149/149; test:contract and test:integration fail on the same 9 and 36 tests with and without this change (Node 22, root container); eight mutants of the comparator and its callers are each killed by a test"
updatedAt: 2026-11-03T20:00:00Z
---

# Scope

Exit condition X6 (#393, L7): a live update from `0.0.0-qualification.N` to a `0.x`
candidate and back, across the semver boundary, on five targets. Before a candidate is
published for it, the version comparisons the product makes against such a release did
not order them. `checks.md` holds the ten checks and the intent.

# Completed

- `packages/domain/src/primitives/semver.ts`: `compareSemanticVersions`, semver 2.0.0
  section 11 precedence, build metadata not accepted, `VES_SEMVER_INVALID` for anything
  else. Exported from `packages/domain/src/index.ts` and registered in
  `packages/domain/src/errors/core-errors.ts` as a `validation` error.
- `apps/vestra-cli/src/cli.ts` and `packages/application/src/sync/workspace-reconcile.ts`
  use it through `olderThanMinimum`, which fails closed (incompatible) when a version
  cannot be parsed. Before, the CLI ignored the pre-release part and the reconcile
  comparison turned `0.0.0-qualification.9` into `NaN`, which passed every check.
- Tests: `tests/unit/semantic-version.test.mjs` (C1-C6), `tests/contract/cli-surface.test.mjs`
  (C7, C8) and `tests/integration/workspace-reconcile.test.mjs` (C9, C10).
- A pinned test changed with its claim: `tests/unit/domain-primitives.test.mjs`
  ("core public error catalog has every T13 construction failure") now lists
  `VES_SEMVER_INVALID`, because the catalog gained that code in this commit.
- Sensors, each killed by a test: pre-release ignored, numeric identifiers compared as
  text, the CLI failing open on an unparseable version, reconcile failing open.

# Verification

A fresh sub-agent found three low findings, all closed: the chain and antisymmetry
assertions covered only neighbours and the sign, the comparator is stricter than the
CLI's own `SEMVER` pattern (a version such as `1.0.0-01` passes the pattern but fails
closed here), and four rules had no check (non-string input, build metadata, code-unit
order, values beyond 2^53). Checks C11 to C13 were appended for them.

# Open

- The fail-closed behavior is new for `workspace-reconcile`: a minimum version that does
  not parse used to pass silently and now reports `VES_SYNC_CONFIG_INCOMPATIBLE`.
- The base release keeps its old comparator. The fix reaches users only with a release
  that carries it, so the live run's base leg still runs the old comparison; that is
  safe because the comparison only gates `minimumCliVersion` against the installed
  version.
- `machine-bootstrap.ts` has its own check that accepts only `major.minor.patch`, so a
  pre-release never reaches an ordering there. Left alone on purpose.

# Next exact action for the owner (outside a session)

1. After a release carries this change, publish a `0.x` candidate through the reviewed
   publication path (npm provenance, TUF, R2). A session cannot do this.
2. Dispatch `.github/workflows/live-activation-matrix.yml` from `main` with
   `base_version=0.0.0-qualification.N` and `update_version=<the 0.x candidate>`.
3. Record the five legs (activate, update, rollback, self-test, recover) in this
   feature's `validation.md`, in the format of `live-activation-matrix/validation.md`.
4. Re-sign `docs/qualification/qualification-line-exit-record.md` with X6 decided.

# Intentionally unchanged

- `.github/workflows/live-activation-matrix.yml`: it already takes free `base_version`
  and `update_version`.
- `docs/qualification/qualification-line-exit-record.md`: signed. X6 stays open there.
