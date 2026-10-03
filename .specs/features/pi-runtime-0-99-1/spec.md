# Pi runtime 0.99.1 qualification

## Problem

Dependabot PR #490 moves the two coordinated Pi packages from the qualified
`0.87.1` pin to `0.99.1`. Its Quality check fails because `PiDriver.probe()`
accepts only the exact qualified version: the contract test reports
`VES_PI_VERSION_UNSUPPORTED` for the installed `0.99.1`. The repository must
not accept a runtime version the Driver still reports as unsupported.

Pi 0.99.0 also changes two runtime behaviours the boundary can observe: each
final assistant message records the requested `thinkingLevel`, and a tool
result that sets `isError: true` now completes as an error instead of a
success. The qualification must show that neither weakens the Driver's
guarantees, and must pin the tool outcome where the boundary reports it.

## Requirements

- **PI-01**: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` SHALL
  be pinned to `0.99.1` in the manifest and lockfile, and the lockfile SHALL be
  produced by pnpm and accepted by `pnpm install --frozen-lockfile`.
- **PI-02**: `PiDriver.probe()` SHALL resolve the installed package version and
  accept only the exact qualified `0.99.1` pin.
- **PI-03**: The existing lifecycle, tool mediation, abort, usage, provider
  failure, and privacy boundary (fresh transcript per start, no session
  persistence, no ambient credentials) SHALL remain unchanged, and every Driver
  event sequence the Pi suites pin SHALL pass without edits.
- **PI-04**: Every boundary-relevant upstream change from `0.87.1` through
  `0.99.1`, every runtime behaviour change, and every transitive dependency
  change SHALL be recorded in a new qualification report.
- **PI-05**: The spike boundary SHALL complete a tool that reports its own
  failure (`isError: true`) as an error, and a runtime that reports it as a
  success SHALL fail qualification.
- **PI-06**: Qualification SHALL be evidenced by the focused Pi tests and the
  required repository gates; no paid provider is contacted.

## Scope

This is a dependency qualification refresh only. It does not change the
Driver port, the Pi driver implementation beyond its exact pin, policy,
workflow, artifact, Approval, or durable-state model. The historical
`docs/qualification/pi-runtime-0.87.1.md`, `pi-driver-usage.md`, and
`pi-driver-cancel-order.md` reports are not edited.
