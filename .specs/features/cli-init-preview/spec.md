# CLI init preview

Issue: #64

## Scope

Deliver the first production CLI vertical slice. `vestra init --dry-run`
creates and renders the real `SafeInitService` preview without writing
workspace files; the same explicit `init` request without `--dry-run` applies
that preview through the service's qualified transaction boundary.

## Requirements

| ID | Requirement |
| --- | --- |
| INIT-CLI-01 | The installed manifest advertises only `init` until other commands are composed. |
| INIT-CLI-02 | `init` requires explicit `--workspace-id` and `--name`, accepts `--placement centralized|colocated`, `--dry-run`, and global `--output`. |
| INIT-CLI-03 | Dry-run uses `buildCanonicalInitFiles` and `SafeInitService.preview()` against the process workspace and never calls `apply()`. |
| INIT-CLI-04 | Equivalent inputs and clones render byte-identical plans; human output never renders objects as `[object Object]`. |
| INIT-CLI-05 | Launcher E2E uses a disposable real Git fixture and proves dry-run changes neither files nor Git state. |
| INIT-CLI-06 | Persistent `init` obtains a preview and calls `apply(preview)` on the same `SafeInitService` instance; the CLI performs no direct write. |
| INIT-CLI-07 | Persistent `init` creates only the qualified initialization candidates and an identical repeat is a no-op. |
| INIT-CLI-08 | The qualified local-alpha README quick start describes the explicit preview and apply paths without claiming an installer, production readiness, or uncomposed commands. |

## Out of scope

`bootstrap`, `sync`, and `workspace reconcile` remain absent until each has a
separate composed slice. `doctor` is a successor in T72 / #13 after the
blocked Self-Test chain; this init slice does not claim to implement it.
Provider and credential composition are also out of scope.
