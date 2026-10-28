# Pi runtime 1.4.0 qualification

## Problem

Dependabot's #580 moved the two coordinated Pi packages from the qualified
`0.99.1` to `1.3.0` as generated and turned `main` red: `PiDriver.probe()`
accepts only the exact qualified version. #587 reverted it, and the owner
deferred Pi 1.x to #563, then approved the successor on 2026-10-28. npm's
`latest` is `1.4.0`, published 2026-10-21.

The range is a major. 1.0.0 removes the experimental harness from
`pi-agent-core`, and 1.3.0 refuses a tool call whose arguments arrived
malformed instead of running it with the fields parsed before the error. The
qualification must show that neither weakens the Driver's guarantees, and must
pin the tool outcome where the boundary reports it.

## Requirements

- **PI-01**: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` SHALL
  be pinned to `1.4.0` in the manifest and lockfile, the lockfile SHALL be
  produced by pnpm and accepted by `pnpm install --frozen-lockfile`, and it
  SHALL move nothing beyond the packages 1.4.0 itself changes.
- **PI-02**: `PiDriver.probe()` SHALL resolve the installed package version and
  accept only the exact qualified `1.4.0`, refusing its neighbours `1.4.1`,
  `1.5.0`, `2.0.0` and `1.4.0-beta.1`.
- **PI-03**: The existing lifecycle, tool mediation, abort, usage, provider
  failure, and privacy boundary SHALL remain unchanged, and every Driver event
  sequence the Pi suites pin SHALL pass without edits.
- **PI-04**: Every boundary-relevant upstream change from `0.99.1` through
  `1.4.0`, every runtime behaviour change, and every transitive dependency
  change SHALL be recorded in a new qualification report.
- **PI-05**: The spike boundary SHALL refuse a tool call whose arguments
  arrived malformed before the controller's authorization and before the tool
  runs.
- **PI-06**: Qualification SHALL be evidenced by the focused Pi tests and the
  required repository gates; no paid provider is contacted.

## Scope

A dependency qualification refresh only. It does not change the Driver port,
the Pi driver beyond its exact pin, policy, workflow, artifact, Approval, or
durable state. The historical Pi reports are not edited.
