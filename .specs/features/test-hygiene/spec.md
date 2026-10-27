# Test hygiene (#598)

## Problem

The 2026-10-24 audit, rechecked at `4f8f42f`, found three test hygiene items
(#598). Timing assertions with a wall-clock bound and fixed sleeps made noise on
arm64 and Windows runners (TST-005). `survivingMutants` read like a measurement
that never happens (TST-006). No scope measured code coverage (TST-007).

## Requirements

- **TH-01** (TST-005): Each timing assertion SHALL wait on an event or compare a
  ratio, and SHALL still fail the regression it exists for. No bound SHALL be
  loosened only to quiet a runner.
- **TH-02** (TST-006): The contract and the evidence SHALL both name
  `survivingMutants` as reserved and not measured.
- **TH-03** (TST-007): Coverage SHALL be measurable on demand, with no threshold
  gate.

## Scope

| Test                                                                        | Was                                                   | Now                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| The Oracle, SAP ASE and SQL Server batch-separator ReDoS tests              | 60,000 newlines in under 1 s                          | The cost over a 4 times larger input stays under 8 times (`tests/helpers/linear-growth.mjs`)                     |
| `budget-enforcement-faults`: the duration timer runs for the remaining time | the stop within 3 s of wall clock                     | the stop within the first quarter of the driver's own 100 ticks                                                  |
| `provider-child-run`: a failure that follows a stop                         | a 200 ms provider sleep and a 600 ms terminator delay | the provider writes its broken line once the stop asks for its tree, and the tree ends once that line is written |
| `out-of-process-probe-host-faults`: a hung worker is killed at the bound    | returned within the bound plus 1.5 s                  | the cut begins within 2 times the bound; a test timeout fails a kill that never completes                        |
| `task-cli-e2e`: SIGTERM while no provider runs                              | a 500 ms sleep, then two liveness checks              | no sleep: the signal is pending before the gate is released; the exit status proves it did not end the command   |

## Decisions

- **Mutants stay unmeasured (TH-02).** Measuring them needs a mutation-testing
  tool, a dependency this repository does not have; adding one needs owner
  approval. The field keeps its name and its `0` because the signed 1.0.0
  decision and the B5 validator read it, and the row that refuses a count other
  than `0` stays so that a later measurement fails closed.
- **Coverage already exists (TH-03).** #610 added `VES_COVERAGE=1` to
  `scripts/test-scope.mjs` for the unit and contract scopes, without a
  threshold. This change only names it in `CONTRIBUTING.md`.
- **The SIGTERM ordering (TH-01).** The command learns of the gate's end only
  from the gate's exit, which reaches it after the SIGTERM already pending, so
  no sleep is needed to handle the signal while no provider runs.
