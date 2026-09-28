# OpenCode runtime 1.18.33 qualification

## Problem

Dependabot PR #400 updates the coordinated OpenCode packages from the already
qualified `1.18.18` pin to `1.18.23`. By requalification time `1.18.33` was
the latest `1.18.x` release, so the group moves directly to `1.18.33` rather
than qualifying a version already ten releases behind. The executable probe and
policy evidence must move with that dependency identity.

## Requirements

- **OC-01**: `opencode-ai` and `@opencode-ai/sdk` SHALL be pinned to `1.18.33`
  in the manifest and lockfile, updated through pnpm rather than by hand.
- **OC-02**: The real OpenCode probe and contract tests SHALL report the exact
  installed `1.18.33` version while retaining the `1.17.18` support floor.
- **OC-03**: The existing authorization, cancellation, redaction, and session
  privacy boundary SHALL remain unchanged. Upstream changes from `v1.18.18` to
  `v1.18.33` touching cancellation, event streams, permissions, session
  persistence, abort and shutdown, or the SDK surface SHALL be reviewed and
  recorded.
- **OC-04**: Qualification SHALL be evidenced by focused tests and exact-head
  repository gates; no paid provider is contacted.

## Scope

This is a dependency qualification refresh only. It does not change policy,
workflow, artifact, Approval, or durable-state behavior.
