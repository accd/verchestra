# Cedar 4.14.0 qualification

## Problem

Dependabot's #583 moved `@cedar-policy/cedar-wasm` from the qualified `4.12.0`
to `4.14.0` alone and turned `main` red, because the adapter pins the engine
version exactly; #589 reverted it and the owner deferred Cedar to #563. On
2026-10-28 the owner approved the successor. `4.14.0` is npm's `latest`,
published 2026-10-19, and it reports Cedar language `4.6` where `4.12.0`
reported `4.5`.

## Requirements

- **CED-01**: `@cedar-policy/cedar-wasm` SHALL be pinned to `4.14.0` in the
  root and `packages/policy` manifests and the lockfile, moved through pnpm,
  and the lockfile change SHALL move only that package and the peer suffix of
  the one package that names it.
- **CED-02**: The adapter and the spike oracle SHALL expect engine and SDK
  `4.14.0` and language `4.6`, and both official loaders SHALL report exactly
  those; the mismatch scenarios SHALL still deny.
- **CED-03**: Upstream changes from `v4.12.0` to `v4.14.0` that reach the
  functions Verchestra calls SHALL be reviewed and recorded. A scope no action
  applies to, which 4.13 reports as a validation warning, and a schema with an
  `external` declaration, which 4.14 parses, SHALL each be denied with
  `VES_POLICY_VALIDATION_FAILED` by the spike oracle and the product adapter.
- **CED-04**: Qualification SHALL be evidenced by `qualify:cedar` at zero
  skips, the policy suites, injected faults against the validation checks, and
  exact-head repository gates.

## Scope

A dependency qualification refresh only. No policy text, recorded decision,
workflow, artifact, Approval, or durable-state behavior changes. Pi 1.x and
`json-schema-to-typescript` 16, the other successors in #563, are separate
changes.
