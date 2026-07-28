# CodeQL Alert Remediation Validation

## Verdict

**Result:** T1 PASS. T2 and T3 NOT RUN.

**Specification:** `.specs/features/codeql-alert-remediation/spec.md`

**Commit range:** `1688320..1b310fa` (T1), rebased onto `67e05ff`

## Requirement evidence

| Requirement | Spec-defined outcome                                                    | Assertion evidence (`file:line` and expression)                                                                                                        | Result  |
| ----------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| CAR-01      | Batch-separator detection is linear in statement length                   | `packages/data-probe/src/oracle-adapter.ts:78`, `sqlserver-adapter.ts:75`, `sap-ase-adapter.ts:94` — `sql.split("\n").some((line) => line.trim()...)`, no regular expression remains | PASS    |
| CAR-02      | Deny/allow semantics unchanged                                            | 18 parity assertions: `tests/security/oracle-probe-adapter.test.mjs:39-47`, `sqlserver-probe-adapter.test.mjs:60-71`, `sap-ase-probe-adapter.test.mjs:46-57` — padded, CRLF, blank-line runs, opening/closing line, case variance, lone trailing carriage return | PASS    |
| CAR-02      | Separator token sharing a line is not a separator                         | `oracle-probe-adapter.test.mjs:49` (`total / weight`), `sqlserver-probe-adapter.test.mjs:73` (`public.go_orders`), `sap-ase-probe-adapter.test.mjs:59` (`dbo.go_orders`) | PASS    |
| CAR-03      | Linearity asserted, and the assertion fails on the old expression         | `oracle-probe-adapter.test.mjs:54`, `sqlserver-probe-adapter.test.mjs:79`, `sap-ase-probe-adapter.test.mjs:65` — 60,000-newline statement, `elapsedMs < 1000`; discrimination sensor below | PASS    |
| CAR-04      | Link checker selects targets by scheme allowlist                          | Not yet implemented (T2)                                                                                                                                 | NOT RUN |
| CAR-05      | `http(s)` findings unchanged                                              | Not yet implemented (T2)                                                                                                                                 | NOT RUN |
| CAR-06      | All four alerts reported fixed on `main`                                  | Requires both pull requests merged and a `main` rescan (T3)                                                                                              | NOT RUN |

## Gate results

| Command                      | Exit | Test count                                       | Result |
| ---------------------------- | ---- | -------------------------------------------------- | ------ |
| Focused three-suite run      | 0    | 130 tests, 0 failures, 0 skipped, 0 todo          | PASS   |
| `pnpm gate:quick`            | 0    | 1,615 unit + 21 agent-readiness                    | PASS   |
| `pnpm gate:security`         | 0    | 1,615 unit, 912 security, plus architecture, qualification, and fault stages | PASS   |

`gate:security` required a prerequisite repair: `test:architecture` was failing
on a clean `main` because `EXPECTED_PACKAGES` omitted the tracked `apps/site`
directory. Fixed under its own concern in pull request #40 (`67e05ff`) before
this evidence was gathered.

## Discrimination sensor

| Mutation                                                        | Scratch location                                   | Expected killing assertion                                     | Result                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Restore the three original polynomial expressions                 | Disposable copy of the three adapter sources        | `stays linear on adversarial newline input` in all three suites | KILLED — exactly 3 of 130 failed at 5,289 ms / 5,289 ms / 5,244 ms against the 1,000 ms bound |
| Same mutation, parity assertions                                  | Same                                                | None; parity must hold on both implementations                  | 127 of 127 passed on both, confirming the rewrite is semantics-preserving   |

Timing margin: the replacement completes a full
`parseSqlServerReadOperation` call on the adversarial statement in 6.2 ms, and
the assertion bound is 1,000 ms — a 160× margin below the bound and a 5×
margin above it for the defect, so the assertion is not schedule-sensitive.

## Gaps and follow-up

- T2 (link-checker scheme allowlist) and T3 (post-merge alert confirmation)
  are not started; CAR-04 through CAR-06 have no evidence yet.
- CI runs only `pnpm gate:quick` on pull requests
  (`.github/workflows/ci.yml:37`). That is why a red `test:architecture` sat
  unnoticed on `main`. Raising CI coverage is out of scope here and left for a
  human decision.

## Human review

T1 is ready for independent verification and human review. Exact diff: three
one-line guard replacements in `packages/data-probe/src/`, plus 21 added
assertions across the three existing security suites. No existing assertion
was weakened, skipped, or deleted; no guard order or error code changed.
