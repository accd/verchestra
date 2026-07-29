# July 2026 Dependency Refresh Validation

## Verdict

**Result:** T1–T6 PASS. T7 PASS pending merge.

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
| DRF-06      | Superseded pull requests closed with a reason             | #30 and #31 carry comments stating why a split unit cannot merge and the grouped-proposal unblock condition; #45 and #47 follow at T7      | PASS    |
| DRF-07      | jose evaluated under `gate:security`                      | `pnpm gate:security` PASS on the jose branch, including 912 security tests covering `packages/evidence/src/{recovery,support}-bundle/`     | PASS    |
| DRF-08      | Zero open Dependabot pull requests, `main` green          | The #29–#32 batch reached zero; the weekly run then opened #44–#48, absorbed by T6 and T7                                                  | PASS    |
| DRF-09      | Exact-equality pins move with the package; Cedar language stays 4.5 | `packages/policy/src/cedar-policy.ts:123` and the spike oracle move to 4.12.0; `spikes/cedar/test/cedar-forms.test.mjs` asserts language 4.5 unchanged; the fail-closed mismatch scenario stays 4.11.1 | PASS    |

## Gate results

| Command                          | Exit | Test count                                    | Result |
| -------------------------------- | ---- | ----------------------------------------------- | ------ |
| `corepack pnpm qualify:opencode` | 0    | 17 tests, 0 failures, 0 skipped, 0 todo        | PASS   |
| `pnpm test:qualification`        | 0    | 248 tests, 0 failures, 0 skipped, 0 todo       | PASS   |
| `pnpm gate:full`                 | 0    | format:check, lint, typecheck, test:unit, test:contract, test:integration, test:e2e, test:fault | PASS   |
| `pnpm agent:check`               | 0    | —                                               | PASS   |
| `pnpm gate:security` (jose, T4)  | 0    | nine stages including 912 security tests        | PASS   |
| `corepack pnpm qualify:cedar` (T7) | 0  | 50 tests, 0 failures, 0 skipped, 0 todo         | PASS   |
| `corepack pnpm qualify:opencode` (T7) | 0 | 17 tests, 0 failures, 0 skipped, 0 todo      | PASS   |
| `pnpm gate:security` (T7)        | 0    | nine stages                                     | PASS   |

## Discrimination sensor

| Mutation                                                       | Scratch location                        | Expected killing assertion                                    | Result                                                                              |
| ---------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Install 1.18.7 without moving the spike's version assertion      | Working tree, before the fix             | `probes the exact repo-local OpenCode without model inference`  | KILLED — failed with `actual: '1.18.7', expected: '1.17.18'`, which is what proves the qualification tracks the installed binary rather than a comment |
| Leave the manifest or a lockfile entry on a mixed version pair   | Covered by construction                 | `keeps the qualified OpenCode driver on one exact package version` | Guard in place; the assertion compares the full version set, so any split pair fails |

The first row is the reason the split pull requests cannot simply be merged:
#30 alone produces exactly this failure.

## Gaps and follow-up

- T7 closes once this pull request merges and #45 and #47 are closed as
  superseded.
- The 1.18.9 follow-up predicted at T2 arrived immediately as grouped pull
  request #45 rather than next cycle, which is the grouping rule confirming
  itself sooner than expected.
- Cedar has no lockfile-pinning assertion equivalent to the OpenCode and Pi
  ones. Nothing forces `packages/policy/package.json` and the expected engine
  version to stay in step; today only `qualify:cedar` catches drift, and only
  after an install. Worth adding, but it is a new guarantee rather than part of
  this refresh.

## Human review

T7 is ready for independent verification and human review. The diff is three
manifest pins and their lockfile entries, the Cedar expected-engine version in
the product package and the spike oracle, one OpenCode assertion line, the
version strings in the dependency-policy test, and two new superseding
qualification reports. No qualification boundary, threshold, or existing
assertion was weakened, no policy text was edited, and the Cedar language
version and fail-closed mismatch scenario are unchanged.
