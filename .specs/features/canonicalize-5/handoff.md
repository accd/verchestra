---
schema: verchestra-feature-handoff/v1
feature: canonicalize-5
issue: null
status: complete
branch: main
baseRevision: 2f6bce7aee5824ad852ce7ab5620f7fe1a56250a
lastCompletedTask: T1
nextTask: "None in this feature."
lastGate: "PR #663 merged by rebase through the maintainer bypass on 2026-10-28 (main 05fae9c; the diff main gained equal to the PR's over #661's b5f0827 apart from blob hashes and hunk offsets, same file set) with Quality gate, Site quality and CodeQL passing on the head 0546136; #655 closed as superseded; no independent review, so the two tests and two faults in validation.md are the record"
updatedAt: 2026-10-28T17:30:00Z
---

# Evidence

`canonicalize` moves from 3.0.0 to 5.1.0 behind the V1 evidence
canonicalizer. Every input shape whose output changed upstream is refused by
the wrapper with its own code before the library runs, and V1 writes the same
bytes as V2 for every value it accepts. Details are in `validation.md`.

# Next exact action

None in this feature.
