---
schema: verchestra-feature-handoff/v1
feature: single-binary-distribution
issue: 236
status: verification
branch: feat/236-single-binary
baseRevision: aa6cf42b0c6e26cdbe3a23ce474ca4ea39a47a94
lastCompletedTask: T5
nextTask: "T6: after merge, dispatch .github/workflows/single-binary-build.yml at the merge revision (first with no release inputs, then with a t76-publish-release run), record the five per-leg transcripts in validation.md, then hand the owner the macOS Developer ID/notarization and Windows Authenticode signing steps."
lastGate: "Local darwin-arm64 host: focused single-binary suites 49/49, gate:quick, gate:build, gate:security, gate:release, gate:full, agent:check - see validation.md."
updatedAt: 2026-09-29T00:00:00Z
---

# Scope

Issue #236: one `vestra` executable per fleet target, embedding the pinned
official Node 24.14.0 runtime and running the npm launcher's bootstrap with no
ambient Node. Requirements SBD-01 to SBD-12 are in `spec.md`. The design and
the ADR are in `design.md`, recorded in `.specs/STATE.md` as AD-0XX (to be
numbered at merge, status proposed).

# Completed Evidence

T1–T5 are done on the darwin-arm64 build host. `validation.md` maps every
requirement to file-and-assertion evidence and gives the gate results and the
discrimination sensor (11 killed, 0 survived).

# Next Exact Action

T6. After merge, dispatch `single-binary-build.yml` with `revision` set to the
merge commit and no release inputs. All five legs must pass with zero skips.
Then dispatch it again with `release_inputs_revision` and
`release_inputs_run_id` from the latest `t76-publish-release` run. Record both
run ids and the per-target executable digests in `validation.md`.

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
