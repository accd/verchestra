---
schema: verchestra-feature-handoff/v1
feature: cli-init-preview
issue: 64
status: verification
branch: codex/issue-64-alpha-docs
baseRevision: 0cd61db12b99d27e335d6f4ccc01995af8a53327
lastCompletedTask: T4
nextTask: Independently verify the documented local alpha against a disposable Git repository.
lastGate: pnpm gate:release
updatedAt: 2026-07-29T18:57:00Z
---

# Handoff: CLI init preview

## State

- Issue: #64
- Branch: `codex/issue-64-alpha-docs`
- Current task: documentation and independent verification
- Status: verification

## Next action

Run the documented command against a disposable real Git repository, then
independently review the local-alpha documentation change.

## Verification

Slices A and B are merged: `init --dry-run` calls `SafeInitService.preview()`
without writing, and `init` calls `preview()` and `apply()` on the same service
instance. Launcher E2E proves read-only preview and idempotent apply. The
installed manifest advertises only `init`; other commands remain intentionally
absent.
