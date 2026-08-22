# OpenCode runtime 1.18.18 qualification

## Problem

Dependabot PR #277 updates the coordinated OpenCode packages from the already
qualified `1.18.9` pin to `1.18.18`. The executable probe and policy evidence
must move with that dependency identity.

## Requirements

- **OC-01**: `opencode-ai` and `@opencode-ai/sdk` SHALL be pinned to `1.18.18`
  in the manifest and lockfile.
- **OC-02**: The real OpenCode probe and contract tests SHALL report the exact
  installed `1.18.18` version while retaining the `1.17.18` support floor.
- **OC-03**: The existing authorization, cancellation, redaction, and session
  privacy boundary SHALL remain unchanged.
- **OC-04**: Qualification SHALL be evidenced by focused tests and exact-head
  repository gates; no paid provider is contacted.

## Scope

This is a dependency qualification refresh only. It does not change policy,
workflow, artifact, Approval, or durable-state behavior.
