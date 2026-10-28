# Probe host hardening (#570): validation

**Date:** 2026-10-27
**Diff:** `test/570-probe-host-mutants` from `ff557cf` (`main` after #632)
**Hosts:** Windows 11 Pro x64 and WSL Ubuntu (Linux 6.6, x64), Node 24.14.0.
On Windows the probe host refuses the platform, so the spawned cases assert
that refusal; the POSIX behavior ran on Linux.
**Verifier:** the implementing agent's local pass. No independent review yet.

## Acceptance evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| PHH-01 | `out-of-process-probe-host-faults.test.mjs`: "a worker that hangs during execution while ignoring the end of its input is killed at the time bound". The `hang-ignore-eof` reference worker registers no handler for the end of its input. | PASS on Linux |
| PHH-02 | `out-of-process-probe-host-security.test.mjs`: "the worker runs a 0500 copy of its entry inside a 0700 directory", from `cwdMode` and `entryMode` the worker reports about itself. | PASS on Linux |
| PHH-03 | `probe-worker-framed-protocol.test.mjs`: a handshake under version 99 and a result chunk under version 2 fail closed with `VES_PROBE_PAYLOAD_SCHEMA_UNSUPPORTED` (both failed before the fix). The security suite: a spawned worker answering under version 99 is terminated, its grant revoked, nothing committed. | PASS |

## Discrimination sensors

Each mutant was applied to the Linux checkout, the named suites run, and the
file restored. All four were killed.

| Mutant | Killed by |
| --- | --- |
| the worker starts outside a process group of its own (`detached: false`) | the ignore-the-end-of-input hang case, the fork case, the setsid-child case |
| the private directory is `0777` | the mode case |
| the private copy is `0777` | the mode case |
| any payload schema version is read | both contract version cases; the spawned version case |

## Gates

| Gate | Result |
| --- | --- |
| The probe-host suites on Linux (WSL) | 153 of 153 |
| `pnpm gate:quick` (Windows) | PASS: unit 3,139, agent-readiness 401, census 13 |
| `tests/architecture` (Windows) | 144 of 144 |
| `pnpm agent:check` | PASS |
