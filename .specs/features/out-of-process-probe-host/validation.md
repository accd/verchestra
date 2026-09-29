# Out-of-Process Probe Host Validation

## Current verdict

**PASS - T1, T2** for this feature only, on darwin-arm64 (Node 24.14.0,
Python 3.9 as `python3`). Linux is expected to behave identically (POSIX
process groups, `ps -A -o pid=,ppid=`) and is exercised by CI; Windows is
refused by design. This is not a release claim and does not alter the signed
1.0.0 hold.

## Requirement evidence

| Requirement | Assertion evidence | Result |
| --- | --- | --- |
| OOP-01 codec on the path | `tests/contract/probe-worker-framed-protocol.test.mjs:117` asserts the exact controller message order and sequence numbers 0-3 through the codec; `:153-203` fail closed on miscounted streams, wrong messages, extra handshake keys, non-array rows, and smuggled identity fields | PASS |
| OOP-01 real frames | `tests/security/out-of-process-probe-host-security.test.mjs:28-41` real processes: oversize frame, missing Content-Length, invalid JSON, digest mismatch, foreign Workspace, byte-identical replay, stale sequence; each asserts the code, `revokeGrant`, dead pid, removed directory, zero commits | PASS |
| OOP-01 strict guard | `tests/contract/probe-worker-framed-protocol.test.mjs:217` strict mode rejects the replay the default tolerates; `:231` conflict still reported | PASS |
| OOP-02 environment | `tests/security/out-of-process-probe-host-security.test.mjs:112` exact host-supplied key set with an ambient secret set in the parent; cwd is the private directory and is gone afterwards; `:143-155` secret-like and reserved names refused | PASS |
| OOP-02 tree kill | `tests/fault-injection/out-of-process-probe-host-faults.test.mjs:47` same-group and `setsid` grandchildren both dead; discriminated by disabling the sweep, which fails this test | PASS |
| OOP-02 teardown on success | `tests/integration/spawned-probe-worker.test.mjs:20` terminated, directory removed, pid dead after a complete probe | PASS |
| OOP-03 approved bytes | `tests/integration/spawned-probe-worker.test.mjs:50` digest mismatch refuses to spawn; `:65` overwriting the source after launch does not change the running code (handshake digest equals the approved bytes) | PASS |
| OOP-04 stderr | `tests/security/out-of-process-probe-host-security.test.mjs:91` flood killed at the limit, excerpt bounded and truncated, digest present; `:54` secret written to stderr is absent from the excerpt | PASS |
| OOP-05 admission | `tests/security/probe-workspace-trust-security.test.mjs:35-112` registry resolution and refusals; `:114` denied by default; `:118` no grant; `:125` no approval; `:135-159` every unbound grant field, isolation grade, risk class, and capability; `:161` reclassification; `:197` forged trust; `:215` admission for another Workspace's plan; `:273` parity with the qualified spike rule | PASS |
| OOP-06 handshake variant | `tests/security/probe-workspace-trust-security.test.mjs:171` product namespace reserved; `:238` a host-measured launch digest that differs from the approval fails before identity; `tests/security/out-of-process-probe-host-security.test.mjs:43` an unadmitted worker fails the product pin; `:36` self-reported digest drift fails | PASS |
| OOP-07 bounds | `tests/security/out-of-process-probe-host-security.test.mjs:54` leak detected, rolled back, parameter bytes and outbound frame zeroized; `:80` sanitized worker error; `tests/fault-injection/out-of-process-probe-host-faults.test.mjs:29-45` hang in execute and in handshake cut at the bound; `:68` exit mid-stream rolls back; `:76` external abort kills the tree; the unchanged in-process suites (`tests/contract/probe-worker-supervisor.test.mjs`, `tests/security/probe-worker-security.test.mjs`, `tests/fault-injection/probe-worker-faults.test.mjs`) still pass | PASS |
| OOP-08 language neutrality | `tests/integration/spawned-probe-worker.test.mjs:20` plain Node worker; `:40` Python standard-library worker, explicit skip reason when `python3` is absent | PASS |
| OOP-08 journey | `tests/e2e/out-of-process-probe-host-e2e.test.mjs:15` lock, approval, grant, spawn, supervisor, one protected envelope with no rows or parameter | PASS |
| OOP-09 no release change | `git diff origin/main -- docs/qualification/release-decision-1.0.0.md` is empty | PASS |

## Commands

Focused: `node --test tests/contract/probe-worker-framed-protocol.test.mjs
tests/security/probe-workspace-trust-security.test.mjs
tests/security/out-of-process-probe-host-security.test.mjs
tests/integration/spawned-probe-worker.test.mjs
tests/fault-injection/out-of-process-probe-host-faults.test.mjs
tests/e2e/out-of-process-probe-host-e2e.test.mjs` — 72 passed, 0 failed, 0
skipped.

Regression: the existing probe, adapter, conformance-kit, skill-registry, and
gate-adapter suites — 415 passed, 0 failed.

Gate results are recorded in `handoff.md`.
