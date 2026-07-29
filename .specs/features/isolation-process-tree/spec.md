# Isolation process-tree termination

Issue: #88

## Scope

Make the isolation qualification supervisor terminate a POSIX parent and all of
its descendants even when the target did not create its own process group.

## Requirements

| ID          | Requirement                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| ISO-TREE-01 | POSIX termination enumerates the target process tree and signals descendants before the parent.                                        |
| ISO-TREE-02 | `ESRCH` is accepted only after the affected PID is verified absent.                                                                    |
| ISO-TREE-03 | The current-platform qualification test proves termination of a parent that was spawned without `detached: true` and its child.        |
| ISO-TREE-04 | The test has independent cleanup so a regression cannot leave an orphan that prevents the Node test runner from exiting.               |
| ISO-TREE-05 | The Node gate process adapter is audited: it owns a detached POSIX process group and therefore preserves the required group invariant. |

## Out of scope

Production sandboxing, arbitrary service-manager descendants, and a platform
matrix beyond the existing current-platform qualification environment.
