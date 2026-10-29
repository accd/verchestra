---
schema: verchestra-feature-handoff/v1
feature: database-registration
issue: 235
status: in_progress
branch: feat/235-database-registration
baseRevision: d713137387cb1f7b7ea882cd01227cb0a8ad22ee
lastCompletedTask: null
nextTask: "Build C1-C27 of checks.md; then dispatch an independent Verifier over d7131373..HEAD."
lastGate: "validate_plan.py and validate_checks.py 0 errors, 0 warnings"
updatedAt: 2026-10-29T10:00:00Z
---

# Evidence

The owner split T3's slice 2 on 2026-10-28. Slice 2a, this plan, persists
database registrations as signed Workspace documents. Slice 2b runs a probe.
The owner approved `plan.md` on 2026-10-29 (#683), then narrowed AC 15 before any
check existed: no `vestra database` command starts a probe worker or a
database client, and the only child processes are Git and the OS credential
store's tool. `checks.md` holds 27 checks at profile `light`. No code exists.

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
  - `DatabaseRegistrationStorePort` carries no policy, but `ProbePlanner.plan`
    takes one, so 2b reads the policy from door 1's document beside the
    registration.
  - The composition guard (slice 1, door 4) must admit the supervisor and
    the spawned transport.

# Next exact action

Build C1-C27 of `checks.md` on `feat/235-database-registration` (one builder,
~80k), run the gates the checks name plus `pnpm gate:quick`, `test:contract`,
`test:e2e`, `test:architecture` and the sealed-closure test (lesson L-019), then
dispatch an independent Verifier over `d7131373..HEAD` with every check.
