---
schema: verchestra-feature-handoff/v1
feature: json-schema-to-typescript-16
issue: 563
status: complete
branch: main
baseRevision: b5819c6e24d9d7ac97f09171eaf91ff23bcb7bc2
lastCompletedTask: T3
nextTask: "None in this feature."
lastGate: "PR #650 merged by rebase through the maintainer bypass at 2026-10-28T14:21:15Z (main 39791d6, tree equal to the PR head 48e7e4e) with Quality gate, Site quality and CodeQL passing on that head; no independent review, so the zero-drift check and the three lockfile mutants in validation.md are the record"
updatedAt: 2026-10-28T15:20:00Z
---

# Evidence

The manifest, lockfile, the scoped `js-yaml` override, the dependency-policy
sensor and the Dependabot reason agree on `json-schema-to-typescript` 16.0.0
with `js-yaml` 5.5.0 for it alone; every other consumer keeps the 4.3.2
override. The generator produces byte-identical contracts, so nothing under
`packages/contracts/src/generated.ts` changes. The 16.0.0 changelog was read;
see `validation.md`.

# Next exact action

None in this feature.
