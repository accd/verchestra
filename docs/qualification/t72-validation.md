---
schema: verchestra-qualification-report/v1
task: T72
revision: 2b628af0cd23c4c8fd7dcc93f36e348c8d4aaa94
gates: pnpm gate:quick, pnpm gate:security
gateResults: pass, pass
gateRevision: 2b628af0cd23c4c8fd7dcc93f36e348c8d4aaa94
criteriaEvidence: 7 of 7 acceptance criteria proven
skipped: 0
todo: 0
discriminationSensor: 5 killed, 0 survived
reviewedIn: https://github.com/accd/verchestra/pull/246
---

# T72 Deep Doctor and Signed Diagnostic Reports Validation

## Scope

T72 adds the read-only `vestra doctor --deep` diagnostic, a closed twelve-check
catalog, stable PASS/FAIL/BLOCKED semantics, one schema shared by the human and
JSON projections, sentinel-invariance enforcement, and a purpose-bound signed
diagnostic artifact. The implementation merged through PR #188 and the
independent audit remediations merged through PRs #208, #211, and #212. This
report binds the last remediation revision, `2b628af`, which is reachable from
`main`; no T72 source, schema, or test file changed between that revision and
the verification base `206501a`.

The implementation and remediation authors were the repository owner identities
`Test` and `accd`. This report and its discrimination campaign are authored by
`MiguelCorre`, who did not author any T72 implementation commit. Accountability
for the report itself is recorded by the pull request named in `reviewedIn`, not
by a self-declared independence field.

The T72-specific evidence is 69 cases: 31 unit, 14 contract, 8 E2E, 12 security,
and 4 architecture. The issue's declared contract/E2E/security threshold counts
34 cases, above the required minimum of 30. All 69 focused cases pass with zero
failed, skipped, or todo cases.

## Deterministic gates

Both declared gates ran against exact revision
`2b628af0cd23c4c8fd7dcc93f36e348c8d4aaa94` with Node 24.14.0 and pnpm
10.34.5.

| Command | Result | Evidence |
| ------- | ------ | -------- |
| `pnpm gate:quick` | PASS | Independent Windows run: format, lint, complexity, typecheck, unit, and agent-readiness stages passed with zero skipped and zero todo. |
| `pnpm gate:security` | PASS | Externally dispatched [manual qualification run 31330393346](https://github.com/accd/verchestra/actions/runs/31330393346), job 93287608540: the workflow checked out the requested `2b628af` revision, installed Node 24.14.0, Claude Code 2.1.168, and Codex CLI 0.115.0, then passed 4,161 cases with zero skipped and zero todo. |

The security profile passed 1,964 unit, 483 contract, 163 E2E, 23 architecture,
249 qualification, 996 security, and 283 fault cases. A first local Windows
security attempt was not recorded as a pass: it reached 247 of 249 qualification
cases and reported the Claude and Codex probes as unavailable. The external
workflow supplies the repository-pinned binaries and is the substantive gate
evidence used here; an unconfigured local provider was never relabelled green.

## Revision binding

`git merge-base --is-ancestor 2b628af origin/main` succeeds. The bound revision
contains the complete implementation plus the three audit remediations:

- `964f4ba` and formatting follow-up `49661b2`: structural read-only import,
  filesystem, process-spawn, and adapter-reachability guards;
- `80736a9`: secret, database URL, SQLite header, and absolute-path exclusion
  from the payload and sealed artifact;
- `2b628af`: real control-root sentinel invariance and fresh per-run signing
  identity evidence.

`git diff 2b628af..206501a` is empty for the doctor application rules, CLI
composition, schema, and every T72 unit, contract, E2E, security, and
architecture suite. Later `main` work therefore does not require an equivalence
argument for the qualified surface.

## Adequacy matrix

The matrix is independently derived from
`.specs/features/deep-doctor/spec.md`, not from the implementation author's
issue comment.

| Criterion | Requirement | Assertion evidence |
| --------- | ----------- | ------------------ |
| DOC-01 | Every observation is read-only; no mutable or paid adapter is reachable | `doctor-readonly-graph.test.mjs` — “deep doctor composes from a read-only allowlist only”, “reaches no writing filesystem call”, “spawns only a read-only git version probe”, and “names no command bus, provider, driver, connector, or writer adapter”; `doctor-cli-e2e.test.mjs` — “the read-only diagnostic writes nothing to the working directory”. |
| DOC-02 | Exactly the registered twelve-check catalog; missing, duplicate, or unknown ids fail closed | `doctor-rules.test.mjs` — “the doctor check catalog is closed and exactly twelve ids”, “a missing check fails the catalog closed”, “an unknown check id fails the catalog closed”, and “a duplicated check id fails the catalog closed”; `doctor-cli-e2e.test.mjs` — “every reported check belongs to the closed twelve-id catalog”. |
| DOC-03 | Missing or unhealthy subsystems name exact capabilities and registered remediations without raw errors | `doctor-facts.test.mjs` — absent, unhealthy, and throwing probes map to blocked/fail facts with the registered remediation and no thrown text; `doctor-rules.test.mjs` — missing, unknown, and raw-prose remediations fail closed; `doctor-diagnostic.test.mjs` — “an under-provisioned machine reports BLOCKED with only registered codes”. |
| DOC-04 | Successful and non-passing runs preserve the Sentinel Set or fail closed | `doctor-diagnostic.test.mjs` — “a sentinel that changes during the run fails closed”, “control-root sentinels are deterministic and read-only”, and “DOC-04: the real control-root sentinels are byte-identical across a real run”; blocked/failing probe cases seal only after the same before/after check. |
| DOC-05 | One closed report drives human and JSON renderers with stable exits | `doctor-report.test.mjs` — 14 schema cases validate PASS/BLOCKED reports and reject every malformed field/value class; `doctor-cli-e2e.test.mjs` — JSON schema validation, human/JSON verdict and check parity, bare/deep equivalence, and source-mode BLOCKED exit 4; `doctor-rules.test.mjs` — PASS→0, FAIL→1, BLOCKED→4 and fail-over-blocked precedence. |
| DOC-06 | Prohibited content is excluded before sealing; the report uses a fresh purpose-bound TEST-ONLY identity | `doctor-diagnostic.test.mjs` — path-laden errors, secrets, database URLs, SQLite headers, and absolute paths reach neither payload nor artifact; sealing requires `doctor-report`; “DOC-06: runDoctorDeep seals a fresh per-run identity and leaks no private key”; `doctor-cli-e2e.test.mjs` proves no working-directory write. |
| DOC-07 | At least 30 contract/E2E/security cases, declared security gate, no weakened assertions, independent review | 34 contract/E2E/security cases pass against a minimum of 30; 69 focused cases and 4,161 security-gate cases pass with zero skipped/todo; the five-mutation independent sensor has no survivor; implementation and report authors differ. |

## Issue acceptance and completion checklist

| Issue #13 outcome | Evidence |
| ----------------- | -------- |
| No mutable or paid adapter method is reachable | DOC-01 structural import/process/filesystem guard plus the E2E no-write assertion. |
| Missing and unhealthy fixtures identify the exact blocked capability and safe remediation | DOC-03 fact mapping, closed capability registry, and remediation rejection tests. |
| Sentinels remain unchanged for successful and failing checks | DOC-04 synthetic mutation failure plus real control-root before/after equality. |
| Human and JSON output share one closed schema and stable exit semantics | DOC-05 contract, E2E projection, and pure exit-code assertions. |
| At least 30 contract, E2E, and security cases pass | 34 pass in those exact three layers; the 69-case focused total adds unit and architecture evidence. |
| Complete redaction and prohibited-field absence | DOC-06 positive allowlists and injected secret/path/database-content classes. |
| Reports use a test-domain signing identity | DOC-06 per-run Ed25519 generation, `doctor-report` purpose enforcement, distinct artifacts, no private-key serialization, and no write. |

## Discrimination sensor

Five mutations were applied one at a time to
`packages/application/src/doctor/doctor.ts` in a disposable detached worktree at
the bound revision. After each run the mutation was reversed with an exact
patch. `git diff --exit-code` then proved the source restored, and the unmutated
31-case pure doctor suite passed.

| # | Property | Mutation | Result |
| - | -------- | -------- | ------ |
| M1 | DOC-02 catalog completeness | Replaced the computed missing-check list with an empty list | KILLED by “a missing check fails the catalog closed” (1 failure). |
| M2 | DOC-03 exact remediation failure | Disabled the missing-remediation branch | KILLED by the failing and blocked missing-remediation assertions (2 failures). |
| M3 | DOC-05 FAIL verdict and precedence | Disabled the `failed.length > 0` verdict branch | KILLED by single-fail and fail-over-blocked assertions in both rule and fact suites (3 failures). |
| M4 | DOC-03/DOC-05 BLOCKED verdict | Disabled the `blocked.length > 0` verdict branch | KILLED by the two under-provisioned/BLOCKED assertions (2 failures). |
| M5 | DOC-05 stable exit semantics | Swapped FAIL exit 1 and BLOCKED exit 4 | KILLED by the two exact exit-code assertions (2 failures). |

All five mutations were killed; none survived.

## Non-shallow checks and reconciliations

- Seven source-mode subsystem checks observe fixture presence and truthfully
  return BLOCKED when absent. They are not claimed as live subsystem health
  probes. Issue #207 carries the live read-only upgrades into the provisioned
  T75 matrix, where the fixtures exist. This limitation does not turn absence
  into PASS and does not widen the T72 read-only graph.
- No path-bearing observation enters the report. The booleans-only fact port and
  closed positive value registries exclude machine-local paths before sealing,
  so there is no raw path on which a pseudonymizer could operate. The injected
  prohibited-content tests prove the required redaction outcome rather than
  asserting that an unused pseudonymizer exists.
- A real source checkout exercises the BLOCKED→exit-4 process path. FAIL→exit-1
  is enforced by the pure rule tests; producing a real FAIL would require a
  deliberately corrupted installed layout, while the E2E BLOCKED case already
  proves that rendered output preserves a non-zero diagnostic exit.
- The signer is generated inside the CLI composition root for each run, is
  bound to `doctor-report`, exports only public verification material, and
  writes nothing to the working directory. It does not reuse production signing
  authority.

## Verdict

T72 is complete. Seven of seven specification criteria and every issue #13
acceptance/checklist outcome have file-and-assertion evidence. The declared
gates pass at the reachable bound revision, the focused evidence exceeds the
minimum with zero skipped or todo cases, and five of five independent behavior
mutations are killed with no survivor.

This verdict does not claim that the seven source-mode presence probes are the
live T75 probes, that Verchestra has a public installer, or that it is
production-ready. T73 public regression campaigns are the next qualification
task. Human review of this report remains mandatory in the pull request named by
`reviewedIn`.
