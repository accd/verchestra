---
schema: verchestra-feature-handoff/v1
feature: json-schema-to-typescript-16
issue: 563
status: verification
branch: build/563-json-schema-to-typescript-16
baseRevision: b5819c6e24d9d7ac97f09171eaf91ff23bcb7bc2
lastCompletedTask: T3
nextTask: "Open the PR, merge it by rebase through the maintainer bypass only after the required checks pass on its exact head, verify the merge by content, then record in #563 that json-schema-to-typescript 16 is done."
lastGate: "generate-contract-types.mjs --check reports the contracts current under 16.0.0; dependency-policy 13 of 13 with three lockfile mutants killed; test:contract, gate:quick and agent:check results in validation.md"
updatedAt: 2026-10-28T14:30:00Z
---

# Evidence

The manifest, lockfile, the scoped `js-yaml` override, the dependency-policy
sensor and the Dependabot reason agree on `json-schema-to-typescript` 16.0.0
with `js-yaml` 5.5.0 for it alone; every other consumer keeps the 4.3.2
override. The generator produces byte-identical contracts, so nothing under
`packages/contracts/src/generated.ts` changes. The 16.0.0 changelog was read;
see `validation.md`.

# Next exact action

Open the PR, merge it by rebase only after the required checks pass on its
exact head, verify by content, and comment on #563.
