# OpenCode runtime 1.19.4 qualification

## Problem

Dependabot proposed moving the coordinated OpenCode packages off the qualified
`1.18.33` pin twice: to `1.18.35` in #549, which the owner deferred on
2026-10-22 to #563 because a driver runtime moves only as a qualification
successor (DSB-05), and to `1.19.3` in #581. At requalification time npm's
`latest` was `1.19.4`, five commits above `1.19.3` and carrying the bundled Bun
1.4.4 security fixes, so the owner chose `1.19.4`. The exact pin, the spike
oracle, and a new immutable qualification report move together.

## Requirements

- **OC-01**: `opencode-ai` and `@opencode-ai/sdk` SHALL be pinned to `1.19.4`
  in the manifest and lockfile, updated through pnpm rather than by hand, and
  the lockfile change SHALL move only the two packages and their platform
  binaries.
- **OC-02**: The real OpenCode probe and contract tests SHALL report the exact
  installed `1.19.4` version while retaining the `1.17.18` support floor, and
  the exact-pin gate SHALL still refuse a newer and an unsupported version.
- **OC-03**: The existing authorization, cancellation, redaction, and session
  privacy boundary SHALL remain unchanged. Upstream changes from `v1.18.33` to
  `v1.19.4` touching cancellation, event streams, permissions, session
  persistence and identity, abort and shutdown, or the SDK surface SHALL be
  reviewed and recorded.
- **OC-04**: Qualification SHALL be evidenced by focused tests at zero skips and
  exact-head repository gates; no paid provider is contacted.

## Scope

This is a dependency qualification refresh only. It does not change policy,
workflow, artifact, Approval, or durable-state behavior. Pi 1.x and
`json-schema-to-typescript` 16, the other two successors in #563, are out of
scope.
