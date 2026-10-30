# Doctor scoped verdict checks

Profile: light
Plan: `.specs/features/doctor-scoped-verdict/plan.md`

The feature has:

- 16 checks in 3 slices;
- 2 one-way doors (`doctor-report@2`, the `not-offered` status);
- 1 open question, which blocks go-live but not the build.

## Checks

### S1 - A healthy installation reports PASS · 6 files · ~70 KB · ~18k

**C1** - For each of the six checks in `DOCTOR_NOT_OFFERED_CHECK_IDS` (`doctor.cedar-policy`, `doctor.connector`, `doctor.driver`, `doctor.probe`, `doctor.sandbox`, `doctor.sqlite-durable-state`), an absent observation becomes a fact with status `not-offered` and no `remediationCode` (AC 1).
Proof: `node --test --test-name-pattern="an absent not-offered subsystem is not-offered with no remediation" tests/unit/doctor-not-offered.test.mjs`

**C2** - For each of the six checks outside the set (`doctor.installation`, `doctor.contract-schema`, `doctor.native-asset`, `doctor.git`, `doctor.secret-presence`, `doctor.clock`), an absent observation becomes `blocked` with that check's registered remediation code (AC 2).
Proof: `node --test --test-name-pattern="an absent offered subsystem stays blocked with its remediation" tests/unit/doctor-not-offered.test.mjs`

**C3** - A report whose facts are the six offered checks `pass` and the six not-offered checks `not-offered` has `doctor.verdict` `PASS`, and `doctorExitCode` of it is `0` (AC 3).
Proof: `node --test --test-name-pattern="not-offered checks alone leave the verdict PASS and exit 0" tests/unit/doctor-not-offered.test.mjs`

**C4** - In that report, `doctor.not_offered_capabilities` equals exactly `["connectors.available", "drivers.available", "policy.enforceable", "probes.available", "sandbox.enforced", "state.durable"]` (code-unit sorted, unique), while `doctor.blocked_capabilities` and `doctor.remediation_codes` are both `[]` (AC 4).
Proof: `node --test --test-name-pattern="not-offered capabilities are listed apart from blocked ones" tests/unit/doctor-not-offered.test.mjs`

**C5** - `doctor-report@2` is registered and validates a `PASS` report that carries six `:not-offered` check codes. It rejects a report missing `doctor.not_offered_capabilities` (AC 5, door 1).
Proof: `node --test --test-name-pattern="doctor-report@2" tests/contract/doctor-report.test.mjs`

**C6** - `doctor --deep --output json`, run on the source CLI, emits a payload that validates against `doctor-report@2`, and `doctor.contract-schema` reports `pass` (AC 5).
Proof: `node --test --test-name-pattern="doctor --deep emits a JSON report that validates against doctor-report@2" tests/e2e/doctor-cli-e2e.test.mjs`

**C7** - The artifact `runDoctor` seals names schema `doctor-report` version `2` (AC 6).
Proof: `node --test --test-name-pattern="the sealed report names doctor-report version 2" tests/integration/doctor-sentinel-bracket.test.mjs`

### S2 - Every other verdict path is unchanged · 4 files · ~45 KB · ~12k

**C8** - For each of the six not-offered checks, a present and healthy observation becomes `pass` with no remediation (AC 7).
Proof: `node --test --test-name-pattern="a provisioned not-offered subsystem passes" tests/unit/doctor-not-offered.test.mjs`

**C9** - For each of the six not-offered checks, a present but unhealthy observation becomes `fail` with its registered remediation code. The report's verdict is then `FAIL` and `doctorExitCode` is `1` (AC 8).
Proof: `node --test --test-name-pattern="an unhealthy not-offered subsystem fails with its remediation" tests/unit/doctor-not-offered.test.mjs`

**C10** - A report with one offered check `blocked`, no `fail`, and the six not-offered checks `not-offered` has verdict `BLOCKED`, and `doctorExitCode` is `4` (AC 9).
Proof: `node --test --test-name-pattern="a blocked offered check still makes the verdict BLOCKED and exit 4" tests/unit/doctor-not-offered.test.mjs`

**C11** - From a bare source directory the CLI still reports `BLOCKED` and exits `4`, and its check codes include all six `:not-offered` codes (AC 9, AC 1 at the boundary).
Proof: `node --test --test-name-pattern="a bare source machine reports BLOCKED and exits 4" tests/e2e/doctor-cli-e2e.test.mjs`

**C12** - The human renderer prints every check code the JSON renderer reports, including the six `:not-offered` ones, and the same verdict (AC 10).
Proof: `node --test --test-name-pattern="the human and JSON renderers project the same verdict and checks" tests/e2e/doctor-cli-e2e.test.mjs`

**C13** - A `not-offered` fact on a check outside `DOCTOR_NOT_OFFERED_CHECK_IDS` fails closed with `VES_DOCTOR_CHECK_FACT_INVALID`. So does a `not-offered` fact that carries a `remediationCode` (door 2).
Proof: `node --test --test-name-pattern="not-offered is closed to the declared checks and carries no remediation" tests/unit/doctor-not-offered.test.mjs`

**C14** - `doctor-report@1` stays registered and still validates the same passing and blocked reports it validated before (door 1).
Proof: `node --test --test-name-pattern="doctor-report@1 is a registered canonical schema" tests/contract/doctor-report.test.mjs`
Proof: `node --test --test-name-pattern="validates a blocked diagnostic report with remediation" tests/contract/doctor-report.test.mjs`

### S3 - A user can read what they can act on · 4 files · ~60 KB · ~15k

**C15** - `README.md`, `docs/quick-start.md` and `apps/site/src/content/docs/docs/install-and-run.md` each state that a healthy installation reports `PASS`, and each names the six not-offered capabilities (AC 11).
Proof: `node --test --test-name-pattern="the docs say a healthy installation reports PASS and name what is not offered" tests/agent-readiness/doctor-docs.test.mjs`

**C16** - `docs/quick-start.md` no longer contains the sentence that `BLOCKED` is the expected verdict on a machine set up only for `task` (AC 12).
Proof: `node --test --test-name-pattern="the quick start no longer calls BLOCKED expected" tests/agent-readiness/doctor-docs.test.mjs`

## Coverage

| Set (size) | Member -> proof | Unproven |
| --- | --- | --- |
| not-offered checks, absent (6) | C1, table-driven over all 6 | - |
| offered checks, absent (6) | C2, table-driven over all 6 | - |
| not-offered checks, present and healthy (6) | C8, table-driven over all 6 | - |
| not-offered checks, present and unhealthy (6) | C9, table-driven over all 6 | - |
| verdicts (3) | `PASS` C3 · `FAIL` C9 · `BLOCKED` C10 | - |
| check statuses in the payload (4) | `pass` C3 · `fail` C9 · `blocked` C10 · `not-offered` C1 | - |
| `vestra doctor --output json` exit codes (3) | `exit 0` C3 · `exit 1` C9 · `exit 4` C11 | - |
| `vestra doctor` human output statuses (3 observable from a bare directory) | `pass` C12 · `blocked` C12 · `not-offered` C12 | - |
| door 1: report schema versions (2) | `@2` C5, C6 · `@1` C14 | - |
| door 2: `not-offered` admission (2 rules) | outside the set C13 · with a remediation C13 | - |
| documentation pages (3) | `README.md` C15 · `docs/quick-start.md` C15, C16 · site install page C15 | - |

- `exit 0` and `exit 1` are proven at the `doctorExitCode` layer (C3, C9). Reaching
  them across the CLI boundary needs a bound credential and an activated release
  (`tests/build/sealed-launcher-closure.test.mjs` records that limitation), so
  only `exit 4` is crossed at the boundary (C11). `doctorExitCode` is the only
  mapping `main.ts` uses (`apps/vestra-cli/src/main.ts:94`), so this is the
  level where the decision lives.
- The human renderer cannot be driven to `fail` from a bare directory. C12 covers
  the three statuses observable there. The renderer projects
  `doctor.check_codes` without branching on status.

## Swept

- validation: C5, C13
- failure modes: C9
- idempotency: n/a - a doctor run is read-only and recomputed per invocation; two runs converging is already asserted ("two runs converge to the same check fingerprint")
- authorization: n/a - a local read-only command with no caller identity
- concurrency: existing - the sentinel bracket around fact collection (`tests/integration/doctor-sentinel-bracket.test.mjs`) is unchanged
- data lifecycle: n/a - no report is persisted or read back
- dependency failure: existing - a probe past `DOCTOR_PROBE_TIMEOUT_MS` is present-but-unhealthy, so `fail` (DDL-04), unchanged by this feature
- state transitions: C1, C2, C8, C9
- observability: n/a - the report itself is the observable output; no logging requirement

## Handoff

- S1 = 18k, S2 enters at 30k, S3 at 45k total, under the 150k budget - one builder.
  Sizing: the twelve touched files total 134,685 bytes (`wc -c`) / 4 ≈ 34k, plus
  roughly 11k for the new test files and the schema.
- Mechanism: one builder.
