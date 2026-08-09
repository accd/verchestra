---
schema: verchestra-feature-handoff/v1
feature: deep-doctor
issue: 13
status: complete
branch: codex/t72-qualification
baseRevision: 523fc224d105978a9d3acb99fc8e6c134e81d6cf
lastCompletedTask: T6
nextTask: none; T72 is independently qualified and the chain advances to T73
lastGate: gate:quick and externally dispatched gate:security PASS at 2b628af; 5 of 5 mutations killed
updatedAt: 2026-08-09T19:05:00Z
---

# Scope

Implement T72 (#13): `vestra doctor --deep`, a read-only diagnostic surface, and
a signed diagnostic report. Follows the AD-010 three-region split and reuses the
existing `ArtifactSealer`/`NodeEd25519Signer` and the support-bundle redaction
model — no new crypto, no new redaction engine. Spec, design, and tasks are in
this feature directory.

# Authority and external effects

The implementation is complete and merged to `main`. Independent verification
is recorded in `docs/qualification/t72-validation.md`; the report author did not
author the implementation or remediation commits. Human review of the report
PR remains mandatory before merge.

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
- Independent verification binds revision `2b628af`, which remains byte-identical
  on every T72 source/schema/test path through `206501a`. Sixty-nine focused
  cases pass; the 34 contract/E2E/security cases exceed the minimum of 30.
- `gate:quick` passes on the exact Windows toolchain. Externally dispatched
  `gate:security` run 31330393346 passes 4,161 cases at `2b628af` with Node
  24.14.0, pinned local Driver probes, zero skipped, and zero todo.
- Five mutations of catalog completeness, remediation enforcement, FAIL,
  BLOCKED, and exact exit semantics are killed; none survives. The disposable
  worktree was restored and the unmutated pure suite passes 31 of 31.

# Next action

None. T72 is independently qualified. The next serial chain action is C4:
`brunomjanuario` authors `docs/qualification/t73-validation.md` and advances the
chain to T74.

# Blockers

None for T72. The live read-only upgrade of the seven source-mode presence
probes remains tracked in #207 for the provisioned T75 matrix; it is not claimed
by this report.

# Follow-ups

The source-mode probes for `cedar-policy`, `sqlite-durable-state`,
`secret-presence`, `driver`, `connector`, `probe`, and `sandbox` observe
fixture presence read-only and report `blocked` when absent; deeper live wiring
to the real subsystem adapters (constructed in the composition root) is a
worthwhile follow-up once those fixtures exist on a provisioned machine.
