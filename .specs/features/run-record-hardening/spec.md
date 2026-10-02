# Run record hardening

## Problem

The Run record work (ADP-2, decision AD-047) gave one module,
`apps/vestra-cli/src/task/task-run-record.ts`, the layout, the seal, and the
validation of a Run's durable record. It recorded three gaps and left them out
of scope (`.specs/features/architecture-deepening/validation-c2.md`, "Not
covered" and "Open points for the reviewer"):

1. **`task review` reads the Execution Package unchecked.** `task approve`
   reads it through `RunRecord#approvedPackage`, which compares its payload
   digest with the digest the plan bound. `task review` used the package
   store's own reader. A package swapped after approval was found only while
   the Run Capsule was being sealed, after the review had been recorded and
   the run had ended, and a package that was intact but was not the one the
   plan bound was not found at all.
2. **Nothing is checked below a task state root.** A `tasks/`, `keys/` or
   `verification/` root that resolves outside the Workspace state root is
   refused, but a link planted below one is followed: at `tasks/<runId>`, at a
   directory inside the Run directory, or at `verification/<runId>`, whose
   scratch checkouts are deleted recursively.
3. **Five files of the Run directory are plain.** `grant.json`, `active.json`,
   `worktree.json`, `cancel.json` and `outcome.json` are canonical JSON with no
   seal, so an edit to one is not detected.

## Vocabulary

Every artifact of this feature uses these terms exactly: module, interface,
implementation, depth, seam, adapter, leverage, locality.

A **Run directory** is `<workspaceState>/tasks/<runId>/`. A **per-Run root** is
a directory named after one run below a task state root: the Run directory and
`<workspaceState>/verification/<runId>/`. A **marker** is one of the five files
above. A **sealed Run** is a run whose plan record names a marker seal; a
**legacy Run** is one whose plan record does not, which is every run planned
before this feature.

## Requirements

### T1 — review proves the Execution Package

- **RRH-01** — WHEN `task review` runs on a run in `HUMAN_REVIEW` THEN it SHALL
  read the Execution Package through `RunRecord#approvedPackage`, the reader
  `task approve` uses, and SHALL seal the Run Capsule from that package.
- **RRH-02** — IF the Execution Package is missing, damaged, or its payload
  digest is not the plan's `packageDigest` THEN `task review` SHALL stop with
  `VES_TASK_STATE_INVALID` and reason `VES_TASK_PACKAGE_INVALID` before it
  reads the review surface, asks for the confirmation, reads a credential,
  records the review, or changes the workflow state.
- **RRH-03** — No task command SHALL call the Run record's unchecked package
  reader.

### T2 — containment below a per-Run root

- **RRH-04** — WHEN the Run record reads or writes an artifact THEN every
  directory from the Run directory down to the directory that holds the
  artifact SHALL be a real directory. IF one of them is a link THEN the
  operation SHALL be refused with `VES_STATE_ROOT_ESCAPE` before anything is
  read, written, created, or removed through it.
- **RRH-05** — IF the path of an artifact holds anything other than a regular
  file THEN a read SHALL be refused with reason `VES_TASK_STATE_UNREADABLE`, as
  it is today, and a write SHALL be refused with the same reason instead of
  replacing what is there.
- **RRH-06** — A cancel marker that is already present SHALL stand as the
  request, so `task cancel` never fails on the marker it is about to write.
  IF the process driving a run cannot tell whether a cancel was requested THEN
  it SHALL stop the run as if one was.
- **RRH-07** — WHEN verification creates or removes a scratch checkout THEN
  every directory from `verification/<runId>` down to that checkout SHALL be a
  real directory. IF one of them is a link THEN verification SHALL stop with
  `VES_STATE_ROOT_ESCAPE` before it creates or deletes anything.
- **RRH-08** — The checks SHALL only read. Opening a Run record, reading a run
  that was never planned, and a dry run SHALL still create nothing.
- **RRH-09** — WHEN the Run directory of a run is a link THEN `approve`,
  `start`, `resume`, `status`, `cancel` and `review` SHALL each stop with
  `VES_STATE_ROOT_ESCAPE` before any effect. On Windows every task command
  SHALL still be refused for the platform before any effect.
- **RRH-10** — The link check SHALL be defined in `task-workspace.ts`, the
  module that already owns the task state roots and their refusal, and no
  other task source SHALL raise `VES_STATE_ROOT_ESCAPE`.

### T3 — the five markers are sealed

- **RRH-11** — WHEN `task plan` creates a run THEN its plan record SHALL name
  the marker seal (`markerSeal: 1`). A plan record without that member SHALL
  mean a legacy Run, and the bytes of an existing plan record SHALL not change.
  A plan record that names any other marker seal SHALL be refused with reason
  `VES_TASK_STATE_MALFORMED`.
- **RRH-12** — WHEN the Run record writes a marker of a sealed Run THEN it
  SHALL write it with the seal of `task-files.ts`. WHEN it writes a marker of a
  legacy Run THEN it SHALL write the plain canonical JSON it writes today.
- **RRH-13** — WHEN the Run record reads the grant, worktree, or outcome marker
  of a sealed Run THEN it SHALL return the sealed record. IF the file is a
  plain marker THEN the read SHALL be refused with reason
  `VES_TASK_STATE_MALFORMED`; IF its content does not match its seal THEN with
  reason `VES_TASK_STATE_TAMPERED`; IF the sealed record lacks the member its
  reader needs THEN with reason `VES_TASK_STATE_MALFORMED`.
- **RRH-14** — WHEN the Run record reads a marker of a legacy Run THEN it SHALL
  read it as it does today, so a run in flight resumes and is cancelled
  unchanged.
- **RRH-15** — The digest a Run Capsule binds for the capability grant SHALL be
  the canonical digest of the grant record, in both forms, and SHALL equal the
  value recorded for ADP-2.
- **RRH-16** — IF the active marker of a sealed Run is present and cannot be
  verified THEN it SHALL count as a process that may be driving the run:
  `start` and `resume` SHALL be refused with `VES_TASK_RUN_ACTIVE`, `status`
  SHALL report the run as driven, and `cancel` SHALL request a stop, wait as it
  waits for a live process, and then clear the marker and end the run itself.
  A marker that verifies and names a live process SHALL never be cleared by
  `cancel`.
- **RRH-17** — A cancel marker that is present SHALL be a request to stop in
  both forms, whatever it holds.
- **RRH-18** — WHEN `task review` runs THEN it SHALL read the grant marker
  before it asks for the confirmation or records the review.
- **RRH-19** — `.specs/features/governed-task-cli/design.md` and its threat
  model SHALL state which files of the Run directory are sealed and what a
  marker that does not verify means.

## Constraints

- Bytes and paths of every artifact that is not one of the five markers do
  not change. The golden values recorded for ADP-2 pass unmodified.
- No public error code is added. The runtime error catalog stays at 19 codes,
  the task error catalog at 10, and the migration count at 12.
- No dependency is added.

## Out of scope

- A keyed seal. The seal of `task-files.ts` is a digest stored beside the
  record; it detects an edit, not a writer who recomputes the digest. That
  writer is another process of the same user, which the governed task threat
  model already places out of scope.
- A link placed between a check and the read or write that follows it.
- The evidence key and its trust anchor under `keys/`, which
  `EncryptedFileKeyProvider` and `task-signing.ts` guard with their own rules.
