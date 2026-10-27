# Probe host containment (#569): tasks

| Task | Deliverable                                                                                                       | Verification                                                                                                                         | Status   |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| T1   | PHC-01, PHC-02: the launch digest, loader names refused, an unapproved launch refused before it starts           | `tests/security/out-of-process-probe-host-security.test.mjs`, `tests/security/probe-workspace-trust-security.test.mjs`              | Complete |
| T2   | PHC-03, PHC-04: `WorkspaceProbeAdmission` resolves through the registry port and looks the approval up           | `tests/security/probe-workspace-trust-security.test.mjs`                                                                            | Complete |
| T3   | PHC-05 to PHC-08: the stopped-tree sweep, the running-at-the-end rule, the output check, termination outranking  | `tests/fault-injection/out-of-process-probe-host-faults.test.mjs`, `tests/integration/process-tree-terminator.test.mjs`, the contract suite | Complete |
| T4   | PHC-09, PHC-10: ADR, threat model, AD-037, qualification doc, the guard's message                                | `pnpm agent:check`; `tests/architecture/extension-host-composition.test.mjs`                                                         | Complete |
| T5   | Required checks green on the pull request head, the fleet's POSIX legs included, then maintainer merge           | CI; `platform-matrix.yml` with `gate=security`                                                                                       | Open     |

## Delivery rule

Merge only after review and every required check green on the exact head.
