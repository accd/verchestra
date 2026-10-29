---
schema: verchestra-feature-handoff/v1
feature: readme-rewrite
issue: null
status: verification
branch: docs/readme-rewrite-linear
baseRevision: c3b11647909b66903957594f9be34bb735cbf5cc
lastCompletedTask: T3
nextTask: Human review and rebase-merge of the linear pull request that replaced #694 (its merge commit could not be rebased)
lastGate: README pin tests 21/21; site unit 64/64; agent:check PASS; site build + check:built PASS (135 pages); gate:quick PASS
updatedAt: 2026-10-29T19:50:00Z
---

# Scope

Rewrite `README.md` from 470 to 262 lines around key points, usage and four
diagrams, keeping every pinned assertion satisfied and relocating the facts
that lived only in the README into their canonical homes. This is PR-D of the
plan approved on 2026-10-29; PR-A (`site/status-truth`, #692) carries the same
two README lines (the AD-017 bullet and the maturity legend) so the branches
merge cleanly in either order.

# Completed evidence

T1 and T2 complete; see `validation.md`.

# Next action

1. Pull request #694 is open; the four Mermaid diagrams render on GitHub
   (recorded in `validation.md` RR-05).
2. Human review and merge by rebase through the maintainer bypass once the
   required checks pass at the exact head. If #692 merges first, rebase this
   branch; the only shared hunks are README lines 77 and 86-87 in the old
   numbering, already written identically here.
3. A second pull request (`docs/readme-relocations-site`) moves the init
   walkthrough into `apps/site/src/content/docs/docs/develop-from-source.md`
   and the handoff sequence diagram into
   `workflows/cross-environment-handoff.md`; it selects `gate:build` and
   Prettier, which is why it is not in this change.
