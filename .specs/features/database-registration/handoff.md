---
schema: verchestra-feature-handoff/v1
feature: database-registration
issue: 235
status: planned
branch: plan/235-database-registration
baseRevision: 73f3ae24dc3f5a40ef8ce14084b5c98072d0284d
lastCompletedTask: null
nextTask: "Owner review of plan.md (slice 2a); then derive checks.md from the approved plan and build."
lastGate: "validate_plan.py 0 errors, 0 warnings"
updatedAt: 2026-10-28T22:35:00Z
---

# Evidence

The owner split T3's slice 2 on 2026-10-28. Slice 2a, this plan, persists
database registrations as signed Workspace documents. Slice 2b runs a probe.
`plan.md` awaits the owner's review. No check or code exists.

## Slice 2b, sketched for the next plan

The shape below follows the owner's decisions and the facts found while
planning 2a. It is not a reviewed plan.

- **Command.** `vestra probe run --database <id> --approval-ref <ref> --request <file>`:
  1. creates a run in the authority store;
  2. shows the run's binding (database, operation fingerprint, worker launch
     digest);
  3. asks the owner to type its digest back (AD-040);
  4. records that approval as an `authority_approvals` row, so the existing
     `CapabilityBroker.grant` issues a `database-read` `CapabilityGrant`
     under the run;
  5. maps it to admission's `WorkspaceProbeWorkerGrant` and runs
     `ProbeWorkerSupervisor` over `FramedProbeWorker` and `SpawnedProbeWorker`;
  6. prints the result envelope (no rows).
- **Open in the 2b plan:**
  - `runs.run_kind` allows only `feature` and `recovery`, so a probe run
    needs a migration or a reused kind.
  - `ApprovalAction` has no probe action.
  - The supervisor does not compare the plan's `grantRef` with the trust's.
  - `ProbeProtocolError.revokeGrant` has no consumer.
  - Probe results live only in memory.
  - The composition guard (slice 1, door 4) must admit the supervisor and
    the spawned transport.

# Next exact action

The owner reviews `plan.md`. On approval, derive `checks.md` from it (profile
`light` unless the owner raises it), build, and dispatch an independent
Verifier.
