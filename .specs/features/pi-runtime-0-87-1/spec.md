# Pi runtime 0.87.1 qualification

## Problem

Dependabot PR #415 moves the two coordinated Pi packages from the qualified
`0.84.2` pin to `0.87.1`. Its checks fail because `PiDriver.probe()` accepts only
the exact qualified version: the contract test reports
`VES_PI_VERSION_UNSUPPORTED`, and the Driver lifecycle matrix reports the same
rejection as "pi did not resolve its configured provider". The repository must
not accept a runtime version the Driver still reports as unsupported.

Pi 0.86.0 also moved the system prompt and tool declarations into a leading
transcript system message, which changes the context the stream function
receives. The qualification must show that this changes the representation but
not the Driver's guarantees.

## Requirements

- **PI-01**: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` SHALL
  be pinned to `0.87.1` in the manifest and lockfile.
- **PI-02**: `PiDriver.probe()` SHALL resolve the installed package version and
  accept only the exact qualified `0.87.1` pin.
- **PI-03**: The existing lifecycle, tool mediation, abort, usage, provider
  failure, and privacy boundary (fresh transcript per start, no session
  persistence, no ambient credentials) SHALL remain unchanged.
- **PI-04**: Every boundary-relevant upstream change from `0.84.2` through
  `0.87.1`, and every transitive dependency change, SHALL be recorded in the
  qualification report.
- **PI-05**: Qualification SHALL be evidenced by the focused Pi tests and the
  required exact-head repository gates; no paid provider is contacted.

## Scope

This is a dependency qualification refresh only. It does not change the
Driver port, policy, workflow, artifact, Approval, or durable-state model. The
historical `docs/qualification/pi-runtime-0.84.2.md` report is not edited.
