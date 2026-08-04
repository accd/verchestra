---
schema: verchestra-qualification-report/v1
task: T70
revision: 6ed99debbc473cd1c6795555b37550b5f98b7906
gates: pnpm gate:quick, pnpm gate:full
gateResults: pass, pass
gateRevision: 6ed99debbc473cd1c6795555b37550b5f98b7906
criteriaEvidence: 7 of 7 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 4 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/184
---

# T70 Smoke and Workspace Self-Test Profiles Validation

## Scope

T70 gives the T69 trust domain real scenario content. The `smoke` profile
drives the actual controller path — help, version, `init --dry-run` preview
and its zero-write guarantee, an invalid argument, and an unknown command —
and the `workspace` profile exercises all five supported placements
(standalone, colocated, centralized, nested, ignored) against real
`git init` repositories created fresh inside the disposable root. Both are
packaged behind `vestra self-test --profile <id>`, the first Self-Test
surface composed into the public CLI.

The task extends only the three AD-010 places: rules and check registries in
`packages/application/src/self-test/`, Git and offline-guard facts in
`packages/self-test/`, and scenario content plus CLI wiring in
`apps/vestra-cli/src/self-test-composition.ts`.

50 cases across seven suites, against a declared minimum of 25 registered
scenario check ids (the profiles register 31: 6 smoke + 25 workspace).

| Suite                                                       | Cases |
| ----------------------------------------------------------- | ----: |
| `tests/unit/self-test-scenario-rules.test.mjs`              |    12 |
| `tests/unit/self-test-cli-composition.test.mjs`             |     9 |
| `tests/integration/self-test-git-fixtures.test.mjs`         |    10 |
| `tests/integration/self-test-smoke-scenario.test.mjs`       |     3 |
| `tests/integration/self-test-workspace-scenario.test.mjs`   |     5 |
| `tests/e2e/self-test-cli-e2e.test.mjs`                      |     5 |
| `tests/fault-injection/self-test-network-guard-faults.test.mjs` |  6 |

## Deterministic gates

Both gates ran on a clean checkout detached at the implementation revision,
dispatched through `full-validation.yml`.

| Command           | Result                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- |
| `pnpm gate:quick` | PASS — [run 30864392215](https://github.com/accd/verchestra/actions/runs/30864392215) |
| `pnpm gate:full`  | PASS — [run 30864400425](https://github.com/accd/verchestra/actions/runs/30864400425) |

| Profile        | Stages                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `gate:quick`   | `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit`, `test:agent-readiness`                                |
| `gate:full`    | `format:check`, `lint`, `complexity:check`, `typecheck`, `test:unit`, `test:contract`, `test:integration`, `test:e2e`, `test:fault` |

`gate:full` is the profile the specification declares, and it is the one that
runs the integration, e2e, and fault scopes this task's evidence lives in.

## Revision correction, stated plainly

The implementation first reached `main` at `4b984c7`, and both gates passed
there. That revision is **not** the one this report binds, because gates that
run only on Linux cannot see a Windows defect: at `4b984c7`, three
`self-test-git-fixtures` cases fail on Windows because `GitFixtureFacts`
reported platform-separator paths while T69's fact convention is a
normalized forward-slash path, so `controlRootPath.startsWith(root.canonicalPath)`
was false for a directory genuinely inside the root. A mirror-image defect in
T69's own escape test compared the link chain's resolved entries against an
unresolved path, which fails wherever a temporary directory has a symlinked
ancestor — the macOS failure the T70 handoff had recorded as "pre-existing,
unrelated". It was neither.

Both were repaired in #183, and this report binds `6ed99de`, the revision
where the task is green on the platforms it claims. The finding is evidence
for #16: the ubuntu-only CI matrix let two platform defects into `main`
inside a single task.

## Adequacy matrix

Anchored in `.specs/features/self-test-profiles/spec.md`.

| Criterion | Requirement                                                                 | Assertion                                                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PRF-01    | No credentials, no network; an attempted connection fails with a distinct code | `self-test-network-guard-faults.test.mjs` — the offline guard records outbound attempts and `assertNoNetworkAttempts` fails the run with `VES_SELFTEST_NETWORK_ATTEMPT`; `self-test-git-fixtures.test.mjs` — fixtures never read the operator Git identity (hermetic `GIT_CONFIG_NOSYSTEM`, isolated `HOME`, no askpass) |
| PRF-02    | All five placements exercised with real disposable Git repositories          | `self-test-git-fixtures.test.mjs` — every shape provisions, every control root answers `git rev-parse --is-inside-work-tree`, nested and ignored projects are independently real repositories, colocated and centralized carry a marker without a separate `.git`, and shapes provisioned from one factory never contaminate one another |
| PRF-03    | Coverage: a profile missing any declared check id fails closed               | `self-test-scenario-rules.test.mjs` and `self-test-composition-faults.test.mjs` — `assertProfileCoverage` names the missing ids and raises `VES_SELFTEST_SCENARIO_MISSING`; the registry declares 6 smoke and 25 workspace ids                 |
| PRF-04    | Repeated runs against fresh roots converge; divergence fails closed          | `self-test-scenario-rules.test.mjs` — `assertConvergence` compares ordered `checkId:status` fingerprints and raises `VES_SELFTEST_NONCONVERGENT`; `self-test-workspace-scenario.test.mjs` — two independently provisioned runs produce identical sequences |
| PRF-05    | T69 sentinel and quarantine guarantees hold unmodified                       | Inherited and unchanged: `self-test-rules.test.mjs`, `self-test-composition-faults.test.mjs` (sentinel mutation and deletion quarantine the root), `self-test-escape.test.mjs` (overlap refusal), all still green at this revision              |
| PRF-06    | The sealed report keeps exactly the seven `self_test.*` fields; no new schema | `self-test-composition-faults.test.mjs` — the sealed payload's key set is asserted exactly; per-check detail is returned to the caller outside the sealed payload; no entry was added to the schema registry                                    |
| PRF-07    | `vestra self-test --profile <id>` renders a summary or JSON and exits 0/non-zero | `self-test-cli-e2e.test.mjs` and `self-test-cli-composition.test.mjs` — the command runs both profiles, `--output json` emits the same verdict as the human summary, exit 0 on PASS and a distinct non-zero code otherwise                     |

## Discrimination sensor

Four mutations, applied in place by a verifier who did not author the
implementation, each disabling one property's real enforcement. Application
was verified per mutation; a pattern that did not match would have been
reported as not-applied rather than counted.

| #  | Requirement | Mutation                                                | Result             |
| -- | ----------- | ------------------------------------------------------- | ------------------ |
| N1 | PRF-01      | A recorded network attempt no longer fails the run      | KILLED (2 failing) |
| N2 | PRF-03      | A profile may complete without its required checks      | KILLED (1)         |
| N3 | PRF-04      | Divergent runs are accepted as convergent               | KILLED (5)         |
| N4 | PRF-03      | Coverage computes an empty missing set regardless of facts | KILLED (1)      |

The clean rerun after the campaign initially reported three failures. They
were not sensor artifacts: they were the Windows defect described above,
which the campaign surfaced because it ran the integration scope on a
platform CI never exercises. After #183 the clean rerun is 64 of 64 across
the nine T69 and T70 suites.

## Non-shallow checks

- The `smoke` profile drives the real controller through `runCli`, not a
  stub: an assertion that the CLI's own dry-run writes nothing is only
  meaningful because the command under test is the installed one.
- Workspace shapes are real repositories. `git init` plus a commit per shape
  is slower than a fixture tree and is the point: `scanWorkspace` sees what
  it would see in a user's checkout, including independent Git ownership for
  nested and `ignoredByControl` for ignored.
- Convergence is compared over the ordered `checkId:status` sequence rather
  than a set, so a scenario that produces the right checks in an unstable
  order still fails.
- The report surface did not grow. Per-check detail reaches the caller
  outside the sealed payload, so T69's seven-field allowlist and the sealed
  support-bundle contract are untouched, and no JSON schema was added ahead
  of T72.
- The CLI verb is the first Self-Test surface a user can reach. It exposes
  only `smoke` and `workspace`; `full` and `drivers` remain declared but
  unscoped until T71.

## Verdict

T70 is complete. Seven of seven acceptance criteria have file-and-assertion
evidence, 50 cases register 31 scenario check ids against a declared minimum
of 25, both declared gates pass on the bound revision through externally
dispatched runs, and four of four mutations are killed with none surviving.

What this does not claim: the `full` and `drivers` profiles have no scenario
content, crash-recovery is unimplemented, and `doctor --deep` does not exist.
The public CLI now exposes `init` and `self-test`. Independent verification
is recorded at the pull request this report names; the implementation author
and this report's author are different people.
