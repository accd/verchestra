# T72 Deep Doctor and Signed Diagnostic Reports Tasks

## Atomic execution plan

| Task | Deliverable | Depends on | Focused verification | Commit boundary |
| ---- | ----------- | ---------- | -------------------- | --------------- |
| T0 | Spec, design, task plan, portable handoff | None | `pnpm agent:check` | Planning only |
| T1 | Application doctor rules: closed `DOCTOR_CHECK_IDS`, `DoctorCheckFact`, `buildDoctorReport`, `assertDoctorReportPayload`, blocked-capability + remediation catalog, exit-code mapping, pure verdicts | T0 | `tests/unit/doctor-rules.test.mjs` | Application contract and tests |
| T2 | `schemas/doctor-report/1.schema.json` + regenerated `packages/contracts/src/generated.ts` + contract tests | T1 | `pnpm test:contract`, `pnpm typecheck` | Report schema and tests |
| T3 | Read-only subsystem fact adapters (`packages/self-test/src/doctor-facts.ts`) reusing existing clock/runtime-db/cedar/git/native-asset/schema/secret-presence/driver/connector/probe read-only surfaces | T1 | Doctor fact integration tests | Node facts and tests |
| T4 | Doctor composition root: sentinel capture/invariance, redaction (path pseudonym + prohibited-content scan), per-run signer + sealer | T2, T3 | Doctor security tests | Composition and tests |
| T5 | CLI `doctor` verb + `--deep` option, dispatch branch, human/JSON renderers, stable exit codes | T2, T4 | Doctor contract/e2e tests | Public CLI behavior and tests |
| T6 | Case-count audit (≥30), discrimination sensor, `pnpm gate:security`, handoff evidence | T1–T5 | `pnpm gate:security` | Evidence update only |

## Test matrix

| Layer | Minimum outcomes |
| ----- | ---------------- |
| Unit | Closed catalog, missing/duplicate/unknown check, blocked-without-remediation, allowlist + prohibited-content rejection, exit-code mapping, verdict from facts |
| Contract | `doctor-report` schema validates a passing and a failing example; rejects unknown fields, bad verdicts, prohibited content; generated-type parity |
| Integration | Each read-only fact observer returns a fact and never a verdict; absent fixtures return `blocked` + remediation |
| E2E | `vestra doctor --deep` renders human and JSON with the same verdict; exit 0 on all-pass, distinct non-zero otherwise |
| Security | No mutable/paid method reachable; report carries no secret/path/DB content; sentinels byte-identical before/after; signing key never printed |

The total new/strengthened cases must be at least 30. No case may be skipped,
todo-marked, or made less specific to satisfy the threshold.

## Traceability

| Task | Requirements |
| ---- | ------------ |
| T1 | DOC-02, DOC-03, DOC-05 (payload), DOC-04 (rule) |
| T2 | DOC-05 |
| T3 | DOC-01, DOC-02, DOC-03 |
| T4 | DOC-04, DOC-06 |
| T5 | DOC-05, DOC-01 |
| T6 | DOC-07 and all requirements |

## Commit rules

- Each task is implemented test-first and committed only after its focused
  verification passes. One logical behavior per commit.
- Generated contract types change only through the schema and generator, never
  by editing generated output.
- No push occurs without explicit contributor authorization.
- Independent verification is not self-certified by the implementation agent;
  the T72 qualification report is written by a separate verifier after the
  implementation is reviewed, and it advances the chain to T73.

## Execution evidence

| Task | Status | Commit / evidence |
| ---- | ------ | ----------------- |
| T0 | Done | `7219cce`; spec, design, tasks, handoff |
| T1 | Done | `eb8b5e9`; pure doctor verdict rules, 23 unit cases |
| T2 | Done | `9af701d`; doctor-report schema + generated type, 14 contract cases |
| T3 | Done | `4f685ab`; read-only probe port + collectDoctorFacts, 8 unit cases |
| T4 | Done | doctor-composition sentinel/redaction/signing; 9 security cases |
| T5 | Done | `doctor` verb + `--deep`, dispatch, exit codes; 8 e2e cases |
| T6 | Done | 62 new doctor cases (23+8 unit, 14 contract, 8 e2e, 9 security); gate:full + gate:security PASS |
