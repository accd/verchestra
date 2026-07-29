# CLI init preview

Issue: #64

## Scope

Deliver the first production CLI vertical slice: `vestra init --dry-run` creates
and renders the real `SafeInitService` preview without writing workspace files.

## Requirements

| ID | Requirement |
| --- | --- |
| INIT-CLI-01 | The installed manifest advertises only `init` until other commands are composed. |
| INIT-CLI-02 | `init` requires explicit `--workspace-id` and `--name`, accepts `--placement centralized|colocated`, `--dry-run`, and global `--output`. |
| INIT-CLI-03 | Dry-run uses `buildCanonicalInitFiles` and `SafeInitService.preview()` against the process workspace and never calls `apply()`. |
| INIT-CLI-04 | Equivalent inputs and clones render byte-identical plans; human output never renders objects as `[object Object]`. |
| INIT-CLI-05 | Launcher E2E uses a disposable real Git fixture and proves dry-run changes neither files nor Git state. |

## Out of scope

Persistent init, bootstrap, sync, workspace reconcile, doctor, README quick start,
and any provider or credential composition are separate slices.
