# Probe host containment (#569): validation

**Date:** 2026-10-27
**Diff:** `fix/569-probe-host-containment` from `13fa793`
**Hosts:** Windows 11 Pro x64 and WSL Ubuntu (Linux 6.6, x64), Node 24.14.0,
pnpm 10.34.5. On Windows the probe host refuses the platform, so every spawned
case asserts that refusal; the POSIX behavior ran on Linux. macOS is the fleet
run in T5.
**Verifier:** the implementing agent's local pass. No independent review yet.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| PHC-01 | `out-of-process-probe-host-security.test.mjs`: an argument, an environment extra and an executable the approval does not name are each refused with `VES_PROBE_HOST_LAUNCH_DIGEST`, and the module the argument names never runs; the measured launch digest equals the trust's. `probe-workspace-trust-security.test.mjs`: a transport whose launch differs never reaches identity (`VES_PROBE_WORKSPACE_TRUST_LAUNCH`). | PASS on Linux |
| PHC-02 | `out-of-process-probe-host-security.test.mjs`: 17 loader variables refused even when the approval names them; `NODE_OPTIONS=--require` never runs its module. | PASS on Linux |
| PHC-03 | `probe-workspace-trust-security.test.mjs`: `admitWorkspaceProbeWorker` is gone; an `extension` value without a lock resolves nothing (`VES_SKILL_LOCK_INVALID`); a tampered lock is refused before any approval is looked up. | PASS |
| PHC-04 | The same suite: an approval not on record, or naming another reference, extension, entry digest, or no or a malformed launch, is refused (`VES_PROBE_WORKSPACE_TRUST_APPROVAL`); a grant naming another launch is refused. | PASS |
| PHC-05 | `out-of-process-probe-host-faults.test.mjs`: a `setsid` child of a worker that completes its stream is dead after it; a grandchild linked only through a child in its own group is dead at the time bound. `process-tree-terminator.test.mjs`: the stopped-tree routine ends an escapee and reports the root running. | PASS on Linux |
| PHC-06 | The fault suite: a worker that exits after its final frame fails with `VES_PROBE_WORKER_EXITED`, one rollback, no commit. The contract suite: a transport reporting `running: false`, or no outcome at all, fails the stream. `process-tree-terminator.test.mjs`: a root that exited first, or that a table still lists after the host saw it exit, is not running. | PASS |
| PHC-07 | The fault suite: a double-forked grandchild that keeps the worker's stderr fails the probe with `VES_PROBE_HOST_TERMINATION_INCOMPLETE` over the timeout, rolls back, and the parameter frame is zeroized. The contract suite: a failed termination outranks a completed stream and a timeout, rolls back, zeroizes and withholds. | PASS |
| PHC-08 | `process-tree-terminator.test.mjs`: without a process table the group is still killed and the routine reports incomplete. | PASS on Linux |
| PHC-09 | `adr.md`, `threat-model.md` (T1, T2, T7, T8, T9, T19, T20 and the residual risks), AD-037's 2026-10-27 amendment and `docs/qualification/out-of-process-probe-host.md`. `beta-tester-docs.test.mjs` requires all three canonical documents to state the launch digest, the approval lookup and the residual, and the ADR and threat model no longer to state the closed limits. | PASS |
| PHC-10 | `extension-host-composition.test.mjs` still fails on any CLI or launcher import of the host; its message names the ratification. | PASS |

## Discrimination sensors

Each mutant was applied to the Linux checkout, the named suites run, and the
file restored. All 13 were killed.

| Mutant | Killed by |
| --- | --- |
| a stream completes whether or not the worker still ran | both PHC-06 contract cases; the fault case of a worker that exits after its final frame |
| output that never reaches end of file is not checked | the fault case of a descendant holding the worker's output |
| a missing process table counts as a complete sweep | the terminator's no-table case |
| only the worker's group is swept, not its parentage | the fork, setsid-child and setsid-tree fault cases |
| a root the host saw exit counts as running when a table lists its pid | the terminator's stale-table case, added after this mutant first survived as `let running = true` (that first value was overwritten, so it now comes only from the table and the root's exit) |
| loader variables are passed through | the 17 loader cases and the `NODE_OPTIONS=--require` case |
| the host starts a launch the approval does not name | the argument, environment extra and executable cases |
| the supervisor ignores the measured launch | the trust suite's launch case |
| admission takes any approval answer | five approval cases |
| admission needs no approval on record | the not-on-record case |
| the grant need not name the approved launch | the grant bound to another launch |
| a timeout outranks a failed termination | the contract case over a timeout |
| a failed termination skips zeroization | both contract outranking cases |

A first pass hung twice: under two mutants a refused launch started, or a
grandchild kept the test process's stderr, and the case's cleanup ran only
after the failing assertion. Refused launches now go through
`assertLaunchRefused`, which ends a launch that wrongly started, and the
fault cases register their cleanup before they assert.

## A changed assertion

`beta-tester-docs.test.mjs` asserted that the documents state the three
limits. The limits are closed, so it now asserts that they state the fixes
and the residual, and that the ADR and the threat model no longer state the
limits. It checks the same three documents, nine statements and the #569
citation, plus six negative checks.

## Gates

| Gate | Result |
| --- | --- |
| `pnpm gate:quick` (Windows) | PASS: unit 3,139, agent-readiness 401, census 13 |
| `tests/architecture` (Windows) | 144 of 144 |
| `pnpm agent:check` | PASS |
| The probe-host suites on Linux (WSL) | 148 of 148 |
| The probe-host suites on Windows (platform refusal) | 122 of 122 |
