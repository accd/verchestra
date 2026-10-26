# Architecture hygiene (#597)

## Problem

The 2026-10-24 architecture audit, rechecked at `4f8f42f`, found six hygiene
items with no symptom a tester can see, so none entered the beta (#597):
unbounded child processes (ARQ-003), import cycles through package barrels
(ARQ-005), test doubles exported from production entry points (ARQ-006), one
invariant checked in two places that disagree (ARQ-007), unproven payload store
limits (ARQ-008), and logic in the composition root (ARQ-004).

## Requirements

- **AH-01** (ARQ-008): A test SHALL reach `VES_PAYLOAD_STORE_FULL`, and the
  store's per-payload and per-run limits SHALL be documented.
- **AH-02** (ARQ-007): One shared function SHALL validate a budget ledger,
  whether the meter resumes it or a task command reads it from a stored
  checkpoint, and `runtime-store.ts` SHALL name the terminal states through
  `TERMINAL_WORKFLOW_STATES`.
- **AH-03** (ARQ-003): Every child process started outside a provider session
  SHALL carry a time bound and be killed with SIGKILL past it, and a timeout
  SHALL map to a named code.
- **AH-04** (ARQ-005): `tests/architecture` SHALL fail on a file-level import
  cycle, and the three cycles the audit named SHALL be gone.
- **AH-05** (ARQ-006): No production package entry point SHALL export a test
  double.

## Scope

ARQ-008, ARQ-007, ARQ-003, ARQ-005 and ARQ-006, one commit each. ARQ-004 (move
verification, the budget ledger and plan/commit validation out of
`apps/vestra-cli`) is out of scope: the issue records it as an audit note to act
on only when those files are touched for another reason.

## Decisions

- **Bounds (AH-03).** The bounds live in `@verchestra/application`
  (`child-bounds.ts`) beside `childEnvironment`, so no adapter picks its own:
  ten minutes for task-path git, which checks out and commits a whole worktree,
  and one minute for read-only inspection, the process table and `taskkill`.
  `@verchestra/drivers` depends on the domain alone, so its one `--version`
  start, now shared by the three probes, keeps an equal one-minute bound of its
  own instead of gaining a package dependency.
- **Timeout codes (AH-03).** No adapter gains a new public code. Task-path git
  fails with `VES_GIT_TIMEOUT`, which a task command reports as the reason of
  `VES_TASK_FAILED`, while the gate, worktree and context adapters keep their
  own command-failed codes with the timeout as the cause. A probe that times out
  reports `<prefix>_NOT_AVAILABLE`. The scanner and `check-ignore` fail with
  `VES_WORKSPACE_GIT_FAILED`: a killed child carries no exit status, so a
  timeout is never read as status 1 ("no match"). A `taskkill` that outlived its
  bound reports the termination incomplete through the caller's own code.
- **Spawn sites (AH-03).** `spawn` starts are not changed: each is a provider
  session, the verified launcher handoff, or a start that owns its timer. The
  architecture test lists them with that reason, so a new one needs review.
- **Cycle edges (AH-04).** Runtime edges only: a relative or `@verchestra/*`
  static import or re-export. A type-only import is erased before any module
  runs and a dynamic `import()` loads after its importer has evaluated, so
  neither can leave a binding in its temporal dead zone.
- **Doubles (AH-05).** A double lives in its package's `src/testing.ts`. The
  self-test's full scenario is the one production module that runs against one,
  through a new `@verchestra/effects/testing` subpath export. The in-memory
  `MemoryProtectedParameterBroker` and `MemoryProbeResultSink` in extension-host
  are used only by tests too, but the audit did not name them as doubles; they
  stay, and the name rule (`Mock`, `Fake`, `Stub`, `Spy`, `Dummy`) does not
  match them.
