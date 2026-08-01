# Self-Test Trust Domain Specification

Issue: #10 (T69)

## Problem Statement

Verchestra qualifies its parts but cannot yet exercise itself as a whole
without risking the very state it protects. A self-test that touches
production keys, active workspaces, or real policy stores is not a test; it is
an incident. T69 creates a trust domain that can exercise production
boundaries with production code while provably holding zero production
authority and mutating zero active state.

## Goals

- A `SelfTestOrchestrator` with a closed profile registry.
- A verified non-overlapping disposable root: filesystem aliases, symlinks,
  junctions, and normalized paths cannot reach production or active roots.
- Independent test-only keys, policy, workspace, stores, and mock adapters;
  production material is rejected, never merely avoided.
- Active-state Sentinel Set hashing before and after execution.
- A bounded fixture factory, deterministic cleanup, and a quarantine state
  machine for anything cleanup cannot prove removed.
- An allowlisted, prohibited-content-safe signed report.

## Out of Scope

| Exclusion                                          | Owner     |
| -------------------------------------------------- | --------- |
| Smoke and workspace scenario profiles              | T70 (#11) |
| Full workflow, crash, and approved-driver profiles | T71 (#12) |
| Deep installation diagnostics (`doctor --deep`)    | T72 (#13) |

## Acceptance Criteria

1. **TST-01** — WHEN a disposable root is provisioned THEN no alias, symlink,
   junction, or normalized form of it SHALL overlap any production or active
   root, proven by resolved-path and device/inode facts, and an overlapping
   candidate SHALL fail closed.
2. **TST-02** — WHEN the subject under test is composed THEN production keys,
   identities, artifacts, policies, stores, and credentials SHALL be rejected
   with a distinct error; a test-only identity SHALL be constructed rather
   than borrowed.
3. **TST-03** — WHEN any profile runs THEN it SHALL come from a closed
   registry declaring identity, resources, limits, cleanup policy, and report
   schema; an unknown profile SHALL fail closed.
4. **TST-04** — WHEN a run completes THEN the Sentinel Set hashed before
   execution SHALL be byte-identical after it; any mutated, added, or removed
   sentinel SHALL fail the run and quarantine the root.
5. **TST-05** — WHEN cleanup cannot prove a temporary root removed THEN the
   root SHALL enter quarantine through an explicit state machine, never a
   silent leak; quarantine failure itself fails closed.
6. **TST-06** — WHEN a report is produced THEN it SHALL contain only the
   allowlisted `self_test.*` fields already declared by the support-bundle
   evidence contract, pass the prohibited-content scanner, and be signed by
   the test-domain identity.

Minimum 35 unit, security, and fault cases. Verification: `pnpm gate:security`.
