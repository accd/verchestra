# July 2026 Dependency Refresh Validation

## Verdict

**Result:** T1 PASS. T2 PASS. T3, T4, and T5 NOT RUN.

**Specification:** `.specs/features/dependency-refresh-2026-07/spec.md`

**Commit range:** `8cf6783..HEAD`

## Requirement evidence

| Requirement | Spec-defined outcome                                     | Assertion evidence (`file:line` and expression)                                                                                          | Result  |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| DRF-01      | prettier 3.9.6, nothing reformatted                       | `package.json` devDependency `prettier: 3.9.6`; `pnpm format:check` reported "All matched files use Prettier code style"                   | PASS    |
| DRF-02      | Both OpenCode packages at one exact 1.18.7                | `tests/agent-readiness/dependency-policy.test.mjs:24` — manifest equality plus a lockfile scan asserting the version set is exactly `["@opencode-ai/sdk@1.18.7", "opencode-ai@1.18.7"]` | PASS    |
| DRF-03      | 17 boundary outcomes against the installed 1.18.7         | `corepack pnpm qualify:opencode` — 17 passed, 0 failed, 0 skipped; recorded in `docs/qualification/opencode-driver-1.18.7.md`             | PASS    |
| DRF-04      | Floor stays 1.17.18                                       | `spikes/opencode-driver/src/opencode-driver.mjs:56` and `packages/drivers/src/opencode-driver.ts:227` both unchanged at `1.17.18`; `tests/contract/opencode-driver.test.mjs:9` still asserts a 1.17.18 host is accepted | PASS    |
| DRF-05      | Dependabot groups OpenCode                                | `.github/dependabot.yml` `opencode-driver` group; asserted by `tests/agent-readiness/dependency-policy.test.mjs:37`                        | PASS    |
| DRF-06      | Superseded pull requests closed with a reason             | T3, after merge                                                                                                                           | NOT RUN |
| DRF-07      | jose evaluated under `gate:security`                      | T4                                                                                                                                        | NOT RUN |
| DRF-08      | Zero open Dependabot pull requests, `main` green          | T5                                                                                                                                        | NOT RUN |

## Gate results

| Command                          | Exit | Test count                                    | Result |
| -------------------------------- | ---- | ----------------------------------------------- | ------ |
| `corepack pnpm qualify:opencode` | 0    | 17 tests, 0 failures, 0 skipped, 0 todo        | PASS   |
| `pnpm test:qualification`        | 0    | 248 tests, 0 failures, 0 skipped, 0 todo       | PASS   |
| `pnpm gate:full`                 | 0    | format:check, lint, typecheck, test:unit, test:contract, test:integration, test:e2e, test:fault | PASS   |
| `pnpm agent:check`               | 0    | —                                               | PASS   |

## Discrimination sensor

| Mutation                                                       | Scratch location                        | Expected killing assertion                                    | Result                                                                              |
| ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Install 1.18.7 without moving the spike's version assertion      | Working tree, before the fix             | `probes the exact repo-local OpenCode without model inference`  | KILLED — failed with `actual: '1.18.7', expected: '1.17.18'`, which is what proves the qualification tracks the installed binary rather than a comment |
| Leave the manifest or a lockfile entry on a mixed version pair   | Covered by construction                 | `keeps the qualified OpenCode driver on one exact package version` | Guard in place; the assertion compares the full version set, so any split pair fails |

The first row is the reason the split pull requests cannot simply be merged:
#30 alone produces exactly this failure.

## Gaps and follow-up

- T3 (close #30 and #31), T4 (jose 6.2.4), and T5 (batch confirmation) remain;
  DRF-06 through DRF-08 have no evidence yet.
- pnpm reports OpenCode 1.18.9 is already available. Qualifying 1.18.7 keeps
  this change traceable to the pull requests it closes, so a grouped 1.18.9
  proposal is expected next cycle and will need its own short requalification.

## Human review

T2 is ready for independent verification and human review. The diff is the two
manifest pins and their lockfile entries, one assertion line in the spike, one
new superseding qualification report, one Dependabot group, and two policy
assertions. No qualification boundary, threshold, or existing assertion was
weakened.
