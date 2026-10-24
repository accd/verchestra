---
schema: verchestra-feature-handoff/v1
feature: beta-release-2026-10
issue: null
status: in_progress
branch: feat/beta-release-2026-10
baseRevision: 5a77a8731f4852b57898371ad0e9b9b2f35df548
lastCompletedTask: null
nextTask: "T1 (slice S1 of checks.md): refusals name their fix in the terminal, proven by C1-C7."
lastGate: null
updatedAt: 2026-10-24T14:28:46Z
---

# Scope

The repository changes an external beta tester needs, as `plan.md` (approved by the owner on
2026-10-24) states them and `checks.md` turns them into 57 checks with proofs. Task `Tn` is slice
`Sn` of `checks.md`; each is committed on its own, in order, by one builder.

Owner-held steps stay outside this change: pilot #406 attempt 3 on `.8`, the publication of `.9`
(npm 2FA, R2 upload, ledger sequence 9), its tags, GitHub Release and `beta` dist-tag.

# Completed Evidence

None yet.

# Context

`main` at the base revision carries #583 (Cedar 4.14.0 as Dependabot generated it), which fails
the policy suites with `VES_POLICY_ENGINE_VERSION_MISMATCH`. The owner chose to revert it (PR
#589). Until #589 merges, this branch carries that revert as its first commit.

# Next exact action

T1: write the tests C1-C7 name, then make them pass.
