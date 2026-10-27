# Test hygiene (#598): validation

**Date:** 2026-10-27
**Diff:** `test/598-test-hygiene` from `3daf665`
**Host:** Windows 11 Pro x64, Node 24.14.0, pnpm 10.34.5.
**Verifier:** the implementing agent's local pass. The POSIX-only tests run in
the pull request's Linux Quality gate.

## Acceptance evidence

| Requirement | Evidence                                                                                                                                                                                                                                                                                                              | Result                                                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TH-01       | The five tests in `spec.md` (Scope). The three ReDoS tests measured 3.8 to 4.4 times over six rounds each, against a limit of 8.                                                                                                                                                                                      | PASS locally for the ReDoS, budget and provider child run tests; the probe-host and SIGTERM tests are POSIX-only and run in CI |
| TH-02       | `docs/qualification/RELEASE-DECISION-CONTRACT.md` ("That every mutant was killed"), `scripts/t76-candidate-evidence.mjs` and `packages/distribution/src/supply-chain-evidence.ts` name the field as reserved and not measured. `tests/build/t76-candidate-evidence-golden.test.mjs` shows the sealed bytes unchanged. | PASS                                                                                                                           |
| TH-03       | `scripts/test-scope.mjs` (from #610) and `tests/unit/coverage-lcov.test.mjs`; `CONTRIBUTING.md` names `VES_COVERAGE=1`.                                                                                                                                                                                               | PASS                                                                                                                           |

## Discrimination sensors

Each mutant was applied to the working tree, run, and reverted.

| Mutant                                                                                             | New test                                                                                             | Old test                                 |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Oracle's line scan replaced by `/(?:^\|\n)\s*\/\s*(?:\n\|$)/u`, which backtracks over the newlines | Killed: "a 4x larger input took 16.7x as long". The five behavioural separator tests all still pass. | Killed (60,000 newlines exceed 1 s)      |
| The budget meter forgets a resumed run's spent time (a fresh share)                                | Killed: no rejection                                                                                 | Killed                                   |
| The budget meter's remaining time never falls below 1 s                                            | Killed: the stop landed at tick 32 of 100                                                            | **Survived**: 1 s is under its 3 s bound |
| The provider child run lets a later failure overwrite the first end                                | Killed                                                                                               | Killed                                   |

The probe-host and SIGTERM tests cannot run on this host, so their mutants
were not run. For the probe host, a cancellation that waited on the worker
before the cut would move the cut past twice the bound. For the SIGTERM test,
a command without its handler exits on the signal, which the exit assertion
refuses.

## Gates

| Gate                                                                                                       | Result                                                                   |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm gate:quick`                                                                                          | PASS: unit 3047, agent-readiness 388, census 13                          |
| `pnpm agent:check`                                                                                         | PASS                                                                     |
| The touched suites (three probe adapters, budget and probe-host faults, provider child run, task CLI e2e)  | 232 pass, 18 skipped (the task CLI journeys need Linux or macOS), 0 fail |
| `tests/agent-readiness/release-decision.test.mjs` and the three candidate and supply-chain evidence suites | 97 of 97                                                                 |
