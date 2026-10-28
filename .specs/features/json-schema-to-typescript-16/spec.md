# json-schema-to-typescript 16.0.0

## Problem

Dependabot's #551 proposed `json-schema-to-typescript` 15.0.4 → 16.0.0 and its
lockfile crashed the contract generator (`schema-registry.test.mjs`): the
workspace override `js-yaml: 4.3.2` forced the 4.x line on a package that
requires `^5.2.3`. The owner deferred it to #563 and approved the move on
2026-10-28.

## Requirements

- **JST-01**: `json-schema-to-typescript` SHALL be pinned to `16.0.0` in the
  root manifest, moved through pnpm, and the lockfile SHALL move only that
  package, the dependencies it changes (`@types/lodash`, `js-yaml` 5.x and its
  `argparse`), and drop `is-glob` from it.
- **JST-02**: `json-schema-to-typescript` SHALL resolve a `js-yaml` 5.x release
  free of known advisories (5.4.1 or later), while every other consumer keeps
  the `js-yaml` 4.3.2 override, and a test SHALL refuse any resolved `js-yaml`
  below its line's patched release.
- **JST-03**: The breaking changes in 16.0.0 SHALL be read from the package
  changelog, and the generated contracts SHALL show zero drift
  (`generate-contract-types.mjs --check`), or be regenerated through the
  schemas and the generator under review.
- **JST-04**: The Dependabot major-version ignore SHALL stay, with its reason
  restated now that 16 no longer breaks the generator.

## Scope

A build-time dependency of the contract generator only; nothing it produces
ships at runtime. Cedar 4.14 and Pi 1.x, the other successors in #563, are
separate changes.
