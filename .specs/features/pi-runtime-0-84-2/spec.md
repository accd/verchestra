# Pi runtime 0.84.2 qualification

## Problem

Dependabot PR #285 updates the two coordinated Pi packages from the already
qualified `0.84.1` pin to `0.84.2`. The repository must not accept a runtime
version that the Driver still reports as unsupported.

## Requirements

- **PI-01**: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` SHALL
  be pinned to `0.84.2` in the manifest and lockfile.
- **PI-02**: `PiDriver.probe()` SHALL resolve the installed package version and
  accept only the exact qualified `0.84.2` pin.
- **PI-03**: The existing lifecycle, tool mediation, abort, usage, provider
  failure, and privacy boundary SHALL remain unchanged.
- **PI-04**: Qualification SHALL be evidenced by the focused Pi tests and the
  required exact-head repository gates; no paid provider is contacted.

## Scope

This is a dependency qualification refresh only. It does not change the
Driver port, policy, workflow, artifact, Approval, or durable-state model.
