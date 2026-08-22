# Deep Doctor Live Probes Specification

Issue: #207. Parent: #13 (T72). Lands with or before #16 (T75).

## Problem statement

T72 shipped 12 deep-doctor checks. Five observe genuine live signals; seven
observe fixture presence through `existsSync` and report `blocked` when the
file is missing. The design specified live read-only observers for all seven.
A presence check cannot distinguish an absent subsystem from a broken one, so
seven of twelve checks currently answer a question the operator did not ask.

A second defect compounds it. The `.vestra` to `.verchestra` root correction
landed, but every one of the seven probed leaf paths is still referenced
nowhere in the repository except `apps/vestra-cli/src/doctor-composition.ts`
itself. `safe-init.ts` writes six files, none of them; `artifact-placement.ts`
reserves seven directories, none of them; the only real runtime store is
`runtime.sqlite` under a scenario root. On a fully provisioned machine all
seven still report `blocked` — not because the subsystem is absent, but
because nothing has ever created the path being watched.

## Goals

- [ ] Each of the seven checks reports `pass`, `fail`, or `blocked` from a real
      read-only observation of its subsystem.
- [ ] Every path the doctor watches is named by one layout contract and
      provisioned by a repository surface, proven statically.
- [ ] The read-only property of the doctor graph is proven transitively, not
      by a textual scan of one file.
- [ ] Source mode still reports `blocked` honestly for what it has not
      provisioned.

## Out of scope

| Item | Reason |
| ---- | ------ |
| Subsystem reachability checks (network, provider, paid calls) | A reachability probe is neither read-only nor free; availability means installed and declared, never reachable. |
| A user-facing configuration surface for subsystem locations | AD-019 chose qualification fixtures over a config surface; a config surface is a distinct product decision. |
| Extending `vestra init` to provision the seven paths | AD-019. `init` is a real filesystem writer with its own target guard; changing what every workspace contains is a separate product change. |
| Remediation of a failing subsystem | Doctor observes and names a remediation code; it never repairs. |
| The five checks that already observe live signals | `installation`, `contract-schema`, `native-asset`, `git`, `clock` are unchanged. |

## Assumptions and open questions

| Assumption / decision | Chosen default | Rationale | Confirmed |
| --------------------- | -------------- | --------- | --------- |
| Who provisions the seven paths (AD-019) | One inward layout contract plus T75 qualification fixtures. No new user-facing surface. | Smallest change that makes the issue verifiable on the matrix where the fixtures are required to exist; defers the product decision to T76+. | y |
| How far the read-only guard extends (AD-020) | Read-only package subpaths plus a transitive closure guard. | Live probes must import packages whose barrels re-export writers. A textual scan would still pass while the reachable graph stopped being read-only, so the guard would assert a property it no longer proves. | y |
| Sync-vs-async probe port | Widen the port to allow a promise and make `collectDoctorFacts` async. | Pre-computing async work in the composition root places the observation outside the sentinel bracket, which the issue's final acceptance criterion forbids. | y |
| Await strategy inside the bracket | Sequential awaits, never `Promise.all`. | The sentinel-invariance window must stay a single well-defined serial interval; concurrent probes make "nothing changed during the diagnostic" unattributable. | y |
| Meaning of "available" for driver, connector, and probe | An availability record exists, parses, and declares an installed subsystem. | The architecture guard forbids importing those three packages by name; a record read is the only observation that does not widen the graph into adapter construction. | y |
| Secret presence surface | `SecretAdapter.has`, never `SecretBrokerBindingInspector.isBound`. | `isBound` calls `broker.bind()`, which mints a handle. That is a side effect, not an observation. | y |

**Open questions:** none — all resolved or logged above.

## Requirements

| ID | Requirement |
| ------ | ----------- |
| DDL-01 | One inward layout contract names the workspace root dirname and all seven subsystem observation paths. |
| DDL-02 | `safe-init.ts` and the doctor composition derive their paths from DDL-01 rather than from independent literals. |
| DDL-03 | A static guard proves every path the doctor probes is owned by DDL-01 and provisioned by a repository surface. |
| DDL-04 | The probe port accepts a synchronous or asynchronous observation, and `collectDoctorFacts` awaits sequentially. |
| DDL-05 | Every live observation is performed between the two sentinel captures. |
| DDL-06 | The `sandbox` check observes that a constructed path broker refuses an out-of-root open. |
| DDL-07 | The `cedar-policy` check verifies the active bundle read-only and observes a stable policy-view digest. |
| DDL-08 | The `sqlite-durable-state` check reports integrity from a read-only database open. |
| DDL-09 | The `secret-presence` check reports a presence boolean from a read-only has-surface and never binds a secret. |
| DDL-10 | The `driver`, `connector`, and `probe` checks report availability from read-only availability records, without importing `@verchestra/drivers`, `@verchestra/connectors`, or `@verchestra/data-probe`. |
| DDL-11 | No probe emits a value, path, secret, or error string; the observation vocabulary stays two booleans. |
| DDL-12 | The read-only architecture guard resolves the transitive import closure of the doctor composition and proves no writer is reachable. |
| DDL-13 | With no provisioned subsystem, every upgraded check still reports `blocked` and never `fail`. |
| DDL-14 | Deep doctor is exercised on a provisioned T75 matrix leg and the sealed report is recorded as fleet evidence. |

## Acceptance criteria

1. WHEN the layout contract names a subsystem path THEN the repository SHALL fail its architecture gate if the doctor probes a path the contract does not own.
2. WHEN the layout contract names a subsystem path THEN the repository SHALL fail its architecture gate if no repository surface provisions that path.
3. WHEN a probe returns a promise THEN `collectDoctorFacts` SHALL await it before capturing the second sentinel.
4. WHEN a probe rejects THEN the check SHALL record present-and-unhealthy (`fail`) with no error text, exactly as the synchronous path does today.
5. WHEN the sandbox subsystem is provisioned AND the broker refuses an out-of-root open THEN the `sandbox` check SHALL report `pass`.
6. WHEN the sandbox subsystem is provisioned AND the broker permits an out-of-root open THEN the `sandbox` check SHALL report `fail`.
7. WHEN the active policy bundle is present and verifies THEN the `cedar-policy` check SHALL report `pass` and SHALL NOT emit the digest into the report.
8. WHEN the active policy bundle is present and fails verification THEN the `cedar-policy` check SHALL report `fail`.
9. WHEN the runtime database is present and `PRAGMA integrity_check` returns `ok` THEN the `sqlite-durable-state` check SHALL report `pass`.
10. WHEN the runtime database is present and integrity validation throws THEN the `sqlite-durable-state` check SHALL report `fail`.
11. WHEN the runtime database file is absent THEN the `sqlite-durable-state` check SHALL report `blocked` and SHALL NOT report `fail`.
12. WHEN a secret is observed THEN the check SHALL call the read-only has-surface and SHALL NOT call `bind`.
13. WHEN an availability record is absent THEN the corresponding check SHALL report `blocked`; WHEN present but unparseable THEN `fail`.
14. WHEN the doctor composition's transitive import closure contains a module exporting a writer THEN the architecture gate SHALL fail.
15. WHEN deep doctor runs in an unprovisioned source checkout THEN all seven checks SHALL report `blocked` and the report SHALL contain no path, value, or secret.

## Edge cases

- WHEN a probe hangs THEN the sentinel bracket SHALL still close deterministically (probe-level timeout, observed as `fail`).
- WHEN the runtime database exists but is locked by another process THEN the check SHALL report `fail`, not crash the diagnostic.
- WHEN the policy bundle exists but is zero-length or truncated THEN the check SHALL report `fail`, not throw out of `runDoctor`.
- WHEN an availability record declares a subsystem the build does not contain THEN the check SHALL report `fail`.
- WHEN the layout contract adds a path but nothing provisions it THEN AC2 SHALL fail the gate — this is the exact defect the issue's comment described, one level down.

## Safety and authority

Every added import is read-only by contract and proven so transitively
(DDL-12). No probe constructs a command bus, a provider, a paid adapter, or a
writer. No probe emits a path, value, secret, or error string (DDL-11). The
sentinel bracket is preserved as a serial interval (DDL-05). Human review is
required before merge; the T75 evidence (DDL-14) is submitted for independent
verification.

## Success criteria

- [ ] Six of seven checks report from live observation; five unchanged.
      **`secret-presence` is deferred (AD-023, 2026-08-22)** — it needs a real
      `OsSecretBackend` (Windows CNG / Apple Keychain / Linux Secret Service),
      none of which has any implementation anywhere in the repository. Building
      one speculatively, with no other consumer to validate the design
      against, was rejected as out of this feature's scope; it remains on its
      original file-presence check. T15's read-only presence surface (T10)
      is built and tested; only its wiring into a real adapter is deferred.
- [ ] `pnpm gate:quick` and `pnpm test:architecture` pass with no skipped or weakened assertion.
- [ ] The transitive guard fails when a writer is introduced into the closure (discrimination sensor).
- [ ] A T75 matrix leg records a sealed report in which six of the seven checks are not `blocked`
      (`secret-presence` remains a presence check and reports per its unchanged behavior).
