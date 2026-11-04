---
schema: verchestra-feature-handoff/v1
feature: single-binary-release-inputs-path
issue: 236
status: verification
branch: claude/clever-lamport-7h2in4
baseRevision: 25b42166cb8ff8584cc76c2c5539a11f315cae55
lastCompletedTask: T1
nextTask: "Review and merge. After the merge, dispatch single-binary-build.yml again with revision the new main tip, release_inputs_revision 50ae23c84c889c3546eaa0f2b1c22febab4069c4 and release_inputs_run_id 40999595578 (its metadata artifact expires 2027-01-28), and record the per-target digests in single-binary-distribution/validation.md."
lastGate: "independent verification PASS 3/3 (verification.md, four low findings closed); check_proofs 5 pass 0 fail; node --test on the workflow suite 11 pass, 0 fail; agent-readiness scope 474 pass; agent:check PASS; six mutants of the workflows are each killed by a test"
updatedAt: 2026-11-04T22:40:00Z
---

# Scope

T6 of `single-binary-distribution` (#236). The first reviewed-input dispatch, run
41922118231, failed on all five legs in "Build twice from the reviewed inputs and compare
every byte" with `VES_VESTRA_BUILD_INPUTS_MISSING`: the workflow read
`reviewed/t76-release-publication/release-inputs`, which the artifact does not contain.

# Completed

- `.github/workflows/single-binary-build.yml`: `--release-inputs reviewed/release-inputs`.
- `tests/agent-readiness/single-binary-workflow.test.mjs`: the assertion that pinned the
  wrong path now expects the right one and forbids the segment. Two new tests derive the
  artifact root from `t76-publish-release.yml`'s upload paths and check the single-binary
  workflow and `npm-publish.yml` against it.
- The pinned assertion changed with its claim, in the same commit.

# Intentionally unchanged

- The download step, the permissions and every other step of the workflow.
- `single-binary-distribution/validation.md`: it records the failed run and the cause once
  the fix has merged and the next dispatch has a result.
