---
schema: verchestra-feature-handoff/v1
feature: canonicalize-5
issue: null
status: verification
branch: build/655-canonicalize-5
baseRevision: 2f6bce7aee5824ad852ce7ab5620f7fe1a56250a
lastCompletedTask: T1
nextTask: "Open the PR superseding Dependabot's #655, merge it by rebase through the maintainer bypass only after the required checks pass on its exact head, and verify the merge by content."
lastGate: "tests/unit/evidence-integrity.test.mjs 25 of 25 with two faults killed; test:contract 981 of 981; canonical, evidence and DSSE security tests 68 of 68; agent:check PASS"
updatedAt: 2026-10-28T16:00:00Z
---

# Evidence

`canonicalize` moves from 3.0.0 to 5.1.0 behind the V1 evidence
canonicalizer. Every input shape whose output changed upstream is refused by
the wrapper with its own code before the library runs, and V1 writes the same
bytes as V2 for every value it accepts. Details are in `validation.md`.

# Next exact action

Open the PR, merge it by rebase only after the required checks pass on its
exact head, and verify by content.
