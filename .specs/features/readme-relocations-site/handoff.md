---
schema: verchestra-feature-handoff/v1
feature: readme-relocations-site
issue: null
status: complete
branch: docs/readme-relocations-site
baseRevision: c3b11647909b66903957594f9be34bb735cbf5cc
lastCompletedTask: T3
nextTask: "None. Merged by the owner on 2026-10-29 as 473939df (#696) after the required checks, Site quality included, passed on the exact head; no independent review is recorded (#553)."
lastGate: gate:quick PASS; site unit 66/66; site build + check:built PASS (135 pages); e2e 54/54 on three browsers; Mermaid probe 6/6; agent:check PASS; architecture 149/149; astro check and Lighthouse not runnable on this Windows machine (CI covers them)
updatedAt: 2026-11-03T15:50:00Z
---

# Scope

Carry the two README passages that the 2026-10-29 rewrite (`docs/readme-rewrite`,
#694) leaves without a home into the hand-written site guides: the `init`
walkthrough from a source checkout into `develop-from-source.md`, and the
cross-environment handoff sequence diagram into
`workflows/cross-environment-handoff.md`. This is PR-E of the site work; it
touches no README line and no status surface.

# Completed evidence

T1–T3 complete; see `validation.md` for the requirement-to-evidence table and
the gate transcript. Two tracked guides changed, plus this feature folder.

# Next action

1. Human review of the pull request. Merge by rebase through the maintainer
   bypass only after the required checks pass at the exact head; the CI `site`
   job is the authoritative run of `astro check` and Lighthouse, which this
   machine could not complete (see `validation.md`).
2. After merge, move this handoff to `complete`. If #694 lands first and its
   README keeps a pointer to these guides, no further change is needed here.

# Known limitation

The site's Mermaid renderer labels every diagram "Architecture diagram" in
its `aria-label` (`apps/site/src/components/StarlightHead.astro`). The
handoff diagram inherits that label; the numbered list above it is the text
equivalent. Changing the label is renderer work outside this change.

# Reconciliation (2026-11-03)

Merged to `main` through #696 on 2026-10-29 as `473939df`, by rebase
through the maintainer bypass, after every required check passed on the
exact head `41a75a51`. The owner's is the only review; #553 governs a
post-merge independent review. Nothing is left in this feature.
