# Doctor scoped verdict

## Problem

A user who installs the published package cannot get `vestra doctor` to report
`PASS`, whatever they set up. On `verchestra@0.0.0-qualification.9`, run in a
freshly initialized Workspace on Windows, `doctor` and `doctor --deep` both report
`doctor.verdict: BLOCKED` and exit `4` (observed 2026-10-30). Six of the twelve
checks report `blocked`:

- `cedar-policy`
- `connector`
- `driver`
- `probe`
- `sandbox`
- `sqlite-durable-state`

Each one observes a path under `.verchestra/` that no product command writes:

- `policy/active.bundle`, with `trusted-signer.pub` beside it;
- `runtime.db`;
- `drivers/`, `connectors/` and `probe/fixtures/`, each with an
  `availability.json`;
- `sandbox/`, with a planted escape link.

Only the qualification-only `scripts/provision-doctor-fixtures.mjs` creates them
(AD-024). The remediation codes the report hands back name no command. Examples
are `provision-policy-bundle` and `install-driver`, and for the policy bundle
the doctor's own source states that "no production signer for a policy bundle
exists yet anywhere in the repository".

Two groups pay for this:

- **The user.** `BLOCKED` with remediation codes they cannot act on reads as a
  broken install. The quick start has to pre-empt this: "on a machine set up
  only for `task`, `BLOCKED` is its expected verdict".
- **The project.** Exit condition X5 of
  `docs/qualification/qualification-line-exit-record.md` stays unmet, and with
  it the public `0.x` line.

When this ships, a user whose installation and Workspace are healthy sees
`PASS` and exit `0`. The six subsystems this release does not offer are named
as not offered, not as something the user failed to do.

## Flow

This reuses the twelve existing probes, the closed check catalog, the
remediation registry and the sealed-report path unchanged. It changes only how
an absent subsystem is classified, and it creates the schema the report
validates against.

1. `vestra doctor [--deep]` (exists) -> `apps/vestra-cli/src/doctor-composition.ts`
   (exists). It runs the twelve probes as today, read-only, and hands each
   `DoctorObservation` on.
2. `packages/application/src/doctor/doctor-facts.ts` (exists). `observeToFact`
   maps each observation to a fact:
   - present and healthy is `pass`;
   - present and unhealthy is `fail`;
   - absent is `blocked`, except for a check in the declared not-offered set,
     where absent is `not-offered` (door 2) and carries no remediation code.
3. `packages/application/src/doctor/doctor.ts` (exists). `buildDoctorReport`
   computes the verdict:
   - `FAIL` if any check failed;
   - `BLOCKED` if any check is blocked;
   - `PASS` otherwise.
   `not-offered` never raises the verdict. The report also lists the
   not-offered capabilities (door 1).
4. `schemas/doctor-report/2.schema.json` (door 1) validates the payload.
   `doctor.contract-schema` checks that `doctor-report@2` is registered.
5. Out: the human and JSON renderers project the same payload. Exit codes are
   unchanged: `PASS` exits `0`, `FAIL` exits `1`, `BLOCKED` exits `4`. The
   sealed artifact names `doctor-report` version `2`.

## Impact

| Front | What changes |
| --- | --- |
| domain | New term: `not-offered`, a fourth check status. It means the release ships no way for a user to provision this subsystem. It lives in `packages/application/src/doctor/`. |
| domain | Existing term: `blocked` meant "absent". It now means "absent, and this release offers a way to provision it". Who branches on it today: `buildDoctorReport`, the exit mapping in `apps/vestra-cli/src/cli.ts`, `tests/e2e/doctor-cli-e2e.test.mjs` (which asserts a bare machine is `BLOCKED` and exits 4), `tests/unit/doctor-rules.test.mjs`, the public-regression corpus, and the README exit-code table. |
| domain | Existing term: `PASS` meant every check passed. It now means no check failed or is blocked, so a `PASS` report can list not-offered capabilities. `README.md`, `docs/quick-start.md` and the site's install page describe `doctor`. |
| contract | `doctor-report@1` becomes `doctor-report@2`. Consumers: the sealed DSSE artifact (`packages/evidence/src/integrity/dsse.ts`), `doctor.contract-schema`, `tests/contract/doctor-report.test.mjs`, `tests/contract/schema-registry.test.mjs`, `tests/security/doctor-diagnostic.test.mjs`, `tests/integration/doctor-sentinel-bracket.test.mjs` and `tests/public-regression/corpus.mjs`. |
| stored data | Nothing to migrate. A doctor report is computed per run and sealed into a fresh artifact. No persisted report is read back. |
| qualification | On a machine where `scripts/provision-doctor-fixtures.mjs` has run, the six checks still observe the fixtures and report `pass` or `fail` exactly as today, so the DDL evidence keeps its meaning. |

## Relations

None. No stored-data shape changes.

## Surface

Only routes whose signature changes.

| Route | In | Out | Status |
| --- | --- | --- | --- |
| `vestra doctor [--deep] --output json` | none | a `doctor-report@2` payload: `doctor.verdict`, `doctor.check_codes`, `doctor.failure_codes`, `doctor.blocked_capabilities`, `doctor.not_offered_capabilities`, `doctor.remediation_codes`, `doctor.duration_ms` | `exit 0` (`PASS`), `exit 1` (`FAIL`), `exit 4` (`BLOCKED`) |
| `vestra doctor [--deep]` (human output) | none | the same verdict and check list. A not-offered check is shown as not offered by this release, with no remediation line | `exit 0`, `exit 1`, `exit 4` |

## Landing

| One-way door | Literal shape | Alternative rejected |
| --- | --- | --- |
| 1. The report contract version | A new `schemas/doctor-report/2.schema.json` with `$id` `ves://doctor-report/2` and `additionalProperties: false`. It adds the required field `doctor.not_offered_capabilities` (array of capability ids, unique). The `doctor.check_codes` item pattern becomes `^doctor\.[a-z][a-z-]*:(pass\|fail\|blocked\|not-offered)$`. `1.schema.json` stays in the registry unchanged, following the `task-request/2` precedent. | Keep `@1` and stop counting the six in the verdict. That would let a `PASS` report carry `:blocked` codes and non-empty `doctor.blocked_capabilities`, which contradicts what every existing `@1` reader can rely on (`PASS` means nothing is blocked). |
| 2. The fourth check status | `DoctorCheckStatus = "pass" \| "fail" \| "blocked" \| "not-offered"`. A frozen `DOCTOR_NOT_OFFERED_CHECK_IDS` in `packages/application/src/doctor/doctor.ts` lists exactly `doctor.cedar-policy`, `doctor.connector`, `doctor.driver`, `doctor.probe`, `doctor.sandbox` and `doctor.sqlite-durable-state`. A `not-offered` fact carries no `remediationCode`. | Drop the six checks from the catalog. That would erase the qualification fixtures' `pass` and `fail` evidence (DDL), and the twelve-id catalog is asserted closed by the e2e and contract tests. A future release that offers one of the six would then have to re-add a check id instead of removing it from one set. |
| 3. The sealed artifact's predicate (found while building) | `packages/evidence/src/integrity/dsse.ts` `PREDICATE_TYPES_V2` gains `"doctor-report": "https://accd.github.io/verchestra/attestation/doctor-report/v2"`. A version 2 doctor artifact canonicalizes under V2, so its declared sets are code-unit ordered, which `sortedUnique` already does (`normalizeDeclaredSet`, CJ4-05). | Seal version 2 payloads under the `/v1` predicate. The predicate is bound into the signed Statement, so a `/v1` attestation could not be told apart from one over the `@1` shape. The table comment requires a distinct predicate for each version. |

Nothing else in this change is hard to reverse.

## Criteria

### S1: A healthy installation reports PASS (P1)

A user with a healthy installation and Workspace sees `PASS` and exit `0`, and
the six subsystems this release does not offer are named as not offered.

**Acceptance Criteria**

1. WHEN a check in `DOCTOR_NOT_OFFERED_CHECK_IDS` observes its subsystem absent THEN the doctor SHALL record it as `<checkId>:not-offered` with no remediation code.
2. WHEN a check outside `DOCTOR_NOT_OFFERED_CHECK_IDS` observes its subsystem absent THEN the doctor SHALL record it as `<checkId>:blocked` with its registered remediation code, as today.
3. WHEN no check is `fail` or `blocked` and at least one is `not-offered` THEN the doctor SHALL report `doctor.verdict: PASS` and exit `0`.
4. WHEN a run has any `not-offered` check THEN `doctor.not_offered_capabilities` SHALL list exactly those checks' capability ids, sorted by code unit and unique, and `doctor.blocked_capabilities` and `doctor.remediation_codes` SHALL contain none of them.
5. The doctor report SHALL validate against `doctor-report@2`, and `doctor.contract-schema` SHALL pass only when `doctor-report@2` is registered.
6. The sealed doctor artifact SHALL name schema `doctor-report` version `2`.

**Independent test:** in a fresh Workspace with the Claude Code credential
bound and nothing else provisioned, `vestra doctor --deep --output json`
returns `PASS`, exits `0`, and lists the six capabilities under
`doctor.not_offered_capabilities`.

### S2: Every other verdict path is unchanged (P1)

What a user or the qualification fixtures could already observe keeps its
meaning.

**Acceptance Criteria**

7. WHILE a not-offered subsystem is provisioned and healthy (for example by `scripts/provision-doctor-fixtures.mjs`) the doctor SHALL report that check as `pass`.
8. IF a not-offered subsystem is present but unhealthy THEN the doctor SHALL report that check as `fail` with its registered remediation code, and the verdict SHALL be `FAIL` with exit `1`.
9. IF any check outside the not-offered set is `blocked` and none is `fail` THEN the doctor SHALL report `BLOCKED` and exit `4`. An example is `doctor.secret-presence` with no credential bound.
10. The human renderer and the JSON renderer SHALL project the same verdict and the same per-check status for every one of the four statuses.

**Independent test:** with the fixtures provisioned, `doctor --deep` reports
all six as `pass`. With one fixture corrupted, the verdict is `FAIL` and the
exit is `1`. In a non-Workspace directory, with no credential, the verdict is
`BLOCKED` and the exit is `4`.

### S3: A user can read what they can act on (P2)

The documentation tells a user what `PASS` and not offered mean, and the
qualification record can cite it.

**Acceptance Criteria**

11. The documentation (`README.md`, `docs/quick-start.md` and the site's install page) SHALL state that a healthy installation reports `PASS`. They SHALL name the six not-offered capabilities as not offered by this release, with no action required.
12. The quick start SHALL no longer state that `BLOCKED` is the expected verdict on a machine set up only for `task`.

**Independent test:** read the three pages. Then run `doctor` on a machine
set up as the quick start describes, and see `PASS`.

## Out of scope

| Excluded | Why |
| --- | --- |
| Re-pointing `doctor.sqlite-durable-state` at the real `runtime.sqlite` under the state root | The real store is per-Workspace under the state root (`packages/platform-node/src/state-root.ts:91`), and observing it is a probe redesign. That is a follow-up which removes the check from the not-offered set. |
| Re-pointing `doctor.driver` at the pinned provider CLIs | `task check` already reports provider prerequisites. Reusing it in doctor is its own change. |
| Offering `doctor.probe` through the #235 SQLite probe worker (AD-086, AD-087) | That work is in flight on its own branch. When it lands, `doctor.probe` can leave the not-offered set. |
| A production policy-bundle signer, a connector, or a sandbox the user provisions | None exists in the product. Building one is a capability, not a diagnostic. |
| A user configuration surface for subsystem locations | AD-024 defers it to T76+. |

## Assumptions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Which X5 path | The doctor scopes the verdict (X5's second branch), not documented provisioning per check | No product command writes any of the six observed paths, so documenting provisioning would mean telling users to hand-create fixture files. The user answered "avançar" to this recommendation. | n |
| The status name | `not-offered` | Says it is the release's limit, not the user's omission. Kebab-case fits the existing status vocabulary. | n |
| The field name | `doctor.not_offered_capabilities` | Parallels `doctor.blocked_capabilities`. | n |
| `doctor-report@1` | Stays registered and unchanged; nothing emits it after this change | The `task-request` v1 to v2 precedent keeps the earlier schema. | n |
| Exit code for `not-offered` | None of its own: `not-offered` never raises the verdict | The exit codes are a published table (README), and a new code would be a second door. | n |

**Open questions:**

| # | Kind | Question | Until answered |
| --- | --- | --- | --- |
| 1 | blocks go-live | Do the reviewers accept a scoped `PASS` as meeting X5? The record lists "a `doctor` verdict that scopes them" as one of its two branches. | X5 cannot be marked met in the exit record, whose next signature is the owner's. |

## Observable

| Surface | Decision | Landing |
| --- | --- | --- |
| command `vestra doctor` | output format and verbosity | AC 10 (human and JSON parity) |
| command `vestra doctor` | every flag and its default | existing: `--deep` and `--output`, unchanged |
| command `vestra doctor` | exit codes | AC 3, AC 8, AC 9 (0, 1 and 4 unchanged) |
| command `vestra doctor` | what it prints when it fails halfway | existing: a probe past `DOCTOR_PROBE_TIMEOUT_MS` is present-but-unhealthy, so it is `fail` (DDL-04) |
| contract `doctor-report@2` | response shape | AC 4, AC 5 |
| contract `doctor-report@2` | error shape and codes | existing: `VES_DOCTOR_*` refusals, unchanged |
| contract `doctor-report@2` | versioning | door 1 |
| contract `doctor-report@2` | who may call it, rate limits | n/a: a local read-only command with no caller identity |
| docs `README.md`, `docs/quick-start.md`, site install page | structure, tone, what the reader does next | AC 11, AC 12 |

## Sources

- `docs/qualification/qualification-line-exit-record.md`, exit condition X5:
  sets the two acceptable branches.
- `docs/qualification/acceptance-matrix.md`, L2: states that a full `doctor`
  `PASS` on a provisioned machine is not reachable by a user.
- `.specs/STATE.md`, AD-024: binds the six paths to qualification fixtures and
  keeps `vestra init` from creating them.
