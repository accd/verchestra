---
schema: verchestra-feature-handoff/v1
feature: claude-code-2-1-282
issue: 405
status: verification
branch: feat/405-governed-task-foundations
baseRevision: be032b24442d244f6d1f7798a8b0a2fbbf51566c
lastCompletedTask: T4
nextTask: "Merged without independent review on 2026-09-30 (#433); post-merge review pending (#553). The operational reviewer is excluded from it, as the author of the #405 commits it builds on; it goes to the security reviewer or a third reviewer."
lastGate: VES_REQUIRE_PINNED_PROVIDERS=1 corepack pnpm qualify:claude
updatedAt: 2026-10-13T19:50:00Z
---

# Evidence

The four fleet workflows, their shape test, the platform matrix, the live T03
probe, and the report `docs/qualification/claude-code-driver-2.1.282.md` agree
on `2.1.282`; the T03 floor stays `2.1.168` and the mediated minimum stays
`2.1.282`. The mediated flag probe now proves refusal on an older build instead
of failing on a missing flag. CodeQL alerts #7 and #8 and the SonarCloud bugs,
vulnerabilities, and major smells on PR #433 are addressed with equivalence and
adversarial tests. Every requirement is mapped in `validation.md`.

# Next exact action

Push this surface to PR #433 and confirm Quality, Site, CodeQL, and the
SonarCloud quality gate pass on the exact head before human review.

# Files intentionally left unchanged

`docs/qualification/claude-code-driver.md` and every other merged qualification
report, the T03 floor `2.1.168`, the Codex pin `0.115.0`, and dependency
versions.

# Post-merge review status (2026-10-13)

Merged without independent review on 2026-09-30 (#433); post-merge review
pending (#553). The operational reviewer is excluded (author of the #405 commits
this builds on).
