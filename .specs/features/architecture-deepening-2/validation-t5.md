# Validation T5 — one bounded child run in platform-node (ADR2-5)

Task T5 of the second architecture deepening round, requirement ADR2-5: a
child process that `platform-node` runs with a time and output bound SHALL be
run by one routine. Source: the architecture review of `main` at `9eb2881`,
card 6. Branch `refactor/worktree-resolution-and-child-run`, after the T4
range, based on `main` at `2651fa0`. The decision is the entry "AD-067 — One bounded child run in platform-node; the gate runner
and the activation health gate keep only their verdicts (ADR2-5)" in
`.specs/STATE.md`.

## 1. The friction, verified at the base

The card predates #480, which moved the launcher's termination onto the
shared `terminateProcessGroup`; its "stale copy" (`activation-launcher-adapters.ts:225-246`
with no Darwin zombie rule) is gone at `2651fa0`. What remains is the loop,
written twice:

| Point | Gate runner (`gate-commit-adapters.ts`) | Activation health gate (`activation-launcher-adapters.ts`) | Verdict |
| --- | --- | --- | --- |
| Spawn | `:157-164`: no shell, hidden window, `detached` off win32, input ignored, two pipes | `:249-256`: the same options | same |
| Capture | `:165-183`: both streams into one buffer up to the limit, in arrival order | `:257-269`: the same | same |
| Overflow | total bytes over the limit stops the group once (`:179-182`) | the same (`:265-268`) | same |
| Timeout | one timer, stops the group once (`:186-189`) | the same (`:272-275`) | same |
| Termination | `terminateProcessGroup` with `VES_GATE_ADAPTER_TERMINATION_INCOMPLETE` (`:99-103`) | `terminateProcessGroup` with `VES_LAUNCHER_TERMINATION_INCOMPLETE` (`:223-231`, since #480) | same routine, each caller's code |
| Settles | after `close`, then the termination (`:190-194`) | the same (`:276-286`) | same |
| A child that cannot start | the raw spawn error is thrown | mapped to `VES_LAUNCHER_PROCESS_FAILED` | each caller's own |
| What it reads | per-stream digests and byte counts, exit (`null` as -1), a test summary | exit and signal, the captured text | each caller's verdict |

So the two copies agreed rule for rule; the friction was the second copy,
which had already received a fix on its own once (#480).

## 2. What each caller does now

| Caller | Now |
| --- | --- |
| `runBoundedChild` (`bounded-child-run.ts:51`) | the loop, once: spawn (`:58-65`), one stop through `terminateProcessGroup` (`:66-68`), capture and observer (`:69-84`), timer (`:85-88`), settle after close and termination (`:89-111`); a spawn failure is reported (`:95-96`), not thrown |
| Gate runner (`gate-commit-adapters.ts`) | `runBoundedChild` with its digesting observer and its termination refusal; rethrows a spawn failure as before; `gateResult` keeps its verdict material: digests, byte counts, `null` exit as -1, the test summary from the captured output |
| Activation health gate (`activation-launcher-adapters.ts`) | `observeChild` is `runBoundedChild` with its termination refusal and the spawn failure as `VES_LAUNCHER_PROCESS_FAILED`; `assertNormalTermination` and the report parsing read the observation as before |

## 3. ADR2-5, clause by clause

| Clause | Where it holds | Assertion evidence |
| --- | --- | --- |
| One routine runs a bounded child | `bounded-child-run.ts:51` | `tests/integration/bounded-child-run.test.mjs:48` (exit, signal, both streams in arrival order, byte counts per stream, every chunk observed), `:70` (overflow: the group stopped, only the limit kept, the observer sees every byte), `:87` (timeout: the group stopped, the descendant dead before the run settles), `:108` (a child that cannot start is reported), `:114` (a child that ended itself: how it ended, not stopped by the run) |
| Spawn in its own group on POSIX; termination through the shared routine | `:63`, `:66-68` | `:87` (a descendant in the group is dead when the run settles); `tests/architecture/process-group-termination-locality.test.mjs` "only the bounded child run ends a process group through the shared termination" |
| Each caller keeps only its verdict | the two callers | `process-group-termination-locality.test.mjs`, one case per caller: it calls `runBoundedChild`, names its own termination refusal, and runs no timer or detached spawn of its own |
| The gate's results are unchanged | `gateResult` | `tests/integration/gate-commit-adapters.test.mjs:96`: the full result of a child that exits with 4 after printing to both streams, of one that overflows, and of one that times out, with digests taken from the gate runner on `main` before the change |
| The launcher's evidence is unchanged | `observeChild` | `tests/integration/activation-health-gate.test.mjs` "the observed health evidence of the fixture launchers is unchanged": the three check digests and the behavior digest, taken on `main` before the change; the verdicts: `tests/fault-injection/activation-launcher-faults.test.mjs` (non-zero exit, a signal, the timeout, the output bound, an unreadable report, a runtime that cannot start) |
| The launcher's bundle stays self-contained | the routine imports only `node:child_process` and the terminator | `pnpm test:build` (`tests/build/vestra-launcher-package.test.mjs` runs `assertSelfContained` on the emitted bundle; `tests/build/sealed-launcher-closure.test.mjs` drives the real health gate from a staged release) |

The goldens were taken by one script (in the ignored `.tmp/`) run against the
base files and against the changed ones: identical, including a timed-out
child.

## 4. Not folded in

- **The probe host** (`spawned-probe-worker.ts:177-369`): a long-lived duplex
  transport. It writes frames to the child's input, streams the output to a
  listener instead of capturing it, keeps separate stdout and stderr limits
  that raise faults (`:334-356`), has no timeout (its `exitWaitMs` bounds the
  wait after a termination, `:324-327`), and ends the tree with the escapee
  sweep (`terminateProcessTree`, `:320`). It does not run the same loop.
- **The verified launcher handoff** (`activation-launcher-adapters.ts`,
  `NodeVerifiedLauncherHandoff`): inherits the terminal; no bound.
- **The OS credential tool runner** (`os-secret-backends/credential-tool.ts:61-102`):
  it has a timeout and a capture cap, but it writes a credential to the
  child's input (`:100`), zeroes what it captured (`:75`, `:96`), keeps
  reading past its cap instead of stopping the child, and stops one process
  rather than a group (`:82`). Its spawn is the one the qualified credential
  reports observed on three stores (AD-034, AD-041); moving it would change
  the observed spawn and need those requalified on real stores, which this
  task may not run. **Open decision for the owner**: whether ADR2-5's "time
  and output bound" covers a capture cap that never stops the child.
- The task worktree module's Git runner (`execFile` with a buffer bound and
  no timeout) and the terminator's `ps` and `taskkill` reads: no time bound.

## 5. Unchanged

- No behaviour, error code or message changes; the runtime error catalog
  stays at 19 and the migrations at 12.
- Complexity: `gate-commit-adapters.ts :: Async method 'run'` (11 after T4)
  drops below the target and leaves the baseline; no key is added.
- Census: no file gains or loses a serialization or digest signal;
  `pnpm census:refresh` writes the inventory unchanged.
- Citations fixed in `.specs/features/platform-qualification-matrix/matrix.md`,
  without moving a line: the termination row names
  `bounded-child-run.ts:66-68`, and the timed-out process tree and
  descendant cases name `bounded-child-run.test.mjs:87`. Not rewritten:
  `docs/qualification/t59-validation.md` cites `gate-commit-adapters.test.mjs`
  lines of an older layout; it is a point-in-time qualification record.
- Residue, recorded and not changed (another concern): the launcher builds
  its children's environment with its own copy of `safeEnvironment`, equal
  to `safe-environment.ts` key for key.

## 6. Tests

Deleted case → replacement:

| Deleted | Replacement |
| --- | --- |
| `gate-commit-adapters.test.mjs` "real process runner terminates a timed-out process tree" | `bounded-child-run.test.mjs:87`; the gate's mapping of a timed-out child: `gate-commit-adapters.test.mjs:96` (third result) |
| `gate-commit-adapters.test.mjs` "real process runner terminates a timed-out descendant process" | `bounded-child-run.test.mjs:87` |
| `gate-commit-adapters.test.mjs` "real process runner kills output overflow without retaining raw logs" | `bounded-child-run.test.mjs:70`; the gate's result for an overflow, compared whole (so no raw output is in it): `gate-commit-adapters.test.mjs:96` (second result) |
| `activation-launcher-faults.test.mjs` "a timed-out launcher leaves no descendant process behind" | `bounded-child-run.test.mjs:87`; the launcher's timeout verdict stays in "a launcher that never returns is stopped at the health budget" |

Edited, following the moved code: `tests/architecture/process-group-termination-locality.test.mjs`
replaces "the activation launcher ends a child through the shared routine"
with three cases (only the routine calls the group termination; each caller
runs its child through the routine). `tests/security/activation-launcher-security.test.mjs`
"the launcher adapters never open a shell and never build a command string"
asserted its spawn rules of the launcher's source only and required that
source to call the group termination; the launcher's child is now spawned by
the routine it bundles, so every rule is asserted of both sources, the
launcher must call the routine, and the routine must stop the child through
the group termination. No assertion was removed; a routine spawned through a
shell, which the old form could not see, now fails it (E12). Added: `bounded-child-run.test.mjs` (5)
and the two goldens. The fixture files the deleted gate cases used
(`tests/hang.mjs`, `tests/tree-hang.mjs`, `tests/overflow.mjs` in the gate
suite's repository) went with them.

## 7. Discrimination

Each mutation was applied alone to the file in this worktree, the focused
suites run with a per-test timeout, and the file restored from Git
(`.tmp/discriminate2.py`; a suite that never settled was stopped after 240 s
with its process group).

| Mutation | Result |
| --- | --- |
| E1 an overflow does not stop the child | killed: 2 |
| E2 the stop kills the one process, not its group | killed: the descendant outlives the run |
| E3 the child stays in the caller's process group | killed: the group signal reaches nothing and the suite never settles |
| E4 the capture ignores the limit | killed: 1 |
| E5 the observer sees nothing past the limit | killed: 2 (the routine and the gate's overflow digest) |
| E6 a spawn failure is thrown, not reported | killed: 2 (the routine and the launcher's runtime-cannot-start case) |
| E7 stderr is not captured | killed: 2 |
| E8 the run settles before the termination finished | survived: the group signal is sent synchronously before the child can close, so waiting matters only for a termination that fails, which no fixture can provoke without a process that outlives `SIGKILL`; the terminator's own suite covers its refusal (`tests/integration/process-tree-terminator.test.mjs`). Both copies at the base awaited it the same way. |
| E9 the gate records a stopped child as exit 0 | killed: the gate golden |
| E10 the launcher rethrows a spawn failure | killed: the runtime-cannot-start case |
| E11 the gate runner runs a timer of its own again | killed: the architecture case |
| E12 the routine spawns through a shell | killed: the launcher's security case |

## 8. Windows

The gate runner and the launcher run there, and the activation health gate
is part of every Windows install.

- The routine's one `win32` branch is the spawn's `detached: false`, as both
  copies had; the termination's `win32` branch (`taskkill /T /F`, no
  confirmation) is in the terminator and unchanged.
- A child the run stopped closes with status 1 and no signal on Windows; the
  tests expect that (`KILLED` in `bounded-child-run.test.mjs`, `stopped` in
  the gate golden), as the launcher's fault suite already did.
- A spawn failure is still reported by the child's `error` event before any
  timer fires; the routine skips the termination when the child has no
  process ID, where both copies would have passed `undefined` (unreachable,
  since the timer cannot fire first).
- The goldens are platform-free: they digest bytes the child wrote, and the
  launcher golden leaves out the release digest, which binds the host's Node.

Confidence: high. No platform branch was added or changed; the platform
matrix decides.

## 9. Gates

Node 24.14.0, macOS arm64.
Per commit, the focused suites, `pnpm gate:quick` and `pnpm test:architecture`;
at the end of the range, `gate:build` on `14881b5` and the rest on `354c8b5`
(which edits only the launcher's security suite):

| Command | Result |
| --- | --- |
| focused: `bounded-child-run`, `gate-commit-adapters`, `activation-health-gate`, `activation-launcher-faults`, `activation-launcher-contract`, `activation-launcher-security`, `process-group-termination-locality`, `task-worktree-operations`, `task-mutation-sensor`, `task-worktree-git-environment`, `vestra-launcher-package`, `sealed-launcher-closure` | PASS |
| `pnpm gate:quick` | PASS: unit 2637, agent-readiness 331, census 13 |
| `pnpm test:architecture` | PASS, 116 |
| `pnpm gate:build` | PASS: unit 2637, contract 797, integration 1122, e2e 275, architecture 116, build 172, qualification 337 |
| `pnpm gate:security` | PASS: unit 2637, contract 797, e2e 275, architecture 116, qualification 337, security 1324, fault 309 (one fault case replaced, section 6) |
| `pnpm test:fault` | PASS, 309 |
| `pnpm test:build` | PASS, 172 (the launcher bundle is self-contained) |
| `node --test tests/e2e/task-cli-e2e.test.mjs tests/e2e/mediated-task-execution-e2e.test.mjs` | PASS, 46 |
| `pnpm agent:check` | PASS |

No test was skipped. The gate runner and the launcher run on Windows, so
the platform matrix runs on the branch before merge.
