---
schema: verchestra-feature-handoff/v1
feature: cli-init-preview
issue: 64
status: complete
branch: main
baseRevision: 0cd61db12b99d27e335d6f4ccc01995af8a53327
lastCompletedTask: T5
nextTask: No further action; issue #64 is closed.
lastGate: pnpm gate:quick
updatedAt: 2026-08-22T18:00:00Z
---

# Handoff: CLI init preview

## State

- Issue: #64
- Branch: `main`
- Current task: qualification-artifact reconciliation and independent verification
- Status: verification

## Next action

Run the documented preview and apply commands against a disposable real Git
repository. Verify the dry-run byte snapshot is unchanged, the first apply
creates the seven qualified candidates, and the identical second apply is a
no-op. Then independently compare the results with `spec.md` and obtain human
review.

## Verification

Slices A and B are merged: `init --dry-run` calls `SafeInitService.preview()`
without writing, and `init` calls `preview()` and `apply()` on the same service
instance. Launcher E2E proves read-only preview and idempotent apply. The
installed manifest advertises only `init`; `README.md` publishes the qualified
source-checkout local-alpha quick start. `bootstrap`, `sync`, and `workspace
reconcile` remain intentionally absent. `doctor` belongs to T72 / #13 and is
not an unimplemented promise of this slice.
