---
schema: verchestra-feature-handoff/v1
feature: deep-doctor
issue: 13
status: in_progress
branch: feat/t72-deep-doctor
baseRevision: 523fc224d105978a9d3acb99fc8e6c134e81d6cf
lastCompletedTask: T1
nextTask: T2 — doctor-report JSON schema + generated types + contract tests
lastGate: gate:quick PASS at T1 (23 doctor-rules unit cases)
updatedAt: 2026-08-06T22:39:50Z
---

# Scope

Implement T72 (#13): `vestra doctor --deep`, a read-only diagnostic surface, and
signed diagnostic reports. Follows the AD-010 three-region split and reuses the
existing `ArtifactSealer`/`NodeEd25519Signer` and the support-bundle redaction
toolkit — no new crypto, no new redaction engine. Spec, design, and tasks are in
this feature directory.

# Authority and external effects

The owner authorized advancing the beta chain autonomously without stopping.
Local atomic commits on `feat/t72-deep-doctor` are authorized. This branch is
NOT merged and the qualification chain is NOT advanced: T72 is qualifiable only
when the whole feature is complete and `gate:security` is green, and a separate
verifier writes the T72 qualification report.

# Completed evidence

- T0: spec (`spec.md`, 7 requirements DOC-01..07), design (`design.md`, AD-010
  three regions + sealing/redaction reuse), tasks (`tasks.md`, T0..T6).
- T1: the pure application region `packages/application/src/doctor/doctor.ts` —
  closed `DOCTOR_CHECK_IDS` (12), `DOCTOR_CAPABILITY_IDS`,
  `DOCTOR_REMEDIATION_CODES`, `DoctorCheckFact`, `assertDoctorCheckFacts`,
  `buildDoctorReport`, `assertDoctorReportPayload` (positive closed vocabularies,
  not a word denylist), `doctorExitCode` (PASS→0, FAIL→1, BLOCKED→4). Exported
  from `packages/application/src/index.ts`.
- Tests: `tests/unit/doctor-rules.test.mjs`, 23 cases, all pass.
- `pnpm gate:quick` PASS (format, lint, complexity, typecheck, unit,
  agent-readiness) at the T1 commit.

# Next action

Implement remaining tasks in order (see `tasks.md`):

- **T2** — add `schemas/doctor-report/1.schema.json` (`$id: ves://doctor-report/1`,
  `additionalProperties:false`, the six `doctor.*` fields), regenerate
  `packages/contracts/src/generated.ts` via `scripts/generate-contract-types.mjs`,
  add `tests/contract/doctor-report.test.mjs` (validate pass + fail examples,
  reject unknown fields / bad verdict / unregistered codes / generated parity).
  Read `schemas/AGENTS.md` first.
- **T3** — `packages/self-test/src/doctor-facts.ts`: one read-only observer per
  check, reusing existing surfaces (installation manifest, `SchemaRegistry.load`,
  Cedar `RuntimePolicyViewStore`, `inspectRuntimeDatabase`, hermetic-bundle,
  `git --version`, secret broker presence-only, `SystemClock`, driver/connector/
  probe availability, sandbox broker). Absent fixture → `blocked` + remediation.
  No sibling-adapter imports (the package rule); integration tests.
- **T4** — `apps/vestra-cli/src/doctor-composition.ts`: sentinel capture +
  invariance (`VES_DOCTOR_SENTINEL_MUTATION` code already declared), path
  pseudonymize + `ProhibitedContentScanner`, per-run
  `NodeEd25519Signer.generate({ keyId:"doctor-cli", purposes:["doctor-report"] })`
  wrapped in `ArtifactSealer`; mirror `self-test-composition.ts:186-206`; security
  tests.
- **T5** — add the `doctor` command + `--deep` option to
  `apps/vestra-cli/src/release-manifest.ts`, an `executeDoctor` branch in
  `apps/vestra-cli/src/main.ts:85` (read-only, never the mutating bus), reuse
  `cli.ts` renderers and `exitCode`; contract/e2e tests. Update
  `tests/contract/cli-surface.test.mjs`.
- **T6** — case-count audit (≥30), discrimination sensor on the pure verdicts,
  `pnpm gate:security`, handoff evidence.
- Then a separate verifier writes `docs/qualification/t72-validation.md` and
  advances the chain to T73 (see the memory note "qualification-chain-advance":
  it forces a status-surface migration across ~13 files).

# Blockers

None for T72 implementation. Chain-level: T76 is blocked on the owner's DSSE/
in-toto and context-tokenizer decisions (AD-008); T77 is the 1.0 decision. The
"beta" (a reproducible T76 candidate) therefore cannot be reached without owner
input, regardless of T72–T75 progress.
