---
schema: verchestra-feature-handoff/v1
feature: database-registration
issue: 235
status: complete
branch: feat/235-database-registration
baseRevision: d713137387cb1f7b7ea882cd01227cb0a8ad22ee
lastCompletedTask: T1
nextTask: "Owner review of the slice 2a PR; after it lands, plan slice 2b (`vestra probe run`) as its own feature."
lastGate: "Independent Verifier round 1 PASS at 4f7bffcc (27/27; Windows proofs 28/28; Linux proofs 29/29, gate:quick, test:contract 1009, test:architecture 148, test:e2e 362, test:build 186); validate_verification exit 0"
updatedAt: 2026-10-29T09:33:45Z
---

# Evidence

The owner split T3's slice 2 on 2026-10-28. Slice 2a, this plan, persists
database registrations as signed Workspace documents. Slice 2b runs a probe.
The owner approved `plan.md` on 2026-10-29 (#683), then narrowed AC 15 before any
check existed: no `vestra database` command starts a probe worker or a
database client, and the only child processes are Git and the OS credential
store's tool. `checks.md` holds 27 checks at profile `light`.

S1 is built (task T1), C1-C27 closed at `7f8a381a`, and verified
independently at `4f7bffcc` (`verification.md`, round 1, PASS). The commits
after the plan:

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

The independent Verifier re-ran every proof at `4f7bffcc` on Windows (28/28)
and Linux (29/29), and on Linux `gate:quick`, `test:contract` (1009),
`test:architecture` (148), `test:e2e` (362) and `test:build` (186), all
passing. Its non-failing notes: C11 races the store, not two `vestra database
add` processes; on Windows a link entry is a junction, so only Linux proves
"not followed". macOS is not run before merge; the nightly matrix runs
`test:contract` there after merge (checks.md, Coverage).

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

The owner reviews the slice 2a PR. After it lands, plan slice 2b
(`vestra probe run`, a per-run confirmed grant) as its own feature, starting
from the sketch and open items above.
