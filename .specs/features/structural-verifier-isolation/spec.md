# Structural Verifier Isolation Specification

Issue: #35 (deferred external-review item R9)

## Problem Statement

`IndependentVerificationCoordinator` (`packages/application/src/verification/verification.ts`)
enforces actor-identity separation (`VES_VERIFIER_IDENTITY_CONFLICT`: the
implementation author cannot verify their own work) and a sensor-isolation
*claim* (`scratchIsolationVerified`) — but that claim is a boolean the calling
port self-reports. Nothing today requires the verification to run under a
different driver, in a different process, or with a capability grant that
excludes write access. "Independent" is declared, not structural. T75 (#16)
and T77 (#18) both require real cross-driver, process-isolated verification
before they can close, so this is a release blocker, not a nice-to-have.

## Objective

Make verification's independence a provable fact rather than a self-report:
the verifying session runs under a driver identity distinct from the
implementer's, is granted read-only capabilities with no writer-capable tool
reachable, and the sealed report records both driver identities so any reader
can check the claim instead of trusting it.

## Grounding in existing infrastructure (no new package)

Every driver (`ClaudeCodeDriver`, `CodexDriver`, `OpenCodeDriver`,
`DeterministicMockDriver`) already runs its session in a real, separate OS
process (`node:child_process` `spawn`/`execFile` for the real drivers) and
reports a `driverId`. `DriverStartRequest.tools` is already the capability
surface a session receives. This is the exact substrate the issue's "Claude
Code wrote → Codex verifies" language points at. No new adapter package,
process-spawning mechanism, or IPC protocol is introduced; the work is rules
in `packages/application/src/verification/verification.ts` plus composition
that binds the verifier's evidence/sensor ports to a driver session instead of
an in-process callback.

Cross-driver tests use two `DeterministicMockDriver` instances tagged with
distinct ids (mirroring `tests/agent-eval/fake-adapter.mjs`'s established
pattern for real-process, zero-paid-call testing). Real live-driver
cross-checks (Claude Code implements, Codex verifies) remain available
whenever both CLIs are probed as installed, exactly as T68's gate-selection
driver-probe installation already does; this specification does not require
live paid calls anywhere.

## Scope

- Pure rules: distinct driver identity, read-only grant (no writer-capable
  tool), and a closed driver-resolution function with an explicit
  `not-configured` result.
- Extend the verification report schema (deliberate `schemaVersion: 2`,
  additive fields, old fixtures updated) to record `implementerDriverId` and
  `verifierDriverId`.
- A write-attempt-fails-closed test proving the read-only grant is not
  merely declared.
- Crash/tamper: verification fails closed when the verifying driver session
  terminates unexpectedly or reports a tampered active-state digest
  (extends the existing `activeStateBeforeDigest`/`AfterDigest` mechanism).

## Non-goals

| Exclusion                                              | Reason                                              |
| ------------------------------------------------------- | ---------------------------------------------------- |
| A new process-spawning adapter or IPC protocol           | Drivers already spawn real, separate OS processes    |
| Live paid model calls in any test                        | Forbidden everywhere in this repository               |
| Wiring this into T71/T74/T75 composition roots           | Those tasks consume this capability; out of scope here |
| Changing `VES_VERIFIER_IDENTITY_CONFLICT` (actor-level)  | Orthogonal; this adds a driver-level check alongside it |

## Requirements

| ID       | Requirement                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| SVI-01   | WHEN the verifier driver id equals the implementer driver id THEN verification SHALL fail closed with a distinct error naming both ids.        |
| SVI-02   | WHEN resolving which driver verifies THEN the function SHALL be pure, exclude the implementer's id from candidates, and return an explicit `not-configured` result when no other driver is available — never a silent fallback to the implementer's own id. |
| SVI-03   | WHEN a verifier session is granted any tool at all THEN verification SHALL fail closed before running — the only non-guessable definition of read-only here is a granted tool set of size zero, since inspecting evidence and running sensors needs no tool capability. |
| SVI-04   | WHEN a verifier driver session (granted zero tools) reports any `tool.requested` event THEN the attempt SHALL be rejected and recorded, not silently ignored or granted after the fact. |
| SVI-05   | WHEN a verification report is sealed THEN it SHALL record both `implementerDriverId` and `verifierDriverId` explicitly, under an incremented schema version; existing `schemaVersion: 1` fixtures SHALL still be rejected as versioned (not silently accepted as v2). |
| SVI-06   | WHEN the verifying driver session terminates unexpectedly (crash) or its active-state digest is tampered THEN verification SHALL fail closed, extending the existing sensor-isolation mechanism to also require the recorded verifier driver id. |
| SVI-07   | Cross-driver coverage: at least two distinct driver identities are exercised in tests, proving resolution actually picks a different one and that a same-id attempt is refused. |

## Acceptance Criteria

Each requirement maps to one negative test plus one positive test, all pure
(no filesystem, no live process) except SVI-04's tool-invocation rejection,
which runs against `DeterministicMockDriver` in-process (a real, separate
driver instance, not a live external process) to keep the suite in
`tests/unit/`. A discrimination sensor mutates one behavior per requirement
and must be killed.

## Architecture

Rules live in `packages/application/src/verification/verification.ts`
(existing file, extended — no new package). `IndependentVerificationCoordinator.verify`
gains two required input fields (`implementerDriverId`, `verifierDriverId`)
and validates them before doing anything else, mirroring the existing
actor-identity check's position. `resolveVerifierDriver` is a standalone
exported pure function consumed by composition roots (T71/T74/T75), not
called internally by the coordinator, so the coordinator stays a pure
verdict function over already-resolved facts (per AD-010's port-returns-facts
principle). NestJS: not applicable.

## Safety and Authority

This hardens an authority-adjacent boundary: a verifier with any writer
capability would defeat the entire independence promise. Every new check
fails closed and is covered by a negative test.

## Verification

`pnpm gate:quick`, `pnpm gate:security` (verification.ts sits in a
security-relevant package). Sensor evidence recorded before any validation
claim; independent Verifier pass (author ≠ verifier) at the end of Execute.

## Dependencies and Decisions

No hard dependency on other in-flight work (T71/#182, T70/#184 unaffected).
Blocks: T75 (#16), T77 (#18). Decision recorded here rather than asked: the
report schema bump is `schemaVersion: 2` with old-version fixtures updated to
assert they are correctly rejected as stale, not silently upgraded.
