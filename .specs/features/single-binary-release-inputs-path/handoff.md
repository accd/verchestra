---
schema: verchestra-feature-handoff/v1
feature: single-binary-release-inputs-path
issue: 236
status: in_progress
branch: claude/clever-lamport-7h2in4
baseRevision: 25b42166cb8ff8584cc76c2c5539a11f315cae55
lastCompletedTask: T1
nextTask: "Independent verification of C1-C3 by a fresh sub-agent, then review and merge. After the merge, dispatch single-binary-build.yml again with revision the new main tip and release_inputs_revision 50ae23c84c889c3546eaa0f2b1c22febab4069c4 and release_inputs_run_id 40999595578 (run 40999595578 of t76-publish-release; its metadata artifact expires 2027-01-28), and record the per-target digests in single-binary-distribution/validation.md."
lastGate: "node --test tests/agent-readiness/single-binary-workflow.test.mjs: 11 pass, 0 fail; the three tests that read the workflow were red against the old path and green against the new one"
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
