---
schema: verchestra-feature-handoff/v1
feature: single-binary-distribution
issue: 236
status: verification
branch: fix/236-windows-sea-pe
baseRevision: 8422c9ff064cb47a6239a12cf577c0b4f7f79cbb
lastCompletedTask: T8
nextTask: "Read the per-target executable digests from the reconciled index artifact 13371590518 of run 41928696291 and record them in validation.md (the authoring environment cannot download artifacts). Then the owner applies macOS Developer ID/notarization and Windows Authenticode signing and records the signed digests."
lastGate: "single-binary-build.yml run 41928696291 with reviewed inputs (t76-publish-release run 40999595578) at 2cf4b90046af14da5d1d0cb0cf69cabb4a4ba29b: PASS on all five legs, each building twice from the reviewed inputs with every byte compared, and the collect job PASS. The earlier tests-only run 41918706453 also passed. See validation.md."
updatedAt: 2026-11-04T23:10:00Z
---

# Scope

Issue #236: one `vestra` executable per fleet target, embedding the pinned
official Node 24.14.0 runtime and running the npm launcher's bootstrap with no
ambient Node. Requirements SBD-01 to SBD-12 are in `spec.md`. The design and
the ADR are in `design.md`, recorded in `.specs/STATE.md` as AD-038 (to be
numbered at merge, status proposed).

# Completed Evidence

T1–T5 are done on the darwin-arm64 build host. `validation.md` maps every
requirement to file-and-assertion evidence and gives the gate results and the
discrimination sensor (11 killed, 0 survived).

T7 resolved the SonarCloud findings on the pull request and hardened the
pinned-archive reader (SBD-13). The workflow now grants `actions: read` only
to the `target` job. The emitted bytes are unchanged, and the two-build
determinism test still passes.

T8 made the Windows executable loadable. On Windows x64, run 36675382810 failed
with `spawn EFTYPE`, because the injector left every existing resource's
bytes in `.rsrc` after moving the resource tree to `.sea`. A bisection on the
Windows runner, recorded in `validation.md`, isolated that rule. The new
section now holds the tree, the copied resource bytes, and the blob. Run
36677942597 then passed on all five legs. Mach-O and ELF bytes are unchanged.

# Next Exact Action

T6 is recorded for the unsigned binaries: run 41928696291 passed on all five legs with the reviewed
inputs, and `validation.md` has the jobs, artifacts and zip digests. What is left is to read the per-target
executable digests from the reconciled index artifact 13371590518, which needs an environment that can
download artifacts, and then the owner signs (macOS Developer ID with notarization, Windows Authenticode) and
records the signed digests.

# Blockers

None for the repository work. Fleet qualification waits on the CI dispatch and
on owner-held signing identities (Developer ID and Authenticode), which
automation must not provision.

# Decisions

- Node 24.14.0 has no `--build-sea`, and `postject` is not a dependency, so the
  blob is injected by the in-repository `scripts/sea-inject.mjs`. No dependency
  was added.
- A lone `--version` is answered locally. Everything else passes through
  verbatim. This is an open owner decision; see `spec.md`.
- macOS gets an ad-hoc signature only. Windows Authenticode is removed.
  Identity signing and notarization are owner actions.
- Five targets are built, not the six the milestone analysis mentions. This is
  an open owner decision.

# Files Intentionally Left Unchanged

- `apps/vestra-launcher/README.md` and `publish/package.template.json`: the npm
  package's published surface does not change.
- `docs/qualification/release-decision-1.0.0.md`, `ROADMAP.md`, the status
  surfaces, and `docs/qualification/t76-validation.md`: the release state is
  unchanged.
- `.github/workflows/t76-candidate-build.yml` and `t76-publish-release.yml`:
  the single binary consumes their outputs and changes neither.

# Post-merge review status (2026-10-13)

Post-merge independent review on 2026-10-13 of #425
(https://github.com/accd/verchestra/pull/425#issuecomment-6153569019) and #432
(https://github.com/accd/verchestra/pull/432#issuecomment-6153569538), both no
findings; the five pinned runtime archive digests were compared with the
official SHASUMS256.txt. T6 (the merge-revision dispatch and the owner's signing
steps) is still pending; tracked in #553.
