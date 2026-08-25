---
schema: verchestra-feature-handoff/v1
feature: t76-release-candidate
issue: 17
status: in_progress
branch: codex/issue-17-t76-materialize-evidence
baseRevision: 79024f300b6471ee08fa8dfecf48cde4cee205c8
lastCompletedTask: T3
nextTask: "Produce real isolated target artifacts and generated supply-chain inputs, then wire approved signing and TUF views before independent verification."
lastGate: "Incremental materializer/TUF/filesystem-publication/rollback suites, typecheck, agent:check, complexity, ESLint, Prettier, gate:quick, and gate:release PASS; independent review pending"
updatedAt: 2026-08-25T01:15:00Z
---

# Scope completed

The first T76 slice now has a deterministic `ReleaseCandidate` contract. It
binds the exact source revision, hermetic bundle digest, all four distribution
view descriptors, license/SBOM/provenance/evaluation component digests, and a
verified rollback target. `verifyReleaseCandidate` rebuilds the canonical
closure and rejects mutations.

# Remaining work

PRs #316–#319 implement and test the incremental collector, evidence
generator, candidate materializer, TUF publisher, filesystem publication, and
activation/rollback paths. They do not yet constitute a real reproducible
candidate: the artifact-input handoff still requires real target builds and
their generated SBOM/license/provenance/evaluation inputs, and the TUF handoff
still requires wiring those outputs to an approved signing identity and
qualified source views. This is not a public release and does not satisfy #17
by itself. Independent replay, rollback verification, an independently
authored T76 report, public-service publication, release-key custody, and
human review remain open.
