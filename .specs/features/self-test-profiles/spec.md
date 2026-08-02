# Self-Test Smoke and Workspace Profiles Specification

Issue: #11 (T70)

## Problem statement

T69 (`.specs/features/self-test/`) built the isolated Self-Test trust domain:
a closed profile registry, non-overlapping disposable roots, sentinel
hashing, quarantine, and an allowlisted signed report. The registry already
declares `smoke` and `workspace` profile ids with budgets, but no profile has
scenarios yet — `SelfTestOrchestrator` has no scenario to run beyond whatever
a caller composes by hand. T70 gives those two profiles real, deterministic,
black-box scenarios against the production CLI and workspace boundaries, so
the trust domain built in T69 becomes an actual usable self-test rather than
an empty shell.

## Goals

- A `smoke` profile that exercises the controller/CLI path end to end
  (argument parsing, command dispatch, dry-run preview) with no writes
  outside the disposable root.
- A `workspace` profile that exercises placement, initialization, bootstrap,
  sync, and reconciliation across all five supported workspace shapes:
  disposable standalone, colocated, centralized, nested, and ignored Git
  fixtures — each a real, disposable Git repository.
- At least 25 registered black-box scenario checks across the two profiles
  combined, each with a stable id.
- Deterministic convergence: repeated runs of the same profile against fresh
  disposable roots produce identical semantic results (ordered check
  id/status pairs), independent of paths, timestamps, or durations.
- No credentials, no network or paid calls, in either profile.
- A `vestra self-test` command with a stable exit-code and human/JSON report
  contract, so the profiles are reachable as production CLI behavior, not
  only as an internal API.

## Out of scope

| Exclusion                                                    | Owner     |
| ------------------------------------------------------------- | --------- |
| `full`, `drivers`, and crash-recovery scenario content         | T71 (#12) |
| `doctor --deep` and JSON report schema                         | T72 (#13) |
| New failure-code taxonomy beyond what T69 already declares, except the network/coverage/convergence codes this task adds | T70 |
| Live paid model calls or any driver invocation                 | Never in Self-Test |

## Requirements

| ID       | Requirement                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| PRF-01   | Packaged `smoke` and `workspace` profiles require no credentials, read no ambient credential material, and make no network or paid calls; an attempted outbound connection during a run fails the run with a distinct code. |
| PRF-02   | All five supported workspace placements (standalone, colocated, centralized, nested, ignored) are exercised using real, disposable Git repositories created fresh per run. |
| PRF-03   | Each profile registers at least the scenario checks required for coverage; a profile that completes without producing every check its registry entry declares fails closed with a distinct code. |
| PRF-04   | Repeated runs of the same profile, each against a freshly provisioned disposable root, converge to an identical ordered sequence of `checkId:status` pairs; divergence fails with a distinct code. |
| PRF-05   | Sentinels captured before a scenario run remain byte-identical after it, and every temporary root the scenario provisions is proven removed or enters quarantine — inherited unmodified from T69's `SelfTestOrchestrator`. |
| PRF-06   | The sealed report keeps exactly the seven `self_test.*` fields already declared in T69; no report JSON schema is added (deferred to T72). Per-check detail is returned to the caller outside the sealed payload. |
| PRF-07   | `vestra self-test --profile <smoke\|workspace>` runs the corresponding profile, renders a stable human summary or (with `--output json`) a machine payload, and exits 0 on PASS and non-zero on FAIL or BLOCKED. |

## Acceptance criteria

1. WHEN either profile runs THEN the repository SHALL make no network
   connection and read no credential material; an attempted connection
   SHALL fail the run with `VES_SELFTEST_NETWORK_ATTEMPT`. (PRF-01)
2. WHEN the `workspace` profile runs THEN each of the five workspace shapes
   SHALL be backed by a real Git repository created inside the disposable
   root, never a stub or a mock. (PRF-02)
3. WHEN a profile completes THEN its result SHALL include a check for every
   id its registry entry declares; a missing id SHALL fail closed with
   `VES_SELFTEST_SCENARIO_MISSING`. (PRF-03)
4. WHEN the same profile runs twice against two freshly provisioned
   disposable roots THEN the ordered `checkId:status` sequence SHALL be
   identical between runs; a divergent sequence SHALL fail with
   `VES_SELFTEST_NONCONVERGENT`. (PRF-04)
5. WHEN a run completes THEN the T69 Sentinel Set and quarantine guarantees
   SHALL hold unmodified, and the sealed report SHALL contain exactly the
   allowlisted `self_test.*` fields. (PRF-05, PRF-06)
6. WHEN `vestra self-test --profile smoke` or `--profile workspace` runs
   THEN it SHALL exit 0 on PASS and a distinct non-zero code otherwise, and
   `--output json` SHALL emit a machine-readable payload with the same
   verdict. (PRF-07)
7. Combined, the `smoke` and `workspace` profiles SHALL register at least 25
   distinct scenario check ids.

## Edge cases

- A workspace shape whose Git fixture creation itself fails (e.g. `git init`
  unavailable) must fail the run with a distinct code rather than silently
  skipping that shape's checks.
- A scenario that would write outside the disposable root must be rejected
  by the existing `BoundedFixtureFactory` escape guard (T69), not a new
  mechanism.
- Two consecutive runs must not reuse the same disposable root path, so
  convergence is proven across genuinely different filesystem state, not
  memoized output.

## Safety and authority

- No production credentials, workspace registrations, or policy stores are
  read or written; the T69 `assertTestOnlyMaterials` guard is unchanged and
  still enforced.
- The offline guard is fail-closed: an unexpected outbound attempt is a
  fault, not a warning.
- This specification does not change CI, security controls, or authority
  boundaries; it only adds scenario content and a CLI command to the T69
  trust domain in-repository.

## Success criteria

Every requirement above has file-and-assertion evidence, `pnpm gate:full`
plus every gate `scripts/gate-selection.mjs` selects for the changed paths
passes, a discrimination sensor kills injected faults with none surviving,
and `docs/qualification/t70-validation.md` binds the evidence to the
implementation revision. Human review decides merge.
