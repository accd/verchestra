---
schema: verchestra-feature-handoff/v1
feature: database-registration
issue: 235
status: in_progress
branch: feat/235-database-registration
baseRevision: d713137387cb1f7b7ea882cd01227cb0a8ad22ee
lastCompletedTask: T1
nextTask: "dispatch the independent Verifier over d7131373..HEAD"
lastGate: "Every C1-C27 proof PASS on Windows (28 runs; C26's sealed proof with .claude/ excluded from the replica copy); gate:quick, test:contract, test:architecture, the database, launcher and extension e2e suites, and the sealed closure suite PASS on Windows"
updatedAt: 2026-10-29T09:15:00Z
---

# Evidence

The owner split T3's slice 2 on 2026-10-28. Slice 2a, this plan, persists
database registrations as signed Workspace documents. Slice 2b runs a probe.
The owner approved `plan.md` on 2026-10-29 (#683), then narrowed AC 15 before any
check existed: no `vestra database` command starts a probe worker or a
database client, and the only child processes are Git and the OS credential
store's tool. `checks.md` holds 27 checks at profile `light`.

S1 is built (task T1), C1-C27 closed at `7f8a381a`; nothing is verified
independently yet. The commits after the plan:

- `e7cfffe3` exports `normalizeDatabaseAccessPolicy` from data-probe, which
  `ProbePlanner.plan` keeps using, and declares the predicate type
  `database-registration/v1`.
- `7be52c61` moves the family error factory and mapper to
  `apps/vestra-cli/src/task/task-family-errors.ts`; the extension
  definitions and mapping are unchanged.
- `7f8a381a` adds `vestra database add|list|remove`
  (`apps/vestra-cli/src/database/`), the `@verchestra/data-probe` workspace
  link, the pinned command lists (L-019), the census row, and the tests:
  - `tests/contract/database-command.test.mjs`, in process, with a child
    process spy for AC 15;
  - `tests/unit/database-registration-file.test.mjs`, the store layer;
  - `tests/unit/database-access-policy.test.mjs`,
    `tests/unit/database-definition.test.mjs` and
    `tests/unit/database-errors.test.mjs`;
  - `tests/architecture/database-command-composition.test.mjs`;
  - `tests/e2e/database-cli-e2e.test.mjs`, the plan's independent test.
- `62220dfa` records the commands in `CHANGELOG.md`.

Evidence, all on Windows:

- Each `Proof:` command of `checks.md` passes: 28 runs, C26 has two.
- `gate:quick` passes.
- `test:contract` passes, 1009 tests.
- `test:architecture` passes, 148 tests.
- The database, launcher and extension e2e files pass, 39 tests.
- `tests/build/sealed-launcher-closure.test.mjs` passes, 14 tests.
- In process, the unit and contract files cover the database family at
  99.7-100 % of lines and 95-100 % of branches.

Linux and macOS are not run before the Verifier; the nightly matrix runs
`test:contract` on macOS after merge (checks.md, Coverage).

On this machine, the sealed replica copies untracked files, and the
untracked `.claude/worktrees/` checkouts of other sessions make its copy fail
with EPERM before any test runs. The sealed proofs ran with a process-scoped
`core.excludesFile` that excludes `.claude/`; no tracked file changed for it.
Decisions taken mid-build are in `checks.md`, Handoff.

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

Dispatch an independent Verifier over `d7131373..HEAD` with every check of
`checks.md`, including a Linux run of `test:contract`, the database e2e file
and the sealed closure test.
