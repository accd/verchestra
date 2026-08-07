---
schema: verchestra-feature-handoff/v1
feature: deep-doctor
issue: 13
status: verification
branch: feat/t72-deep-doctor
baseRevision: 523fc224d105978a9d3acb99fc8e6c134e81d6cf
lastCompletedTask: T6
nextTask: independent T72 qualification report and chain advance to T73
lastGate: gate:quick, gate:full, gate:security PASS (62 new doctor cases)
updatedAt: 2026-08-07T08:23:00Z
---

# Scope

Implement T72 (#13): `vestra doctor --deep`, a read-only diagnostic surface, and
a signed diagnostic report. Follows the AD-010 three-region split and reuses the
existing `ArtifactSealer`/`NodeEd25519Signer` and the support-bundle redaction
model — no new crypto, no new redaction engine. Spec, design, and tasks are in
this feature directory.

# Authority and external effects

The owner authorized advancing the beta chain autonomously without stopping and
merging the feature. The implementation is complete and the feature is merged to
`main`. The qualification chain is NOT advanced by this work: T72 is qualified by
a separate verifier (author != verifier), who writes
`docs/qualification/t72-validation.md` and migrates the status surfaces to
"T72 complete; T73 next" — see the memory note "qualification-chain-advance".

# Completed evidence

- T0–T6 implemented. `doctor --deep` runs read-only, produces a closed 12-check
  report, blocks (not crashes) on absent fixtures with registered remediation
  codes, keeps sentinels byte-identical, seals + signs with a per-run TEST-ONLY
  Ed25519 identity bound to the `doctor-report` purpose, and exits 0/1/4 for
  PASS/FAIL/BLOCKED. A bare source checkout reports BLOCKED (exit 4) honestly.
- Regions: pure rules `packages/application/src/doctor/doctor.ts` and the probe
  port `.../doctor-facts.ts`; the `doctor-report` schema in
  `schemas/doctor-report/`; the composition root
  `apps/vestra-cli/src/doctor-composition.ts`; the verb in `release-manifest.ts`
  and dispatch in `main.ts`. `CommandResult` gained an optional `exitCode` so a
  diagnostic can render its report and still exit non-zero.
- 62 new cases: 31 unit (`doctor-rules` 23, `doctor-facts` 8), 14 contract
  (`doctor-report`), 8 e2e (`doctor-cli-e2e`), 9 security (`doctor-diagnostic`).
- `pnpm gate:quick`, `pnpm gate:full`, and `pnpm gate:security` all PASS with 0
  skipped and 0 todo.

# Next action

None for the implementation — it is complete and merged. The remaining step is
the independent T72 qualification (author != verifier): re-derive the DOC-01..07
adequacy matrix, run a discrimination sensor on the pure doctor verdicts, write
`docs/qualification/t72-validation.md` bound to the merge revision, and migrate
every status surface + pinned test to "T72 complete; T73 next" atomically (the
same ~13-file migration T71 used).

# Blockers

None for T72. Chain-level: T76 is blocked on the owner's DSSE/in-toto and
context-tokenizer decisions (AD-008); T77 is the 1.0 decision. The beta (a
reproducible T76 candidate) cannot be reached without owner input.

# Follow-ups

The source-mode probes for `cedar-policy`, `sqlite-durable-state`,
`secret-presence`, `driver`, `connector`, `probe`, and `sandbox` observe
fixture presence read-only and report `blocked` when absent; deeper live wiring
to the real subsystem adapters (constructed in the composition root) is a
worthwhile follow-up once those fixtures exist on a provisioned machine.
