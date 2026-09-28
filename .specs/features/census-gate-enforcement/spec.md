# Canonical-JSON census gate enforcement

Issue: #395

## Problem

Commit `6f77378` repaired the stale census rows for `scripts/agent-readiness.mjs`
and `scripts/t76-publish-release.mjs`. The path that let them merge red was
still open:

- `tests/security/canonical-json-census.test.mjs` ran only in the
  `test:security` stage. Only `gate:security` and `gate:release` run that stage
  (`scripts/gate-stages.mjs`).
- `scripts/gate-selection.mjs` routed only named trust packages, `schemas/`,
  and `tests/security|fault-injection/` to `gate:security`. A `scripts/*.mjs`
  change fell to the metadata catch-all and ran only `gate:quick`, which had no
  census stage.
- The reclassified `scripts/agent-readiness.mjs` uses a node-builtins-only
  local canonicalizer. The census reason left open whether that is admissible
  under `migrated-v2`.

## Requirements

- **CGE-01**: `gate:quick` SHALL run the canonical-JSON census on every change,
  as a cheap, deterministic stage that adds no dependency.
- **CGE-02**: `scripts/gate-selection.mjs` SHALL select `gate:security` for any
  changed path listed in `docs/canonical-json-census.json`, reading the
  inventory rather than a second hand-kept list. It SHALL also select it for
  the census inventory, its policy document, and the census scripts. An
  unreadable or malformed inventory SHALL fail selection, not route as empty.
- **CGE-03**: `docs/canonical-json-compatibility.md` SHALL state the bounded
  rule for a local canonicalizer under `migrated-v2`. The rule allows one only
  where importing the package is forbidden, and only with a byte-equality proof
  test that the census reason names.
- **CGE-04**: The census SHALL enforce CGE-03 mechanically. It rejects a
  `migrated-v2` source that defines a canonicalizer without importing
  `canonicalizeJsonV2` and is not in a closed allowlist. It also rejects an
  allowlist entry whose census reason does not name its proof test, and a stale
  allowlist entry.
- **CGE-05**: The proof named for `scripts/agent-readiness.mjs` SHALL compare
  bytes directly against `canonicalizeJsonV2`, not only through one signature
  fixture.
- **CGE-06**: No workflow file or repository ruleset changes. The owner
  break-glass step to require a separate security check is recorded below.

## #395: required-check decision (owner break-glass)

This change does not edit `.github/workflows` or the `Protect main` ruleset.

**What already protects `main` after this change.** The ruleset (id
`19738785`) requires the `Quality gate`, `Site quality`, and `CodeQL` checks.
`Quality gate` is the `quality` job in `.github/workflows/ci.yml`. It runs every
stage that `scripts/select-gates.mjs` selects, and it always includes
`gate:quick`. So on every pull request it now runs `test:census`. For any change
to an inventoried source, the census, its policy, or its scripts, it also runs
the full `gate:security` stage list. The #395 regression path is therefore
closed through a check that is already required.

**The optional stronger step: an unconditional `Security gate` check.** No
workflow currently emits a `Security gate` check context, so the ruleset cannot
require one yet. If the owner wants `gate:security` on every pull request
regardless of path selection, the owner performs these steps:

1. Land a separately reviewed workflow change that adds a job named
   `Security gate` and runs `pnpm gate:security` on `pull_request` to `main` and
   on `push` to `main`. The job must not use workflow-level `paths` or
   `paths-ignore` filters. A required check whose workflow never starts stays
   pending and blocks every merge. The job needs the same pinned Node, pnpm, and
   driver-probe setup that `quality` uses, because `gate:security` runs
   `test:qualification`. The change edits `.github/workflows/`, which selects the
   conservative gates. It also needs owner review, because it changes the CI
   contract.
2. Wait until the new job has reported `Security gate` at least once on a pull
   request against `main`, so that the context exists.
3. Add the context to the ruleset from an owner session (the repository admin
   role is the only bypass actor):

   ```bash
   gh api repos/accd/verchestra/rulesets/19738785 \
     | jq '{name, target, enforcement, conditions, bypass_actors,
            rules: (.rules | map(if .type == "required_status_checks"
              then .parameters.required_status_checks += [{"context": "Security gate"}]
              else . end))}' > protect-main.json
   gh api -X PUT repos/accd/verchestra/rulesets/19738785 --input protect-main.json
   rm protect-main.json
   ```

   The UI path is Settings > Rules > Rulesets > `Protect main` > Require status
   checks to pass > Add checks > `Security gate` > Save changes.
4. Verify that exactly four contexts are required:

   ```bash
   gh api repos/accd/verchestra/rulesets/19738785 \
     --jq '.rules[] | select(.type == "required_status_checks")
           | .parameters.required_status_checks[].context'
   ```

   The expected output is `Quality gate`, `Site quality`, `CodeQL`, and
   `Security gate`. The other settings must be unchanged: strict policy on,
   linear history, rebase-only merges, and one code-owner approval.
5. Close #395 only after step 4 shows the new context, or after the owner
   records in #395 that the `Quality gate` coverage above is sufficient.

## Out of scope

- Rewriting any census classification other than the `scripts/agent-readiness.mjs`
  reason, which now cites the decided rule instead of an open question.
- The ambient-locale allowlist sensor (`canonical-json-locale-allowlist.test.mjs`)
  stays in `test:security`.
